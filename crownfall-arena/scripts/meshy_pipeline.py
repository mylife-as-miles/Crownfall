"""Crownfall (Claude track) - Meshy generation pipeline with a state file so no task is ever submitted (paid) twice.

State: assets/CFCL_Meshy/state.json  {tag: {"image_task", "image_file", "model_task", "model_file", ...}}
Usage (python -I, PYTHONIOENCODING=utf-8):
  scripts/meshy_pipeline.py images [tags...]          submit missing concept images, wait, download
  scripts/meshy_pipeline.py to3d <tag> [<tag>...]      image-to-3D (textured, PBR) from the concept image task
  scripts/meshy_pipeline.py multi <tag> <img>...       multi-image-to-3D from local reference views
  scripts/meshy_pipeline.py wait                       wait for + download every unfinished model task
  scripts/meshy_pipeline.py adopt <tag> image <task_id>  record a task submitted outside the pipeline
  scripts/meshy_pipeline.py balance
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from meshy_mcp import Meshy, _redact  # noqa: E402

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(CL, "assets", "CFCL_Meshy")
STATE = os.path.join(ROOT, "state.json")
CALLS = os.path.join(ROOT, "_concepts", "calls_images.json")

# per-tag 3D settings (VR budget: hero 60k, props 12-30k triangles)
POLY = {"skull": 60000, "hand": 60000, "rib_a": 20000, "rib_b": 20000, "landmass_a": 30000, "landmass_b": 25000,
        "roots_a": 20000, "roots_b": 20000, "coral_tree": 25000, "coral_shrub": 12000, "crimson_bush": 12000,
        "fungus": 10000}
TEXP = {
    "skull": "colossal ancient fossilized skull, pale warm bone turned to stone, dark mineral staining in eye sockets "
             "and sutures, eroded fractures, green moss and dirt where it sits in the ground",
    "hand": "colossal ancient carved stone hand, weathered grey-green stone, cracks and chipped knuckles, moss in the "
            "creases, a heavy rusted iron cuff with a broken chain around the wrist",
}


def load():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save(s):
    os.makedirs(ROOT, exist_ok=True)
    tmp = STATE + ".tmp"
    json.dump(s, open(tmp, "w"), indent=1)
    os.replace(tmp, STATE)


def sj(r):
    """structured content of a tool result, else parsed text."""
    if r.get("structured"):
        return r["structured"]
    try:
        return json.loads(r.get("text", ""))
    except ValueError:
        return {"raw": r.get("text", "")[:800], "isError": r.get("isError")}


def wait_task(m, tid, ttype, timeout=1500):
    """poll in <=300 s chunks (the server's cap) until SUCCEEDED / FAILED / CANCELED or `timeout`."""
    end, r = time.time() + timeout, {}
    while time.time() < end:
        r = sj(m.call("meshy_get_task_status", {"task_id": tid, "task_type": ttype, "wait": True,
                                                "timeout_seconds": 300, "response_format": "json"}, 420))
        if r.get("status") in ("SUCCEEDED", "FAILED", "CANCELED"):
            return r
        if r.get("isError"):
            time.sleep(10)
    return r


def download(m, tid, ttype, dest_file, fmt=None):
    os.makedirs(os.path.dirname(dest_file), exist_ok=True)
    a = {"task_id": tid, "task_type": ttype, "save_to": dest_file}
    if fmt:
        a.update(format=fmt, include_textures=True)
    return m.call("meshy_download_model", a, 900)


def cmd_images(m, s, tags):
    calls = {c["tag"]: c for c in json.load(open(CALLS))}
    tags = tags or list(calls)
    for t in tags:
        e = s.setdefault(t, {})
        if not e.get("image_task"):
            r = sj(m.call("meshy_text_to_image", calls[t]["args"]))
            e["image_task"] = r.get("task_id")
            e["image_submit"] = r
            save(s)
            print("submitted image", t, e["image_task"], flush=True)
    for t in tags:
        e = s[t]
        if e.get("image_file") or not e.get("image_task"):
            continue
        st = wait_task(m, e["image_task"], "text-to-image", 600)
        e["image_status"] = st.get("status") or st
        d = download(m, e["image_task"], "text-to-image", os.path.join(ROOT, "_concepts", t, t + ".png"))
        e["image_download"] = _redact(d.get("text", ""))[:600]
        files = [os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(ROOT, "_concepts", t)) for f in fs
                 if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        e["image_file"] = files[0] if files else None
        save(s)
        print("image", t, e["image_status"] if isinstance(e["image_status"], str) else "?", e["image_file"], flush=True)


def submit3d(m, s, t, args, ttype):
    e = s.setdefault(t, {})
    if e.get("model_task"):
        print("already submitted", t, e["model_task"])
        return
    r = sj(m.call("meshy_multi_image_to_3d" if ttype == "multi-image-to-3d" else "meshy_image_to_3d", args))
    e["model_task"], e["model_type"], e["model_submit"] = r.get("task_id"), ttype, r
    save(s)
    print("submitted 3d", t, e["model_task"], flush=True)


def common3d(t):
    a = {"ai_model": "latest", "enable_pbr": True, "should_remesh": True, "topology": "triangle",
         "target_polycount": POLY.get(t, 20000), "target_formats": ["glb"], "response_format": "json"}
    if t in TEXP:
        a["texture_prompt"] = TEXP[t]
    return a


def cmd_wait(m, s):
    for t, e in s.items():
        if not e.get("model_task") or e.get("model_file"):
            continue
        st = wait_task(m, e["model_task"], e["model_type"], 1800)
        e["model_status"] = st.get("status") or st
        if e["model_status"] != "SUCCEEDED":
            save(s)
            print("model", t, "NOT DONE", json.dumps(st)[:300], flush=True)
            continue
        d = download(m, e["model_task"], e["model_type"], os.path.join(ROOT, t, t + ".glb"), "glb")
        e["model_download"] = _redact(d.get("text", ""))[:600]
        glbs = [os.path.join(dp, f) for dp, _, fs in os.walk(os.path.join(ROOT, t)) for f in fs if f.endswith(".glb")]
        e["model_file"] = glbs[0] if glbs else None
        save(s)
        print("model", t, e["model_file"], flush=True)


def main():
    cmd, rest = sys.argv[1], sys.argv[2:]
    s = load()
    m = Meshy()
    try:
        if cmd == "adopt":
            s.setdefault(rest[0], {})[rest[1] + "_task"] = rest[2]
            save(s)
        elif cmd == "images":
            cmd_images(m, s, rest)
        elif cmd == "to3d":
            for t in rest:
                a = common3d(t)
                a["input_task_id"] = s[t]["image_task"]
                submit3d(m, s, t, a, "image-to-3d")
        elif cmd == "multi":
            t, imgs = rest[0], [os.path.abspath(p) for p in rest[1:]]
            a = common3d(t)
            a["file_paths"] = imgs
            a["geometry_resolution"] = "2k"
            submit3d(m, s, t, a, "multi-image-to-3d")
        elif cmd == "wait":
            cmd_wait(m, s)
        elif cmd == "balance":
            print(_redact(m.call("meshy_check_balance", {"response_format": "json"}).get("text", "")))
    finally:
        m.close()


if __name__ == "__main__":
    main()
