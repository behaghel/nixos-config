"""Validate resurrect saves before publishing; report health via hub-notify."""

import argparse
import fcntl
import gzip
import os
from pathlib import Path
import shutil
import shlex
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
import zlib

INTERVAL = 900


def atomic_text(path, text):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex)
    try:
        temporary.write_text(text)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_link(path, target):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex)
    try:
        temporary.symlink_to(target)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def timestamp(path):
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return 0


def deliver_notification(title, message):
    try:
        subprocess.run(
            [os.environ["TMUX_SNAPSHOT_NOTIFY"], title, message],
            check=True, timeout=10,
        )
        return True
    except (OSError, subprocess.SubprocessError) as error:
        print(f"tmux-snapshot: notification failed: {error}", file=sys.stderr)
        return False


def notify(directory, title, message):
    """Share hub-notify; throttle unless health storage itself is broken."""
    sent = False
    try:
        health = directory / ".health"
        health.mkdir(exist_ok=True)
        with (health / "alert.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            now = int(time.time())
            if now - timestamp(health / "last-alert") < INTERVAL:
                return
            sent = deliver_notification(title, message)
            if sent:
                atomic_text(health / "last-alert", str(now))
    except OSError as error:
        print(f"tmux-snapshot: alert state unavailable: {error}",
              file=sys.stderr)
        if not sent:
            deliver_notification(title, message)


def tmux(socket, *args):
    return subprocess.run(
        ["tmux", "-S", socket, *args], check=True, capture_output=True,
        text=True, timeout=10,
    ).stdout.strip()


def panes(socket):
    # Resurrect saves only the first session in each group. Match its ordering.
    grouped = tmux(socket, "list-sessions", "-F",
                   "#{session_grouped}\t#{session_group}\t"
                   "#{session_id}\t#{session_name}")
    seen, excluded = set(), set()
    for line in sorted(grouped.splitlines()):
        active, group, _, name = line.split("\t", 3)
        if active == "1":
            if group in seen:
                excluded.add(name)
            seen.add(group)
    raw = tmux(socket, "list-panes", "-a", "-F",
               "#{session_name}\t#{window_index}\t"
               "#{pane_index}\t:#{pane_current_path}")
    return {tuple(line.split("\t")) for line in raw.splitlines()
            if line.split("\t", 1)[0] not in excluded}


def validate(stage, expected, capture):
    layout = stage / "last"
    if not layout.is_file() or layout.resolve().parent != stage.resolve():
        raise ValueError("missing or invalid saved layout")
    saved, windows, state = set(), set(), False
    for line in layout.read_text().splitlines():
        fields = line.split("\t")
        if fields[0] == "pane" and len(fields) >= 11:
            saved.add((fields[1], fields[2], fields[5],
                       fields[7].replace("\\ ", " ")))
        elif fields[0] == "window" and len(fields) >= 8:
            windows.add((fields[1], fields[2]))
        elif fields[0] == "state":
            state = True
        elif fields[0] != "grouped_session":
            raise ValueError("malformed saved layout")
    if (not expected or saved != expected or not state
            or windows != {(p[0], p[1]) for p in expected}):
        raise ValueError("incomplete saved layout")
    if capture:
        archive = stage / "pane_contents.tar.gz"
        # Consume through EOF to verify gzip's checksum, not only tar headers.
        with gzip.open(archive, "rb") as stream:
            while stream.read(1024 * 1024):
                pass
        with tarfile.open(archive) as contents:
            if not contents.getmembers():
                raise ValueError("empty pane archive")


def pane_command(pid):
    """Return one foreground child, never background helper commands."""
    output = subprocess.run(
        ["ps", "-axo", "ppid=,pgid=,tpgid=,command="],
        check=True, capture_output=True, text=True, timeout=10,
    ).stdout
    for line in output.splitlines():
        fields = line.split(None, 3)
        if (len(fields) == 4 and fields[0] == str(pid)
                and fields[1] == fields[2]):
            return fields[3]
    return ""


def run_saver(socket, stage):
    """Redirect only the saver to staging, without changing server options."""
    proxy = stage / "bin"
    proxy.mkdir()
    shim = proxy / "tmux"
    shim.write_text(
        f"#!{shutil.which('bash')}\n"
        'if [ "$#" -eq 3 ] && [ "$1" = show-option ] '
        '&& [ "$2" = -gqv ] && [ "$3" = @resurrect-dir ]; then\n'
        '  printf "%s\\n" "$TMUX_SNAPSHOT_STAGE"\n'
        'else\n'
        '  exec "$TMUX_SNAPSHOT_TMUX" -S "$TMUX_SNAPSHOT_SOCKET" "$@"\n'
        'fi\n'
    )
    shim.chmod(0o700)
    env = dict(os.environ)
    env.update(
        TMUX_SNAPSHOT_STAGE=str(stage),
        TMUX_SNAPSHOT_SOCKET=socket,
        TMUX_SNAPSHOT_TMUX=shutil.which("tmux"),
        PATH=str(proxy) + os.pathsep + os.environ["PATH"],
        TMUX=f"{socket},{tmux(socket, 'display-message', '-p', '#{pid}')},0",
    )
    env.pop("TMUX_TMPDIR", None)
    # The upstream ps strategy emits every child as a separate line, including
    # background helpers. Use a private copy so its single-command field stays
    # a single record, without modifying the installed plugin or live options.
    plugin = stage / "plugin"
    source = Path(os.environ["TMUX_SNAPSHOT_SAVE_SCRIPT"])
    saver = source
    if (source.parent.parent / "save_command_strategies/ps.sh").is_file():
        shutil.copytree(source.parent.parent, plugin)
        plugin.chmod(0o700)
        for directory in plugin.rglob("*"):
            if directory.is_dir():
                directory.chmod(0o700)
        strategy = plugin / "save_command_strategies/ps.sh"
        strategy.chmod(0o700)
        strategy.write_text(
            f"#!{shutil.which('bash')}\n"
            f"exec {shlex.quote(sys.executable)} "
            f"{shlex.quote(str(Path(__file__).resolve()))} "
            '--pane-command "$1"\n'
        )
        saver = plugin / "scripts" / source.name
    process = subprocess.Popen(
        ["bash", str(saver), "quiet"],
        env=env, start_new_session=True,
    )
    try:
        code = process.wait(timeout=90)
        if code:
            raise subprocess.CalledProcessError(code, process.args)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise
    finally:
        shutil.rmtree(proxy)
        if plugin.exists():
            shutil.rmtree(plugin)


def publish(directory, stage):
    """One pointer switches the layout and pane archive together."""
    current = directory / ".snapshot-current"
    last = directory / "last"
    archive = directory / "pane_contents.tar.gz"
    # Migrate existing flat backups without discarding the last good pair.
    if not current.is_symlink() and last.is_file():
        legacy = Path(tempfile.mkdtemp(prefix="legacy-", dir=stage.parent))
        shutil.copy2(last, legacy / "layout.txt")
        (legacy / "last").symlink_to("layout.txt")
        if archive.is_file():
            shutil.copy2(archive, legacy / archive.name)
        atomic_link(current, legacy.relative_to(directory))
    # On first use there is no prior pair to preserve.
    if not current.is_symlink():
        atomic_link(current, stage.relative_to(directory))
    atomic_link(last, ".snapshot-current/last")
    atomic_link(archive, ".snapshot-current/pane_contents.tar.gz")
    atomic_link(current, stage.relative_to(directory))


def save(socket, directory):
    health = directory / ".health"
    health.mkdir(exist_ok=True)
    with (health / "save.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        bundles = directory / ".snapshots"
        bundles.mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix="save-", dir=bundles))
        published = False
        try:
            expected = panes(socket)
            capture = tmux(socket, "show-option", "-gqv",
                           "@resurrect-capture-pane-contents") == "on"
            run_saver(socket, stage)
            validate(stage, expected, capture)
            if panes(socket) != expected:
                raise ValueError("panes changed during save; retry next run")
            publish(directory, stage)
            published = True
            atomic_text(health / "last-success", str(int(time.time())))
            # Archives contain scrollback: retain only five complete bundles.
            old = sorted(bundles.iterdir(), key=lambda p: p.stat().st_mtime,
                         reverse=True)
            for bundle in old[5:]:
                if bundle != stage:
                    shutil.rmtree(bundle, ignore_errors=True)
        finally:
            if not published:
                shutil.rmtree(stage)


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pane-command", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--socket")
    parser.add_argument("--check", action="store_true",
                        help="check backup health without saving")
    args = parser.parse_args(argv)
    if args.pane_command is not None:
        print(pane_command(args.pane_command))
        return 0
    sockets = [args.socket] if args.socket else [
        str(Path(os.environ["TMUX_SNAPSHOT_ROOT"])
            / f"tmux-{os.getuid()}/default"),
        f"/tmp/tmux-{os.getuid()}/default",
    ]
    socket = None
    for candidate in sockets:
        try:
            tmux(candidate, "has-session")
            socket = candidate
            break
        except (OSError, subprocess.SubprocessError):
            continue
    if socket is None:
        return 0
    directory = None
    try:
        value = tmux(socket, "show-option", "-gqv", "@resurrect-dir")
        directory = Path(os.path.expandvars(os.path.expanduser(
            value or "~/.tmux/resurrect")))
        directory.mkdir(parents=True, exist_ok=True)
        if args.check:
            started = int(tmux(socket, "display-message", "-p",
                               "#{start_time}"))
            baseline = max(timestamp(directory / ".health/last-success"),
                           started)
            if time.time() - baseline >= INTERVAL:
                message = "No successful tmux backup for at least 15 minutes."
                print(f"tmux-snapshot: {message}", file=sys.stderr)
                notify(directory, "Tmux backup stale", message)
                return 1
        else:
            save(socket, directory)
        return 0
    except (OSError, ValueError, subprocess.SubprocessError,
            tarfile.TarError, EOFError, zlib.error) as error:
        print(f"tmux-snapshot: {error}", file=sys.stderr)
        message = ("Save failed; the last good backup is retained. "
                   "See tmux-snapshot.log.")
        if directory is not None and directory.is_dir():
            notify(directory, "Tmux backup failed", message)
        else:
            deliver_notification("Tmux backup failed", message)
        return 1


if __name__ == "__main__":
    sys.exit(main())
