"""Crownfall (Claude track) - drive the user's installed Meshy MCP server (@meshy-ai/meshy-mcp-server) over stdio.

The server and its MESHY_API_KEY come from ~/.claude.json (mcpServers["meshy-mcp-server"]); the key is never printed.
Usage:
  python -I scripts/meshy_mcp.py schema <tool> [<tool> ...]
  python -I scripts/meshy_mcp.py call <tool> '<json args>'   (or @file.json)
  python -I scripts/meshy_mcp.py batch <calls.json>           [{"tool":..., "args":{...}, "tag":...}, ...] -> results json on stdout
"""
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time


def _redact(s):
    return re.sub(r"msy_\w+", "msy_***", s)


class Meshy:
    def __init__(self):
        cfg = json.load(open(os.path.expanduser("~/.claude.json"), encoding="utf-8"))["mcpServers"]["meshy-mcp-server"]
        env = dict(os.environ, **cfg.get("env", {}))
        self.p = subprocess.Popen([cfg["command"]] + cfg["args"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, env=env)
        self.q = queue.Queue()
        threading.Thread(target=lambda: [self.q.put(l) for l in iter(self.p.stdout.readline, b"")], daemon=True).start()
        self.i = 0
        r = self.req("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                    "clientInfo": {"name": "crownfall-claude", "version": "1"}}, 180)
        if r is None:
            raise RuntimeError("meshy server did not initialize")
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _send(self, o):
        self.p.stdin.write((json.dumps(o) + "\n").encode())
        self.p.stdin.flush()

    def req(self, method, params=None, timeout=300):
        self.i += 1
        rid = self.i
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        end = time.time() + timeout
        while time.time() < end:
            try:
                m = json.loads(self.q.get(timeout=1))
            except queue.Empty:
                continue
            except ValueError:
                continue
            if m.get("id") == rid:
                return m
        return None

    def tools(self):
        return (self.req("tools/list") or {}).get("result", {}).get("tools", [])

    def call(self, tool, args, timeout=900):
        r = self.req("tools/call", {"name": tool, "arguments": args}, timeout)
        if r is None:
            return {"error": "timeout"}
        if "error" in r:
            return {"error": r["error"]}
        res = r.get("result", {})
        out = {"text": "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text"),
               "structured": res.get("structuredContent"), "isError": res.get("isError", False)}
        return out

    def close(self):
        try:
            self.p.kill()
        except Exception:
            pass


def main():
    cmd = sys.argv[1]
    m = Meshy()
    try:
        if cmd == "schema":
            want = set(sys.argv[2:])
            for t in m.tools():
                if not want or t["name"] in want:
                    print(json.dumps({"name": t["name"], "description": t.get("description", "")[:1500],
                                      "inputSchema": t.get("inputSchema")}, indent=1))
        elif cmd == "call":
            a = sys.argv[3]
            args = json.load(open(a[1:])) if a.startswith("@") else json.loads(a)
            print(_redact(json.dumps(m.call(sys.argv[2], args), indent=1)))
        elif cmd == "batch":
            calls = json.load(open(sys.argv[2]))
            out = []
            for c in calls:
                r = m.call(c["tool"], c["args"])
                out.append({"tag": c.get("tag"), "tool": c["tool"], "result": r})
                print(_redact(json.dumps(out[-1]))[:400], file=sys.stderr, flush=True)
            print(_redact(json.dumps(out, indent=1)))
    finally:
        m.close()


if __name__ == "__main__":
    main()
