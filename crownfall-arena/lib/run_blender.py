"""Run a Blender script headless, gated by a 2-slot machine-wide lock.

Usage (system python):
    python lib/run_blender.py <script.py> [--timeout 1800] [-- script args...]

- Never connects to any MCP port; launches `blender -b --factory-startup`.
- At most MAX_SLOTS of our Blender processes run at once (RAM is tight and
  Codex's live Blender session must stay responsive).  Waits for a slot.
- Full log goes to logs/<script>_<time>.log; prints a filtered tail.
- Exit code mirrors Blender's (non-zero on Python exception).
"""
import os
import subprocess
import sys
import time

BLENDER = r"C:\Users\MILES\AppData\Local\Programs\Blender Foundation\Blender 5.2\blender.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
CL = os.path.dirname(HERE)
LOCKDIR = os.path.join(CL, ".locks")
LOGDIR = os.path.join(CL, "logs")
MAX_SLOTS = 2


def pid_alive(pid):
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    except Exception:
        return True


def acquire():
    os.makedirs(LOCKDIR, exist_ok=True)
    waited = 0
    while True:
        for i in range(MAX_SLOTS):
            p = os.path.join(LOCKDIR, f"slot{i}.lock")
            if os.path.exists(p):
                try:
                    pid = int(open(p).read().split()[0])
                    if not pid_alive(pid):
                        os.remove(p)
                except Exception:
                    pass
            try:
                fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, f"{os.getpid()} {time.time()}".encode())
                os.close(fd)
                return p
            except FileExistsError:
                continue
        if waited % 60 == 0:
            print(f"[run_blender] waiting for a Blender slot ({waited}s)...", flush=True)
        time.sleep(5)
        waited += 5


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    timeout = 1800
    if "--timeout" in args:
        i = args.index("--timeout")
        timeout = int(args[i + 1])
        del args[i:i + 2]
    script = os.path.abspath(args[0])
    extra = args[1:]
    if extra and extra[0] == "--":
        extra = extra[1:]
    os.makedirs(LOGDIR, exist_ok=True)
    log = os.path.join(LOGDIR, f"{os.path.splitext(os.path.basename(script))[0]}_{time.strftime('%H%M%S')}.log")
    lock = acquire()
    t0 = time.time()
    try:
        cmd = [BLENDER, "-b", "--factory-startup", "--python-exit-code", "1", "--python", script, "--"] + extra
        with open(log, "w", encoding="utf-8", errors="replace") as f:
            try:
                rc = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, timeout=timeout).returncode
            except subprocess.TimeoutExpired:
                rc = 124
                f.write(f"\n[run_blender] TIMEOUT after {timeout}s\n")
    finally:
        try:
            os.remove(lock)
        except OSError:
            pass
    dt = time.time() - t0
    lines = open(log, encoding="utf-8", errors="replace").read().splitlines()
    keep = [l for l in lines if not (l.startswith("Fra:") or "| Sample" in l or l.strip() == "" or "Shadow buffer full" in l)]
    print("\n".join(keep[-60:]))
    print(f"[run_blender] exit={rc} time={dt:.0f}s log={log}", flush=True)
    sys.exit(rc)


if __name__ == "__main__":
    main()
