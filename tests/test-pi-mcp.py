"""Check Pi's project MCP configuration and optional real server queries."""

import json
import os
from pathlib import Path
import selectors
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".pi/mcp.json"


def server_config():
    return json.loads(CONFIG.read_text())["mcpServers"]["nixos"]


class ProjectConfigTests(unittest.TestCase):
    def test_project_server_is_pinned_and_needs_no_credentials(self):
        server = server_config()
        self.assertEqual(server["command"], "nix")
        self.assertEqual(server["args"][0], "shell")
        self.assertRegex(
            server["args"][1],
            r"^github:utensils/mcp-nixos/[0-9a-f]{40}#mcp-nixos$",
        )
        self.assertEqual(server["args"][2:], ["--command", "mcp-nixos"])
        self.assertEqual(server["exposure"], "direct")
        self.assertNotIn("env", server)
        self.assertNotIn("headers", server)
        self.assertNotEqual(server.get("enabled"), False)


@unittest.skipUnless(os.environ.get("MCP_NIXOS_LIVE") == "1", "live opt-in")
class LiveServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = server_config()
        cls.stderr = tempfile.TemporaryFile()
        cls.process = subprocess.Popen(
            [config["command"], *config["args"]],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=cls.stderr,
        )
        cls.addClassCleanup(cls.close_server)
        cls.selector = selectors.DefaultSelector()
        cls.selector.register(cls.process.stdout, selectors.EVENT_READ)
        cls.pending = b""
        cls.sequence = 0
        cls.call("initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "pi-mcp-smoke", "version": "1"},
        })
        cls.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    @classmethod
    def close_server(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()
        cls.process.stdin.close()
        cls.process.stdout.close()
        cls.stderr.close()
        cls.selector.close()

    @classmethod
    def send(cls, value):
        cls.process.stdin.write(json.dumps(value).encode() + b"\n")
        cls.process.stdin.flush()

    @classmethod
    def call(cls, method, params):
        cls.sequence += 1
        request_id = cls.sequence
        cls.send({"jsonrpc": "2.0", "id": request_id,
                  "method": method, "params": params})
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if b"\n" in cls.pending:
                line, cls.pending = cls.pending.split(b"\n", 1)
                response = json.loads(line)
                if response.get("id") == request_id:
                    if "error" in response:
                        raise AssertionError(response["error"])
                    return response["result"]
                continue
            if cls.selector.select(timeout=1):
                chunk = os.read(cls.process.stdout.fileno(), 65536)
                if not chunk:
                    cls.stderr.seek(0)
                    raise AssertionError(cls.stderr.read().decode())
                cls.pending += chunk
        raise AssertionError(f"MCP request timed out: {method}")

    def query(self, arguments):
        result = self.call("tools/call", {"name": "nix",
                                           "arguments": arguments})
        self.assertFalse(result.get("isError"), result)
        return "\n".join(
            item["text"] for item in result["content"]
            if item.get("type") == "text"
        )

    def test_tools_are_discoverable(self):
        tools = self.call("tools/list", {})["tools"]
        self.assertIn("nix", {tool["name"] for tool in tools})

    def test_online_home_manager_option_search(self):
        text = self.query({"action": "search", "source": "home-manager",
                           "type": "option", "query": "programs.tmux.enable"})
        self.assertIn("programs.tmux.enable", text)

    def test_pinned_package_source_matches_local_evaluation(self):
        text = self.query({
            "action": "flake-inputs", "type": "read",
            "query": "nixpkgs:pkgs/by-name/de/devenv/package.nix",
        })
        expression = '''let
          lock = builtins.fromJSON (builtins.readFile ./flake.lock);
          root = lock.nodes.${lock.root};
          src = builtins.fetchTree lock.nodes.${root.inputs.nixpkgs}.locked;
          pkgs = import src.outPath { system = builtins.currentSystem; };
        in pkgs.devenv.version'''
        version = subprocess.check_output(
            ["nix", "eval", "--impure", "--raw", "--expr", expression],
            cwd=ROOT, text=True, timeout=120,
        ).strip()
        self.assertIn(f'version = "{version}"', text)

    def test_pinned_home_manager_source_is_readable(self):
        text = self.query({"action": "flake-inputs", "type": "read",
                           "query": "home-manager:modules/programs/tmux.nix"})
        self.assertIn("mkEnableOption", text)
        self.assertIn("programs.tmux", text)


if __name__ == "__main__":
    unittest.main()
