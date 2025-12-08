import pathlib
import tempfile
import os
import subprocess
import sys

import mail_tray as tray


def test_parse_interval():
  assert tray.parse_interval("10m") == 600
  assert tray.parse_interval("2h") == 7200
  assert tray.parse_interval("15s") == 15
  assert tray.parse_interval("bad", default_seconds=42) == 42


def test_flags_and_counts(tmp_path: pathlib.Path):
  inbox = tmp_path / "account" / "inbox"
  (inbox / "new").mkdir(parents=True)
  (inbox / "cur").mkdir()

  # unread in new
  (inbox / "new" / "msg1").write_text("")
  # unread in cur (no S flag)
  (inbox / "cur" / "msg2:2,").write_text("")
  # read in cur
  (inbox / "cur" / "msg3:2,S").write_text("")

  counts = tray.count_inbox(inbox)
  assert counts.unread == 2
  assert counts.total == 3


def test_collect_inboxes(tmp_path: pathlib.Path):
  maildir = tmp_path / "Mail"
  (maildir / "acc1" / "inbox").mkdir(parents=True)
  counts = tray.collect_inboxes(maildir)
  assert "acc1/inbox" in counts


def test_format_status_and_choice(tmp_path: pathlib.Path):
  status = tray.RunStatus(status="ok", message="", last_attempt=0, last_success=0)
  counts = {"acc/inbox": tray.InboxCount(unread=1, total=2)}
  summary = tray.format_status(status, counts)
  assert "1 unread / 2 total" in summary
  kind = tray.choose_kind(status, recent_threshold=10)
  assert kind in {"stale", "ok"}


def test_typelibs_available():
  import gi

  assert os.environ.get("GI_TYPELIB_PATH"), "GI_TYPELIB_PATH not set"
  gi.require_version("Pango", "1.0")
  gi.require_version("Gtk", "3.0")


def test_pystray_imports_with_gi_env():
  env = os.environ.copy()
  env["PYSTRAY_BACKEND"] = "dummy"
  typelib_path = env.get("MAIL_TRAY_GI_TYPELIB_PATH") or env.get("GI_TYPELIB_PATH")
  if typelib_path:
    env["GI_TYPELIB_PATH"] = typelib_path
  proc = subprocess.run(
    [sys.executable, "-c", "import pystray; print(pystray.Icon)"],
    env=env,
    capture_output=True,
    text=True,
  )
  assert proc.returncode == 0, proc.stderr


def test_load_pystray_falls_back_to_dummy(monkeypatch):
  monkeypatch.setenv("PYSTRAY_BACKEND", "appindicator")
  monkeypatch.delenv("GI_TYPELIB_PATH", raising=False)
  # Simulate missing GI by pointing to empty dir
  monkeypatch.setenv("MAIL_TRAY_GI_TYPELIB_PATH", "/nonexistent")
  pystray_mod, backend = tray.load_pystray()
  assert backend in ("dummy", None)


def test_set_icon_menu_handles_not_implemented(capsys):
  class DummyIcon:
    def __init__(self):
      self.menu = None

    @property
    def menu(self):
      return self._menu

    @menu.setter
    def menu(self, value):
      raise NotImplementedError()

  icon = DummyIcon()
  ok = tray.set_icon_menu(icon, "menu")
  assert ok is False
  out = capsys.readouterr().out
  assert "backend does not support menus" in out


def test_run_tray_exits_on_dummy_backend(monkeypatch, capsys, tmp_path):
  def fake_load():
    class FakeIcon:
      def __init__(self, name):
        self.name = name
      def run(self, setup=None):
        raise NotImplementedError()
    class FakeMenu:
      def __init__(self, *args, **kwargs):
        pass
    class FakeMenuItem:
      def __init__(self, *args, **kwargs):
        pass
    fake = type("FakePystray", (), {"Icon": FakeIcon, "Menu": FakeMenu, "MenuItem": FakeMenuItem})
    return fake, "dummy"

  monkeypatch.setenv("MAIL_SYNC_STATUS_FILE", str(tmp_path / "status.json"))
  monkeypatch.setenv("MAIL_SYNC_STAMP_FILE", str(tmp_path / "stamp"))
  monkeypatch.setenv("MAIL_SYNC_MAILDIR", str(tmp_path / "mail"))

  monkeypatch.setattr(tray, "load_pystray", fake_load)
  # avoid sleep loop by limiting poll interval
  args = argparse.Namespace(
    status_file=os.environ["MAIL_SYNC_STATUS_FILE"],
    stamp_file=os.environ["MAIL_SYNC_STAMP_FILE"],
    maildir=os.environ["MAIL_SYNC_MAILDIR"],
    poll_seconds=1,
    recent_threshold=10,
  )
  tray.run_tray(args)
  out = capsys.readouterr().out
  assert "dummy backend active" in out


def test_run_tray_dummy_loops_unless_exit(monkeypatch, tmp_path):
  def fake_load():
    class FakeIcon:
      def __init__(self, name):
        self.name = name
      def run(self, setup=None):
        raise NotImplementedError()
    class FakeMenu:
      def __init__(self, *args, **kwargs):
        pass
    class FakeMenuItem:
      def __init__(self, *args, **kwargs):
        pass
    fake = type("FakePystray", (), {"Icon": FakeIcon, "Menu": FakeMenu, "MenuItem": FakeMenuItem})
    return fake, "dummy"

  monkeypatch.setenv("MAIL_SYNC_STATUS_FILE", str(tmp_path / "status.json"))
  monkeypatch.setenv("MAIL_SYNC_STAMP_FILE", str(tmp_path / "stamp"))
  monkeypatch.setenv("MAIL_SYNC_MAILDIR", str(tmp_path / "mail"))
  monkeypatch.setattr(tray, "load_pystray", fake_load)
  monkeypatch.setenv("MAIL_TRAY_DUMMY_EXIT", "1")
  args = argparse.Namespace(
    status_file=os.environ["MAIL_SYNC_STATUS_FILE"],
    stamp_file=os.environ["MAIL_SYNC_STAMP_FILE"],
    maildir=os.environ["MAIL_SYNC_MAILDIR"],
    poll_seconds=1,
    recent_threshold=10,
  )
  tray.run_tray(args)


def test_missing_typelibs_blocks_when_not_allowed(monkeypatch, capsys, tmp_path):
  monkeypatch.setenv("MAIL_SYNC_STATUS_FILE", str(tmp_path / "status.json"))
  monkeypatch.setenv("MAIL_SYNC_STAMP_FILE", str(tmp_path / "stamp"))
  monkeypatch.setenv("MAIL_SYNC_MAILDIR", str(tmp_path / "mail"))
  monkeypatch.delenv("GI_TYPELIB_PATH", raising=False)
  monkeypatch.delenv("MAIL_TRAY_GI_TYPELIB_PATH", raising=False)
  monkeypatch.setenv("MAIL_TRAY_ALLOW_DUMMY", "0")
  monkeypatch.setenv("PYSTRAY_BACKEND", "dummy")
  args = argparse.Namespace(
    status_file=os.environ["MAIL_SYNC_STATUS_FILE"],
    stamp_file=os.environ["MAIL_SYNC_STAMP_FILE"],
    maildir=os.environ["MAIL_SYNC_MAILDIR"],
    poll_seconds=1,
    recent_threshold=10,
  )
  tray.run_tray(args)
  out = capsys.readouterr().out
  assert "missing typelibs" in out
