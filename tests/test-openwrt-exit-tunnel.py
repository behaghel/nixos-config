"""Controller orchestration tests, not proof of packet-level leak prevention."""

import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

BUNDLE = Path(sys.argv.pop(1))
CLIENT = Path(sys.argv.pop(1))
INSTALLER = Path(sys.argv.pop(1))
NODE = "nJDM8knVvy11CNTRL"

MOCK = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ["FIXTURE_STATE"])
s = json.loads(p.read_text())
n = pathlib.Path(sys.argv[0]).name
a = sys.argv[1:]
rc = 0
if n == "ls":
    import stat
    print(stat.filemode(pathlib.Path(a[-1]).stat().st_mode), "1 0 0 1 file")
elif n == "id":
    print(0 if a == ["-u"] else 453)
elif n == "uci":
    if a == ["show", "firewall"]:
        print("firewall.lan=zone\nfirewall.lan.name='lan'")
        print("firewall.guest=zone\nfirewall.guest.name='guest'")
    else:
        key = a[-1]
        values = {
            "mtkhnat.global.enable": s["accel"],
            "glconfig.general.mode": "router",
            "firewall.@defaults[0].flow_offloading": "0",
            "firewall.@defaults[0].flow_offloading_hw": "0",
            "tailscale.settings.masq": "1",
            "tailscale.settings.enabled": "1",
            "firewall.tailscale0.masq": "1",
            "dhcp.@dnsmasq[0].server": s.get("actual_dns", "9.9.9.9"),
            "dhcp.@dnsmasq[0].localuse": "0",
            "dhcp.@dnsmasq[0].queryport": "0",
        }
        for zone in ("lan", "guest"):
            prefix = "firewall.nixos_exit_" + zone
            values.update({prefix: "forwarding", prefix + ".src": zone,
                           prefix + ".name": "nixos-config exit-tunnel",
                           prefix + ".dest": "tailscale0"})
        if key in values:
            print(values[key])
        else:
            rc = 1
elif n == "iptables-save":
    rc = int(s.get("filter_unreadable", False))
    print("*filter\nCOMMIT")
elif n == "iptables":
    if "POSTROUTING" in a:
        print("-A POSTROUTING -o tailscale0 -j zone_tailscale0_postrouting")
    elif a[-1].endswith("_forward"):
        if not s.get("forwarding_missing"):
            print("-A " + a[-1] + " -j zone_tailscale0_dest_ACCEPT")
    else:
        print("-A zone_tailscale0_postrouting -j MASQUERADE")
elif n == "nft":
    if a == ["list", "tables"]:
        rc = int(s.get("nft_inventory_error", False))
        print("table inet unrelated_table")
        if s["nft"]:
            print("table inet nixos_exit_guard")
    elif "list" in a:
        if s["nft"] and not s.get("nft_read_error"):
            print(s["nft"])
        else:
            rc = 1
    elif "-f" in a:
        text = pathlib.Path(a[a.index("-f") + 1]).read_text()
        assert "flush ruleset" not in text
        assert all(line == "delete table inet nixos_exit_guard"
                   for line in text.splitlines() if line.startswith("delete"))
        if "--check" not in a:
            if s.get("fail_nft"):
                rc = 1
            else:
                if s["nft"]:
                    assert text.startswith("delete table inet nixos_exit_guard\n")
                s["nft"] = text[text.index("table inet nixos_exit_guard {"):].strip()
                s["calls"].append(["nft", s["nft"]])
elif n == "tailscale":
    if s.get("daemon_down"):
        rc = 1
    elif a == ["debug", "prefs"]:
        print(json.dumps({"ExitNodeID": s["exit"],
                          "ExitNodeAllowLANAccess": s["lan"],
                          "CorpDNS": s.get("corp_dns", False)}))
    elif a == ["status", "--json"]:
        print(json.dumps({"MagicDNSSuffix": s.get("suffix", "tail21d416.ts.net"),
                          "CurrentTailnet": {"MagicDNSEnabled": s.get("magic_dns", True)},
                          "Peer": {"peer": {
            "ID": s.get("peer_id", "nJDM8knVvy11CNTRL"),
            "TailscaleIPs": ["100.115.20.65"],
            "ExitNodeOption": s.get("approved", True),
            "Online": s.get("online", True)}}}))
    elif a[0] == "set":
        s["calls"].append(["tailscale"] + a)
        if s.get("fail_set"):
            rc = 1
        else:
            s["corp_dns"] = False
            if a[1] != "--accept-dns=false":
                s["exit"] = "nJDM8knVvy11CNTRL" if a[1].split("=", 1)[1] else ""
                s["lan"] = bool(s["exit"])
                s["default4"] = s["default6"] = bool(s["exit"])
elif n == "ubus":
    print(json.dumps({"result": {
        "mode": "auto" if s.get("dns_drift") else "manual",
        "manual_type": "manual", "manual_enable": True,
        "manual_local_dns": False, "manual_list": ["9.9.9.9"],
        "force_dns": True}}))
elif n == "jsonfilter":
    data = json.load(sys.stdin)
    value = data[a[-1].removeprefix("@.")]
    print(str(value).lower() if isinstance(value, bool) else value)
elif n == "ip":
    family = "default4" if a[0] == "-4" else "default6"
    if "get" in a:
        dev = "tailscale0" if s["default4"] and not s.get("wrong_dns_route") else "usb0"
        print("9.9.9.9 dev " + dev)
    elif "del" in a:
        rc = int(not s[family])
        if not rc:
            s[family] = False
            s["calls"].append(["remove-exit-default", family])
    elif s[family]:
        print("default dev tailscale0")
elif n == "conntrack":
    s["calls"].append(["dns-flows"] + a)
elif n not in ("logger", "sync"):
    raise AssertionError((n, a))
p.write_text(json.dumps(s))
sys.exit(rc)
'''


class TunnelTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.base = self.root / "config"
        self.base.mkdir()
        for source in BUNDLE.iterdir():
            shutil.copyfile(source, self.base / source.name)
        (self.base / "mode").write_text("off\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.state = self.root / "state.json"
        self.state.write_text(json.dumps({
            "exit": "", "lan": False, "accel": "0", "nft": "",
            "default4": False, "default6": False, "corp_dns": False, "calls": [],
            "unrelated_nft": "keep", "unrelated_routes": "keep",
        }))
        mock = self.bin / "mock"
        mock.write_text(MOCK)
        mock.chmod(0o755)
        for name in ("ls", "id", "uci", "nft", "iptables", "iptables-save",
                     "tailscale", "ubus", "jsonfilter", "ip", "conntrack",
                     "logger", "sync"):
            (self.bin / name).symlink_to(mock)
        self.controller = self.root / "controller"
        text = (self.base / "nixos-exit-node").read_text()
        text = text.replace("/etc/nixos-exit", str(self.base))
        text = text.replace("/var/run/nixos-exit-applied", str(self.root / "stamp"))
        text = text.replace("/tmp/resolv.conf", str(self.root / "resolv.conf"))
        (self.root / "resolv.conf").symlink_to(self.root / "resolv.conf.d/resolv.conf.auto")
        self.native_conf = self.root / "dnsmasq.conf"
        self.native_conf.write_text("server=/tail21d416.ts.net/100.100.100.100\n")
        text = text.replace("/etc/dnsmasq.conf", str(self.native_conf))
        self.controller.write_text(text)
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        FIXTURE_STATE=str(self.state))

    def load(self):
        return json.loads(self.state.read_text())

    def update(self, **changes):
        data = self.load()
        data.update(changes)
        self.state.write_text(json.dumps(data))

    def run_mode(self, mode, success=True):
        # Skip only the outer lock/root path; exercise the real controller body.
        result = subprocess.run(["sh", str(self.controller), "--locked", mode],
                                env=self.env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def profile(self, name):
        text = (self.base / f"{name}.nft").read_text()
        return text[text.index("table inet nixos_exit_guard {"):].strip()

    def test_arms_before_selecting_then_releases_verified_traffic(self):
        self.run_mode("on")
        data = self.load()
        self.assertEqual(data["exit"], NODE)
        calls = data["calls"]
        self.assertEqual(calls[0], ["nft", self.profile("armed")])
        self.assertEqual(calls[1][0], "tailscale")
        self.assertEqual(calls[2], ["nft", self.profile("on")])
        self.assertEqual(data["unrelated_nft"], "keep")
        self.run_mode("check")

    def test_reconciliation_is_idempotent(self):
        self.run_mode("on")
        before = self.load()
        self.run_mode("reconcile")
        self.assertEqual(self.load(), before)

    def test_unavailable_exit_can_be_selected_without_wan_fallback(self):
        self.update(online=False)
        self.run_mode("on")
        self.assertEqual(self.load()["nft"], self.profile("on"))

    def test_set_failure_retains_blocking_profile(self):
        self.update(fail_set=True)
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))
        self.assertEqual((self.base / "mode").read_text().strip(), "on")

    def test_wrong_peer_identity_never_selects_an_exit(self):
        self.update(peer_id="replacement")
        self.run_mode("on", success=False)
        self.assertFalse(any(c[0] == "tailscale" for c in self.load()["calls"]))
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_unapproved_exit_stays_blocked(self):
        self.update(approved=False)
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["exit"], "")

    def test_off_works_with_remote_peer_offline(self):
        self.run_mode("on")
        self.update(online=False)
        self.run_mode("off")
        self.run_mode("check")
        self.assertEqual(self.load()["exit"], "")
        self.assertEqual(self.load()["nft"], self.profile("off"))

    def test_off_recovers_from_dead_local_daemon(self):
        self.run_mode("on")
        self.update(daemon_down=True)
        self.run_mode("off")
        self.run_mode("check")
        data = self.load()
        self.assertFalse(data["default4"] or data["default6"])
        self.assertEqual(data["unrelated_routes"], "keep")
        self.assertEqual(data["nft"], self.profile("off"))

    def test_boot_on_blocks_before_control_plane_is_available(self):
        (self.base / "mode").write_text("on\n")
        self.update(daemon_down=True)
        self.run_mode("guard")
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_vendor_exit_reset_cannot_release_to_wan(self):
        self.run_mode("on")
        self.update(exit="", default4=False, default6=False, fail_set=True)
        self.run_mode("reconcile", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_native_dns_drift_rearms_without_changing_vendor_settings(self):
        self.run_mode("on")
        self.update(dns_drift=True)
        self.run_mode("reconcile", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_vendor_dns_takeover_is_released_before_traffic(self):
        self.run_mode("on")
        self.update(corp_dns=True)
        count = len(self.load()["calls"])
        self.run_mode("reconcile")
        calls = self.load()["calls"][count:]
        self.assertEqual(calls[0], ["nft", self.profile("armed")])
        self.assertEqual(calls[1], ["tailscale", "set", "--accept-dns=false"])
        self.assertEqual(calls[-5], ["nft", self.profile("on")])

    def test_runtime_dns_server_drift_is_not_hidden_by_ui_metadata(self):
        self.update(actual_dns="100.100.100.100")
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_broad_magicdns_forwarder_rearms_ready_policy(self):
        self.run_mode("on")
        self.native_conf.write_text("server=/ts.net/100.100.100.100\n")
        self.run_mode("reconcile", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_changed_tailnet_or_disabled_magicdns_never_releases_traffic(self):
        for changes in ({"suffix": "another.ts.net"}, {"magic_dns": False}):
            with self.subTest(changes=changes):
                self.update(suffix="tail21d416.ts.net", magic_dns=True)
                self.update(**changes)
                self.run_mode("on", success=False)
                self.assertEqual(self.load()["nft"], self.profile("armed"))
                self.assertEqual(self.load()["exit"], "")

    def test_route_mismatch_does_not_release_armed_profile(self):
        self.update(wrong_dns_route=True)
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_acceleration_rejected_before_selecting_exit(self):
        self.update(accel="1")
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["calls"], [])

    def test_unknown_acceleration_state_is_not_assumed_safe(self):
        self.update(accel="")
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["exit"], "")

    def test_unreadable_live_filter_is_not_assumed_safe(self):
        self.update(filter_unreadable=True)
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["exit"], "")

    def test_missing_native_forwarding_keeps_traffic_blocked(self):
        self.update(forwarding_missing=True)
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_failed_nft_transaction_never_selects_exit(self):
        self.update(fail_nft=True)
        self.run_mode("on", success=False)
        self.assertEqual(self.load()["exit"], "")

    def test_missing_profile_never_deletes_existing_protection(self):
        self.run_mode("on")
        (self.base / "armed.nft").unlink()
        self.update(exit="", default4=False, default6=False)
        count = len(self.load()["calls"])
        self.run_mode("reconcile", success=False)
        self.assertEqual(self.load()["nft"], self.profile("on"))
        self.assertEqual(len(self.load()["calls"]), count)

    def test_truncated_profile_cannot_replace_known_guard(self):
        self.run_mode("on")
        (self.base / "on.nft").write_text("table inet nixos_exit_guard {}\n")
        self.run_mode("guard")
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_kernel_inspection_error_is_not_treated_as_absent_table(self):
        self.run_mode("on")
        for field in ("nft_inventory_error", "nft_read_error"):
            with self.subTest(field=field):
                self.update(**{field: True})
                before = self.load()
                self.run_mode("reconcile", success=False)
                self.assertEqual(self.load(), before)
                self.update(**{field: False})

    def test_guard_drift_is_detected_without_mutation(self):
        self.run_mode("on")
        self.update(nft="unexpected")
        before = self.load()
        self.run_mode("check", success=False)
        self.assertEqual(self.load(), before)

    def test_fw3_state_is_not_the_guard_ownership_boundary(self):
        self.run_mode("on")
        # The fixture intentionally has no iptables guard state at all.
        self.run_mode("guard")
        self.run_mode("check")
        self.assertEqual(self.load()["nft"], self.profile("on"))

    def test_unknown_persistent_mode_arms_instead_of_opening(self):
        (self.base / "mode").write_text("invalid\n")
        self.run_mode("guard")
        self.assertEqual(self.load()["nft"], self.profile("armed"))

    def test_guest_isolation_applies_before_mode_routing_in_every_profile(self):
        for mode in ("armed", "on", "off"):
            with self.subTest(mode=mode):
                forward = re.search(r"chain forward \{(.*?)\n\s*\}",
                                    self.profile(mode), re.S)[1]
                dispatch = re.search(
                    r'iifname \{([^}]+)\} jump isolate_clients', forward)
                self.assertIsNotNone(dispatch)
                self.assertEqual(set(re.findall(r'"([^"]+)"', dispatch[1])),
                                 {"br-guest", "br-iot"})
                if mode != "off":
                    self.assertLess(forward.index("jump isolate_clients"),
                                    forward.index('oifname "tailscale0" accept')
                                    if mode == "on" else forward.index("counter reject"))

    def test_private_destination_sets_cover_guest_targets_not_public_internet(self):
        for mode in ("armed", "on", "off"):
            text = self.profile(mode)
            chain = re.search(r"chain isolate_clients \{(.*?)\n\s*\}",
                              text, re.S)
            self.assertIsNotNone(chain, mode)
            prefixes = []
            for group in re.findall(r"ip6? daddr \{([^}]+)\} counter reject", chain[1]):
                prefixes.extend(ipaddress.ip_network(p.strip())
                                for p in group.split(","))
            for address in ("10.0.0.1", "172.16.0.1", "192.168.1.199",
                            "100.115.20.65", "169.254.169.254", "fd7a:115c:a1e0::1",
                            "fe80::1"):
                ip = ipaddress.ip_address(address)
                self.assertTrue(any(ip in p for p in prefixes if p.version == ip.version),
                                (mode, address))
            for address in ("9.9.9.9", "1.1.1.1", "2606:4700:4700::1111"):
                ip = ipaddress.ip_address(address)
                self.assertFalse(any(ip in p for p in prefixes if p.version == ip.version),
                                 (mode, address))

    def test_guest_reply_exception_returns_to_normal_guard_without_accepting(self):
        for mode in ("armed", "on", "off"):
            text = self.profile(mode)
            chain = re.search(r"chain isolate_clients \{(.*?)\n\s*\}", text, re.S)
            self.assertIsNotNone(chain)
            statements = [line.strip() for line in chain[1].splitlines()
                          if line.strip() and not line.strip().startswith("#")]
            self.assertEqual(statements[0], "ct direction reply return")
            self.assertFalse(any("accept" in line for line in statements))
            # Original-direction packets remain denied even if established;
            # untracked packets cannot bypass the unconditional address checks.
            self.assertNotIn("ct state new", chain[1])
            self.assertNotIn("hook input", text)

    def test_unknown_ingress_is_not_given_on_mode_tunnel_access(self):
        forward = re.search(r"chain forward \{(.*?)\n\s*\}",
                            self.profile("on"), re.S)[1]
        self.assertRegex(forward, r'iifname \{[^}]+\} oifname "tailscale0" accept')

    def test_profiles_are_interface_independent_for_external_forwarding(self):
        on = self.profile("on")
        forward = re.search(r"chain forward \{(.*?)\n\s*\}", on, re.S)[1]
        self.assertIn('iifname "tailscale0" accept', forward)
        self.assertIn('oifname "tailscale0" accept', forward)
        self.assertIn("meta nfproto ipv6 counter reject", forward)
        self.assertTrue(forward.strip().endswith("counter reject"))
        self.assertNotIn('oifname "br*"', on)
        output = re.search(r"chain output \{(.*?)\n\s*\}", on, re.S)[1]
        self.assertLess(output.index("meta skuid 453 udp dport 53 counter reject"),
                        output.index("udp dport 53 accept"))
        self.assertNotIn("5354", on)

    def scope(self, operation, text):
        return subprocess.run(
            ["lua", str(self.base / "native-dns.lua"), operation,
             "tail21d416.ts.net"], input=text, text=True, capture_output=True)

    def test_scope_preserves_other_settings_and_narrows_vendor_forwarder(self):
        original = "# existing\nlocal=/lan/\nserver=/ts.net/100.100.100.100\n"
        expected = original.replace("/ts.net/", "/tail21d416.ts.net/")
        result = self.scope("scope", original)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, expected)
        self.assertEqual(self.scope("scope", expected).stdout, expected)
        self.assertEqual(self.scope("scope-check", expected).returncode, 0)
        self.assertNotEqual(self.scope("scope-check", original).returncode, 0)
        # The vendor's presence check must recognize the scoped line too.
        self.assertIn("ts.net/100.100.100.100", result.stdout)

    def test_scope_consolidates_only_known_duplicate_forwarders(self):
        broad = "server=/ts.net/100.100.100.100\n"
        scoped = "server=/tail21d416.ts.net/100.100.100.100\n"
        self.assertEqual(self.scope("scope", broad + scoped).stdout, scoped)
        self.assertNotEqual(self.scope("scope-check", broad + scoped).returncode, 0)

    def test_missing_magicdns_forwarder_is_not_silently_invented(self):
        for operation in ("scope", "scope-check"):
            result = self.scope(operation, "local=/lan/\n")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")

    def test_scope_refuses_unmanaged_quad100_forwarders(self):
        text = "server=/external.example/100.100.100.100\n"
        result = self.scope("scope", text)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_direct_quad100_queries_are_blocked_before_tunnel_accept(self):
        forward = re.search(r"chain forward \{(.*?)\n\s*\}",
                            self.profile("on"), re.S)[1]
        for protocol in ("udp", "tcp"):
            rule = f"ip daddr 100.100.100.100 {protocol} dport 53 counter reject"
            self.assertIn(rule, forward)
            self.assertLess(forward.index(rule),
                            forward.index('oifname "tailscale0" accept'))

    def test_native_resolver_can_query_scoped_magicdns(self):
        on = self.profile("on")
        for protocol in ("udp", "tcp"):
            self.assertIn('meta skuid 453 ip daddr 100.100.100.100 '
                          f'oifname "tailscale0" {protocol} dport 53 counter accept',
                          on)

    def test_native_dns_payload_preserves_unrelated_settings(self):
        original = {"result": {"mode": "auto", "provider": "preserve-me",
                               "proxy_list": ["existing-entry"],
                               "manual_list": [], "force_dns": False}}
        helper = self.base / "native-dns.lua"
        result = subprocess.run(["lua", str(helper), "payload", "9.9.9.9"],
                                input=json.dumps(original), text=True,
                                capture_output=True, check=True)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["func"], "set_config")
        config = payload["params"]
        self.assertEqual(config["provider"], "preserve-me")
        self.assertEqual(config["proxy_list"], ["existing-entry"])
        self.assertFalse(config["manual_local_dns"])
        self.assertEqual(config["manual_list"], ["9.9.9.9"])
        checked = subprocess.run(["lua", str(helper), "check", "9.9.9.9"],
                                 input=json.dumps({"result": config}), text=True)
        self.assertEqual(checked.returncode, 0)

    def test_native_dns_restore_preserves_previous_configuration(self):
        original = {"result": {"mode": "auto", "force_dns": False,
                               "provider": "existing", "manual_local_dns": True}}
        result = subprocess.run(
            ["lua", str(self.base / "native-dns.lua"), "restore", "9.9.9.9"],
            input=json.dumps(original), text=True, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)["params"], original["result"])

    def test_owned_lua_and_nft_files_reapply_without_mutation(self):
        text = INSTALLER.read_text()
        start = text.index("write_owned() {")
        function = text[start:text.index("\n}\n", start) + 3]
        shim = self.root / "writer"
        shim.write_text('set -eu\nmode=apply\nchanged=0\n'
                        'fail() { echo "$*" >&2; exit 1; }\n'
                        + function + '\nwrite_owned "$1" 0644\necho "$changed"\n')
        for source in ("native-dns.lua", "on.nft"):
            target = self.root / ("owned-" + source)
            for expected in ("1", "0"):
                result = subprocess.run(["sh", str(shim), str(target)],
                                        input=(self.base / source).read_text(),
                                        env=self.env, text=True,
                                        capture_output=True, check=True)
                self.assertEqual(result.stdout.strip(), expected)
        target.write_text("unrelated\n")
        result = subprocess.run(["sh", str(shim), str(target)], input="replacement",
                                env=self.env, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_text(), "unrelated\n")

    def test_transport_passes_one_command_without_literal_backslash(self):
        fake = self.root / "ssh"
        fake.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
        fake.chmod(0o755)
        client = self.root / "client"
        text = CLIENT.read_text().replace("exec ssh -F", f'exec "{fake}" -F')
        client.write_text(text)
        result = subprocess.run(["bash", str(client), "on"], text=True,
                                capture_output=True, check=True)
        args = result.stdout.splitlines()
        self.assertEqual(args[-1], "/usr/sbin/nixos-exit-node on")
        self.assertNotIn("\\", args)


if __name__ == "__main__":
    unittest.main()
