"""Track pending Git signatures, never ownership of a physical touch.

Markers contain no request data. An exclusive lock denotes a live wrapper;
stale files after SIGKILL do not count. These are advisory same-user hints,
not an authorization boundary or authenticated process identity.
"""

import fcntl
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile


UNKNOWN = "Requester unknown"


def state_directory(create=False):
    directory = Path.home() / "Library/Caches/yknotify-requests"
    if create:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise OSError("unsafe signing-context directory")
    return directory


def describe(kind):
    if kind != "OpenPGP":
        return UNKNOWN
    try:
        count = 0
        for path in state_directory().glob("request-*"):
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd) as marker:
                    try:
                        fcntl.flock(marker, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        count += 1
            except FileNotFoundError:
                continue  # A request completed during the snapshot.
        if count == 1:
            return "Git signing pending — touch requester unverified"
        if count > 1:
            return ("Multiple Git signing requests pending"
                    " — touch requester unverified")
    except OSError:
        pass  # Missing or unreadable context is not evidence of ownership.
    return UNKNOWN


def is_signing(args):
    return any(arg in ("--sign", "--detach-sign")
               or (arg.startswith("-") and not arg.startswith("--")
                   and "s" in arg)
               for arg in args)


def wrap(command):
    if not is_signing(command[1:]):
        os.execv(command[0], command)
    marker = None
    path = None
    try:
        fd, path = tempfile.mkstemp(prefix="request-", dir=state_directory(True))
        marker = os.fdopen(fd, "w")
        fcntl.flock(marker, fcntl.LOCK_EX)
    except OSError:
        # Context failure must never prevent the user's signing operation.
        if marker is not None:
            marker.close()
        if path is not None:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass
        print("yknotify: signing context unavailable", file=sys.stderr)
        os.execv(command[0], command)

    child = None
    previous = {}
    pending = []

    def forward(signum, _frame):
        if child is None:
            pending.append(signum)
        else:
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass

    try:
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous[signum] = signal.signal(signum, forward)
        child = subprocess.Popen(command, restore_signals=True)
        for signum in pending:
            forward(signum, None)
        result = child.wait()
        return result if result >= 0 else 128 - result
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass  # Releasing the lock still makes any leftover marker inactive.
        marker.close()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "describe":
        print(describe(sys.argv[2]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "wrap":
        sys.exit(wrap(sys.argv[2:]))
    else:
        sys.exit("usage: context.py describe TYPE | wrap EXECUTABLE [ARGS...]")
