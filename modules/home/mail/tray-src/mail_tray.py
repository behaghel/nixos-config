#!/usr/bin/env python3
import argparse
import datetime as _dt
import json
import os
import pathlib
import shutil
import math
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Dict, Iterable, Tuple

from PIL import Image, ImageDraw

try:
  import gi  # type: ignore

  gi.require_version("Notify", "0.7")
  from gi.repository import Notify  # type: ignore

  Notify.init("mail-sync-tray")
  _NOTIFY_AVAILABLE = True
except Exception:
  _NOTIFY_AVAILABLE = False

VERSION = "0.1.10"

if os.environ.get("MAIL_TRAY_GI_TYPELIB_PATH") and not os.environ.get("GI_TYPELIB_PATH"):
  os.environ["GI_TYPELIB_PATH"] = os.environ["MAIL_TRAY_GI_TYPELIB_PATH"]

def check_typelibs():
  required = [
    "Pango-1.0",
    "Gtk-3.0",
    "GdkPixbuf-2.0",
    "AppIndicator3-0.1",
  ]
  missing = []
  paths = [p for p in os.environ.get("GI_TYPELIB_PATH", "").split(":") if p]
  for name in required:
    filename = f"{name}.typelib"
    if not any((pathlib.Path(p) / filename).exists() for p in paths):
      missing.append(name)
  return missing


def load_pystray():
  backend_used = None
  try:
    import pystray  # type: ignore
    backend_used = os.environ.get("PYSTRAY_BACKEND")
    return pystray, backend_used
  except Exception as exc:
    err = str(exc)
    if "Typelib file for namespace" in err or "Namespace Gtk not available" in err:
      os.environ["PYSTRAY_BACKEND"] = "dummy"
      import pystray  # type: ignore
      backend_used = "dummy"
      return pystray, backend_used
    raise


def set_icon_menu(icon, menu):
  try:
    icon.menu = menu
    return True
  except NotImplementedError:
    print("mail-tray: backend does not support menus; continuing without menu", flush=True)
    return False


@dataclass
class RunStatus:
  status: str
  message: str
  last_attempt: int
  last_success: int


@dataclass
class InboxCount:
  unread: int
  total: int


def parse_interval(text: str, default_seconds: int = 1800) -> int:
  """Parse timer strings like 5m/1h/30s into seconds."""
  if not text:
    return default_seconds
  try:
    if text.endswith("ms"):
      return int(text[:-2]) // 1000
    if text.endswith("s"):
      return int(text[:-1])
    if text.endswith("m"):
      return int(text[:-1]) * 60
    if text.endswith("h"):
      return int(text[:-1]) * 3600
    return int(text)
  except ValueError:
    return default_seconds


def _read_int_file(path: pathlib.Path) -> int:
  try:
    return int(path.read_text().strip())
  except Exception:
    return 0


def load_status(status_path: pathlib.Path, stamp_path: pathlib.Path) -> RunStatus:
  last_success = _read_int_file(stamp_path)
  last_attempt = 0
  status = "unknown"
  message = ""
  if status_path.exists():
    try:
      data = json.loads(status_path.read_text())
      status = data.get("status", status)
      message = data.get("message", message)
      last_attempt = int(data.get("last_attempt", 0))
      stored_success = int(data.get("last_success", 0))
      if stored_success:
        last_success = stored_success
    except Exception:
      status = "corrupt"
      message = "status file unreadable"
  return RunStatus(status=status, message=message, last_attempt=last_attempt, last_success=last_success)


def _flags_from_name(name: str) -> Tuple[str, Iterable[str]]:
  if ":2," in name:
    prefix, flags = name.split(":2,", 1)
    return prefix, flags
  if ";2," in name:
    prefix, flags = name.split(";2,", 1)
    return prefix, flags
  return name, ""


def count_inbox(inbox: pathlib.Path) -> InboxCount:
  unread = 0
  total = 0

  new_dir = inbox / "new"
  cur_dir = inbox / "cur"

  for entry in (new_dir.iterdir() if new_dir.exists() else []):
    if entry.is_file():
      unread += 1
      total += 1

  if cur_dir.exists():
    for entry in cur_dir.iterdir():
      if not entry.is_file():
        continue
      total += 1
      _, flags = _flags_from_name(entry.name)
      if "S" not in flags:
        unread += 1

  return InboxCount(unread=unread, total=total)


def _mu_query_count(query: str) -> int | None:
  if not shutil.which("mu"):
    return None
  try:
    proc = subprocess.run(
      ["mu", "find", "--format=plain", "--color", "never", query],
      capture_output=True,
      text=True,
      check=False,
    )
  except FileNotFoundError:
    return None
  if proc.returncode != 0:
    return None
  return len([ln for ln in proc.stdout.splitlines() if ln.strip()])


def count_inbox_with_mu(maildir: pathlib.Path, inbox_rel: str) -> InboxCount | None:
  """Try to count via mu using absolute and relative maildir filters."""
  inbox_abs = maildir / inbox_rel
  bases = [
    f'maildir:"={inbox_abs}"',
    f'maildir:"=/{inbox_rel}"',
    f"maildir:/{inbox_rel}",
  ]
  for base in bases:
    total = _mu_query_count(f"{base} and not flag:trashed")
    unread = _mu_query_count(f"{base} and flag:unread and not flag:trashed")
    if total is None or unread is None:
      continue
    return InboxCount(unread=unread, total=total)
  return None


def collect_inboxes(maildir: pathlib.Path) -> Dict[str, InboxCount]:
  counts: Dict[str, InboxCount] = {}
  if not maildir.exists():
    return counts
  for account in sorted(p for p in maildir.iterdir() if p.is_dir()):
    inbox = account / "inbox"
    if inbox.is_dir():
      key = str(inbox.relative_to(maildir))
      mu_counts = count_inbox_with_mu(maildir, key)
      counts[key] = mu_counts or count_inbox(inbox)
  return counts


def mark_running(status_path: pathlib.Path, stamp_path: pathlib.Path, message: str = "manual fetch"):
  now = int(time.time())
  last_success = _read_int_file(stamp_path)
  status_path.parent.mkdir(parents=True, exist_ok=True)
  payload = {
    "status": "running",
    "message": message,
    "last_attempt": now,
    "last_success": last_success,
  }
  status_path.write_text(json.dumps(payload))


def _envelope(draw: ImageDraw.ImageDraw, size: int, body: Tuple[int, int, int], stroke: Tuple[int, int, int]):
  pad = size // 8
  bottom = size - pad
  draw.rectangle([pad, pad, size - pad, bottom], fill=body, outline=stroke, width=2)
  draw.polygon([(pad, pad), (size // 2, size // 2), (size - pad, pad)], fill=stroke)


def _red_dot(draw: ImageDraw.ImageDraw, size: int):
  radius = size // 6
  x1 = size - radius * 2
  y1 = size - radius * 2
  draw.ellipse([x1, y1, x1 + radius * 2, y1 + radius * 2], fill=(204, 32, 32, 255), outline=(255, 232, 232, 255), width=2)


def _spinner(draw: ImageDraw.ImageDraw, size: int):
  radius = size // 3
  x1 = size - radius * 2
  y1 = size - radius * 2
  bbox = [x1, y1, x1 + radius * 2, y1 + radius * 2]
  fg = (25, 118, 210, 255)
  draw.arc(bbox, start=210, end=80, fill=fg, width=7)
  draw.arc(bbox, start=30, end=-100, fill=fg, width=7)
  def arrow(angle_deg):
    ang = math.radians(angle_deg)
    cx = x1 + radius
    cy = y1 + radius
    tip = (cx + radius * math.cos(ang), cy + radius * math.sin(ang))
    side1 = (cx + (radius + 3) * math.cos(ang + 0.5), cy + (radius + 3) * math.sin(ang + 0.5))
    side2 = (cx + (radius + 3) * math.cos(ang - 0.5), cy + (radius + 3) * math.sin(ang - 0.5))
    draw.polygon([tip, side1, side2], fill=fg)
  arrow(80)
  arrow(-100)


def build_icon(kind: str, overlay: str | None) -> Image.Image:
  size = 64
  base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
  draw = ImageDraw.Draw(base)

  if kind == "missing-smartcard":
    bg, fg = (239, 108, 0, 255), (44, 44, 44, 255)
    _envelope(draw, size, bg, fg)
    shaft_y = size // 2
    draw.rectangle([size // 3, shaft_y, size // 3 + 6, shaft_y + size // 3], fill=fg)
    draw.ellipse([size // 3 - 6, shaft_y - 10, size // 3 + 18, shaft_y + 14], outline=fg, width=3)
  elif kind == "failed":
    bg, fg = (189, 189, 189, 255), (183, 28, 28, 255)
    _envelope(draw, size, bg, fg)
    draw.line([(size // 4, size // 4), (size - size // 4, size - size // 4)], fill=fg, width=5)
    draw.line([(size // 4, size - size // 4), (size - size // 4, size // 4)], fill=fg, width=5)
  elif kind == "stale":
    bg, fg = (100, 181, 246, 255), (21, 101, 192, 255)
    _envelope(draw, size, bg, fg)
    draw.arc([size // 4, size // 4, size - size // 4, size - size // 4], start=40, end=320, fill=fg, width=4)
    draw.polygon([(size - size // 4, size // 2), (size - size // 4 - 8, size // 2 - 8), (size - size // 4 - 8, size // 2 + 8)], fill=fg)
  else:
    bg, fg = (67, 160, 71, 255), (27, 94, 32, 255)
    _envelope(draw, size, bg, fg)

  if overlay == "unread":
    _red_dot(draw, size)
  elif overlay == "spinner":
    _spinner(draw, size)

  return base


def format_time(epoch: int) -> str:
  if not epoch:
    return "unknown"
  return _dt.datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M:%S")


def format_status(status: RunStatus, counts: Dict[str, InboxCount]) -> str:
  lines = [
    f"Last successful fetch: {format_time(status.last_success)}",
    f"Last attempt:          {format_time(status.last_attempt)}",
    f"Status:                {status.status or 'unknown'}",
  ]
  for inbox, count in counts.items():
    lines.append(f"{inbox}: {count.unread} unread / {count.total} total")
  if not counts:
    lines.append("No inboxes discovered.")
  return "\n".join(lines)


def format_age(epoch: int) -> str:
  if not epoch:
    return "unknown"
  delta = max(0, int(time.time()) - epoch)
  if delta < 90:
    return f"{delta}s ago"
  if delta < 5400:
    return f"{delta // 60}m ago"
  if delta < 172800:
    return f"{delta // 3600}h ago"
  return f"{delta // 86400}d ago"


def notify(title: str, body: str):
  try:
    subprocess.run(["notify-send", title, body], check=False)
  except FileNotFoundError:
    print(title)
    print(body)


def focus_mu4e():
  lisp = "(progn (when (fboundp 'persp-switch) (persp-switch \"mu4e\")) (when (fboundp 'mu4e) (mu4e)) (when (fboundp 'select-frame-set-input-focus) (select-frame-set-input-focus (selected-frame))))"
  subprocess.run(["emacsclient", "--no-wait", "--eval", lisp], check=False)


def notify_with_action(title: str, body: str, action_label: str | None = None):
  if not action_label or not _NOTIFY_AVAILABLE:
    notify(title, body)
    return
  try:
    n = Notify.Notification.new(title, body, "mail-unread")
    n.add_action("open-mu4e", action_label, lambda *_: threading.Thread(target=focus_mu4e, daemon=True).start(), None)
    n.show()
  except Exception:
    notify(title, body)


def choose_kind(status: RunStatus, recent_threshold: int) -> str:
  now = int(time.time())
  is_recent = status.last_success and (now - status.last_success) <= recent_threshold
  if status.status == "running":
    return "ok"
  if status.status == "missing-smartcard":
    return "missing-smartcard"
  if status.status not in ("ok", "running"):
    return "failed"
  if not is_recent:
    return "stale"
  return "ok"




def run_tray(args):
  pystray, backend_used = load_pystray()

  missing = check_typelibs()
  if missing and os.environ.get("MAIL_TRAY_ALLOW_DUMMY") != "1":
    print("mail-tray: missing typelibs; install on Ubuntu: gir1.2-gtk-3.0 gir1.2-pango-1.0 gir1.2-gdkpixbuf-2.0 gir1.2-appindicator3-0.1 libappindicator3-1 libnotify4", flush=True)
    print(f"mail-tray: GI_TYPELIB_PATH={os.environ.get('GI_TYPELIB_PATH','')}", flush=True)
    return

  status_path = pathlib.Path(args.status_file).expanduser()
  stamp_path = pathlib.Path(args.stamp_file).expanduser()
  maildir = pathlib.Path(args.maildir).expanduser()
  poll_seconds = args.poll_seconds
  recent_threshold = args.recent_threshold

  backend = getattr(pystray, "backend", None)
  try:
    if backend is not None:
      backend_mod = backend()
      print(f"mail-tray: using backend {backend_mod.__name__}", flush=True)
    else:
      print("mail-tray: pystray.backend unavailable; using default Icon backend", flush=True)
  except Exception as exc:  # pragma: no cover
    print(f"mail-tray: failed to pick backend: {exc}", flush=True)
    # continue; pystray will lazily choose when instantiating Icon

  state = {"status": load_status(status_path, stamp_path), "counts": collect_inboxes(maildir)}
  total_unread = lambda: sum(c.unread for c in state["counts"].values())

  def refresh(icon: pystray.Icon):
    state["status"] = load_status(status_path, stamp_path)
    state["counts"] = collect_inboxes(maildir)
    kind = choose_kind(state["status"], recent_threshold)
    overlay = "spinner" if state["status"].status == "running" else ("unread" if total_unread() > 0 else None)
    icon.icon = build_icon(kind, overlay)
    icon.title = f"Mail sync: {state['status'].status}"
    set_icon_menu(icon, build_menu(pystray, state, actions))

  def on_click(icon, item):
    refresh(icon)
    notify("Mail sync status", format_status(state["status"], state["counts"]))

  def loop(icon: pystray.Icon):
    while icon.visible:
      refresh(icon)
      time.sleep(poll_seconds)

  icon = pystray.Icon("mail-sync-tray")
  actions = make_actions(status_path, stamp_path, maildir, lambda: refresh(icon))

  def setup(icon):
    refresh(icon)
    icon.visible = True
    threading.Thread(target=loop, args=(icon,), daemon=True).start()

  if backend_used == "dummy":
    print("mail-tray: dummy backend active; running headless loop", flush=True)
    if os.environ.get("MAIL_TRAY_DUMMY_EXIT") == "1":
      return
    while True:
      time.sleep(poll_seconds)
  try:
    icon.run(setup=setup)
  except NotImplementedError:
    print("mail-tray: backend run not implemented; exiting without tray", flush=True)


def build_menu(pystray, state, actions):
  counts_items = []
  if state["counts"]:
    for inbox, count in sorted(state["counts"].items()):
      label = inbox[:-len("/inbox")] if inbox.endswith("/inbox") else inbox
      label = f"{label}: {count.unread}/{count.total}"
      counts_items.append(pystray.MenuItem(label, lambda icon, item: None, enabled=False))
  else:
    counts_items.append(pystray.MenuItem("No inboxes discovered", lambda icon, item: None, enabled=False))

  status = state["status"]
  last_success = format_age(status.last_success)
  status_label = f"Last successful fetch: {last_success}"
  status_item = pystray.MenuItem(status_label, lambda icon, item: None, enabled=False)

  def wrap_async(func):
    def handler(icon, item):
      threading.Thread(target=func, daemon=True).start()
    return handler

  fetch_now = pystray.MenuItem("Fetch now", wrap_async(actions["fetch_now"]))
  restart = pystray.MenuItem("Restart mail-sync service", wrap_async(actions["restart_service"]))
  show_logs = pystray.MenuItem("Show mail-sync logs", wrap_async(actions["show_logs"]))
  show_status = pystray.MenuItem("Show status", lambda icon, item: actions["show_status"](state))
  version_item = pystray.MenuItem(f"Version: {VERSION}", lambda icon, item: None, enabled=False)
  quit_item = pystray.MenuItem("Quit", lambda icon, _: icon.stop())

  menu_items = counts_items + [
    status_item,
    pystray.Menu.SEPARATOR,
    fetch_now,
    restart,
    show_logs,
    show_status,
    version_item,
    quit_item,
  ]
  return pystray.Menu(*menu_items)


def make_actions(status_path: pathlib.Path, stamp_path: pathlib.Path, maildir: pathlib.Path, refresh_cb=None):
  def run_cmd(cmd, title):
    try:
      proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
      if proc.returncode == 0:
        notify_with_action(title, proc.stdout.strip() or "OK", "Open mail")
      else:
        notify_with_action(f"{title} failed", proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}", "Open mail")
    except Exception as exc:
      notify(f"{title} error", str(exc))

  def trigger_refresh():
    if refresh_cb:
      refresh_cb()

  def fetch_now():
    mark_running(status_path, stamp_path, "manual fetch")
    trigger_refresh()
    run_cmd(["systemctl", "--user", "start", "mail-sync.service"], "Mail sync started")
    trigger_refresh()

  def restart_service():
    mark_running(status_path, stamp_path, "manual restart")
    trigger_refresh()
    run_cmd(["systemctl", "--user", "restart", "mail-sync.service"], "Mail sync restarted")
    trigger_refresh()

  def show_logs():
    try:
      proc = subprocess.run(
        ["journalctl", "--user", "-u", "mail-sync.service", "-n", "40", "--no-pager"],
        capture_output=True,
        text=True,
        check=False,
      )
      body = proc.stdout.strip() or proc.stderr.strip() or "No logs"
      notify_with_action("Mail sync logs", body[-3500:], "Open mail")
    except FileNotFoundError:
      notify("Mail sync logs", "journalctl not available")

  def show_status(state):
    notify_with_action("Mail sync status", format_status(state["status"], state["counts"]), "Open mail")

  return {
    "fetch_now": fetch_now,
    "restart_service": restart_service,
    "show_logs": show_logs,
    "show_status": show_status,
  }


def main():
  parser = argparse.ArgumentParser(description="Mail sync tray icon")
  parser.add_argument("--status-file", default=os.environ.get("MAIL_SYNC_STATUS_FILE", "~/.cache/mail-sync/status.json"))
  parser.add_argument("--stamp-file", default=os.environ.get("MAIL_SYNC_STAMP_FILE", "~/.cache/mail-sync/last"))
  parser.add_argument("--maildir", default=os.environ.get("MAIL_SYNC_MAILDIR", "~/Mail"))
  parser.add_argument("--poll-seconds", type=int, default=int(os.environ.get("MAIL_SYNC_TRAY_POLL_SECONDS", "60")))
  interval_env = os.environ.get("MAIL_SYNC_INTERVAL", "")
  threshold_env = os.environ.get("MAIL_SYNC_RECENT_SECONDS", "")
  interval_secs = parse_interval(interval_env, default_seconds=1800)
  recent_default = int(threshold_env) if threshold_env else max(interval_secs * 3, 900)
  parser.add_argument("--recent-threshold", type=int, default=recent_default, help="Seconds to consider a sync recent.")
  args = parser.parse_args()
  run_tray(args)


if __name__ == "__main__":
  main()
