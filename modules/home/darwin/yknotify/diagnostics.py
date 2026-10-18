"""Best-effort, privacy-limited evidence; never touch attribution."""

from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import queue
import re
import stat
import subprocess
import threading
import time
import uuid

MAX_BYTES = 1024 * 1024  # Active journal plus one backup: at most 2 MiB.
MAX_RECORD = 16 * 1024
ROOTS = {"git", "gpg", "gpg2", "gpg-agent", "scdaemon", "pinentry-mac",
         "pinentry", "ssh", "ssh-keygen", "ykman"}
BROWSERS = {"Safari", "Google Chrome", "firefox", "Brave Browser",
            "Microsoft Edge", "Arc", "com.apple.WebKit.WebContent"}
SOCKETS = {"S.gpg-agent": "agent", "S.gpg-agent.extra": "extra",
           "S.gpg-agent.browser": "browser", "S.gpg-agent.ssh": "ssh"}


def enabled():
    return os.environ.get("YKNOTIFY_DIAGNOSTICS") == "1"


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def private_file(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                 0o600)
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077 or info.st_nlink != 1):
        os.close(fd)
        raise OSError("unsafe diagnostic file")
    return os.fdopen(fd, "r+b")


def emit(event, **fields):
    """Append under a nonblocking writer lock; never expose raw errors."""
    if not enabled():
        return False
    try:
        record = {"schema": 1, "timestamp": timestamp(),
                  "event_id": uuid.uuid4().hex, "event": event, **fields}
        data = (json.dumps(record, ensure_ascii=True) + "\n").encode()
        if len(data) > min(MAX_RECORD, MAX_BYTES):
            return False
        directory = Path.home() / "Library/Logs/yknotify-diagnostics"
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) & 0o077):
            return False
        with private_file(directory / ".lock") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            path = directory / "events.jsonl"
            with private_file(path) as journal:
                journal.seek(0, os.SEEK_END)
                rotate = journal.tell() + len(data) > MAX_BYTES
                if not rotate:
                    journal.write(data)
                    return True
            os.replace(path, directory / "events.jsonl.1")
            with private_file(path) as journal:
                journal.write(data)
        return True
    except (OSError, ValueError, TypeError):
        return False


def probe(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=1, check=False)
        return result.stdout if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        return None


def capture(kind):
    """Inspect current-user names and agent FDs, never arguments or payloads."""
    ps = probe(["/bin/ps", "-U", str(os.getuid()),
                "-o", "pid=,ppid=,comm="])
    rows = {}
    for line in (ps or "").splitlines()[:10000]:
        parts = line.split(None, 2)
        if len(parts) != 3 or not all(p.isdigit() for p in parts[:2]):
            continue
        name = parts[2].rsplit("/", 1)[-1]
        rows[int(parts[0])] = {"pid": int(parts[0]), "ppid": int(parts[1]),
                              "name": re.sub(r"[^\w .+-]", "?", name)[:96]}
    roots = ROOTS | (BROWSERS if kind == "FIDO2" else set())
    selected = {}
    for pid in sorted(rows):
        if rows[pid]["name"] not in roots:
            continue
        current = pid
        for depth in range(6):
            if current not in rows or len(selected) >= 64:
                break
            entry = {**rows[current],
                     "evidence": "candidate" if depth == 0 else "ancestor"}
            if current not in selected or depth == 0:
                selected[current] = entry
            current = rows[current]["ppid"]

    # Do not persist raw lsof names: they include home/socket paths.
    lsof = probe(["/usr/sbin/lsof", "-nP", "-U", "-a", "-c", "gpg-agent",
                  "-FpftDn"])
    sockets = []
    pid = None
    current = None
    for line in (lsof or "").splitlines():
        field, value = line[:1], line[1:]
        if field == "p" and value.isdigit():
            pid = int(value)
        elif field == "f" and re.fullmatch(r"\d+[a-z]*", value):
            if len(sockets) >= 32:
                break
            current = {"pid": pid, "fd": int(re.match(r"\d+", value)[0]),
                       "socket": "unknown"}
            sockets.append(current)
        elif current is not None and field == "n":
            current["socket"] = SOCKETS.get(value.rsplit("/", 1)[-1], "unknown")
        elif (current is not None and field == "D"
              and re.fullmatch(r"0x[0-9a-fA-F]+", value)):
            current["endpoint"] = value
    return {"process_probe": "available" if ps is not None else "unavailable",
            "processes": list(selected.values()),
            "process_limit_reached": len(selected) >= 64,
            "socket_probe": "available" if lsof is not None else "unavailable",
            "agent_socket_fds": sockets,
            "socket_note": "Open FDs, not proof of a connected requesting client"}


class BurstSampler:
    """Sample each type independently; long bursts get at most one/minute."""

    def __init__(self, session_timeout):
        self.timeout = session_timeout
        self.last_seen = {}
        self.last_sample = {}

    def observe(self, kind, now):
        if kind not in ("OpenPGP", "FIDO2"):
            return None
        last = self.last_seen.get(kind)
        self.last_seen[kind] = now
        if last is None or now - last > self.timeout:
            reason = "burst_start"
        elif now - self.last_sample[kind] >= 60:
            reason = "periodic_sample"
        else:
            return None
        self.last_sample[kind] = now
        return reason


def observe_stream(source, output, session_timeout, pending_requests):
    """Pass through events immediately; bounded background probes add evidence."""
    if not enabled():
        for line in source:
            output.write(line)
            output.flush()
        return
    sampler = BurstSampler(session_timeout)
    work = queue.Queue(maxsize=2)
    stopping = threading.Event()

    def worker():
        while not stopping.is_set() or not work.empty():
            try:
                event = work.get(timeout=0.05)
            except queue.Empty:
                continue
            try:
                snapshot = capture(event["type"])
            except Exception:
                snapshot = {"capture_status": "unavailable"}
            emit("touch_snapshot", **event, **snapshot)

    thread = threading.Thread(target=worker, daemon=True)
    try:
        thread.start()
    except (OSError, RuntimeError):
        for line in source:
            output.write(line)
            output.flush()
        return
    try:
        for line in source:
            # Banner delivery never waits for a process/socket probe.
            output.write(line)
            output.flush()
            try:
                kind = json.loads(line).get("type")
                reason = sampler.observe(kind, time.monotonic())
                if reason is None:
                    continue
                try:
                    pending = pending_requests()
                except OSError:
                    pending = None
                work.put_nowait({"type": kind, "reason": reason,
                                 "observed_at": timestamp(),
                                 "attribution": "unverified",
                                 "pending_git_requests": pending})
            except (ValueError, AttributeError, queue.Full):
                continue
    finally:
        stopping.set()
        thread.join(timeout=3)  # Best effort at EOF, never an unbounded wait.
