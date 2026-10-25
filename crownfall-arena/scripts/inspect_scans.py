"""Import one downloaded scan (OBJ with its MTL textures, or STL), report size and tris, and render reference views.
Usage: python lib/run_blender.py scripts/inspect_scans.py -- <scan_folder> [dist_mult] [views]
  views: comma list of name:azimuth:elevation (default four sides plus top)"""
import glob
import json
import math
import os
import sys

CL =r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy  # noqa: E402
import cf_render as R  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
SCAN = argv[0]
DM = float(argv[1]) if len(argv) > 1 else 1.3
VIEWS = tuple((v.split(":")[0], float(v.split(":")[1]), float(v.split(":")[2])) for v in argv[2].split(",")) if len(argv) > 2 \
    else (("front", 0, 10), ("left", 90, 10), ("back", 180, 10), ("right", -90, 10), ("top", 0, 85))
root = os.path.join(CL, "vendor", "scans", SCAN, "source")
src = (glob.glob(os.path.join(root, "*", "*.obj")) + glob.glob(os.path.join(root, "*", "*.stl")))[0]
R.reset_scene()
if src.lower().endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=src, forward_axis="NEGATIVE_Z", up_axis="Y")
else:
    bpy.ops.wm.stl_import(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mn, mx = R.bounds(objs)
info = {"scan": SCAN, "file": os.path.basename(src), "objects": len(objs), "tris": R.tri_count(objs),
        "bbox_min": list(mn), "bbox_max": list(mx), "size": list(mx - mn),
        "materials": sorted({m.name for o in objs for m in o.data.materials if m})}
print("SCANINFO", json.dumps(info))
out = os.path.join(CL, "renders", "scans", SCAN)
os.makedirs(out, exist_ok=True)
R.write_json(os.path.join(out, "info.json"), info)
sc = bpy.context.scene
R.setup_world(sc, top=(0.42, 0.42, 0.42), horizon=(0.5, 0.5, 0.5), strength=1.0)
R.turntable(objs, os.path.join(out, SCAN), views=VIEWS, lens=50.0, dist_mult=DM, res=(1024, 768), samples=32, ground=False)
