"""Combined check: open a main build (read-only, never saved), replace any auto-included CFCL_Tools_* copies with the
latest tool assets placed with the env transform (world = env*4.6 + (0,0,1.94)), hide the RuinsKit pieces the
arches replace, render the hero + god cameras.
Usage: python lib/run_blender.py scripts/tools_combined_check.py --timeout 3000 -- <main_version|latest> <tag> [views] [hide_farcliffs 0/1]
"""
import sys, os, glob, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MAINV = argv[0] if argv else "latest"
TAG = argv[1] if len(argv) > 1 else "check01"
VIEWS = argv[2].split(",") if len(argv) > 2 else ["hero", "god"]
HIDE_FAR = (argv[3] == "1") if len(argv) > 3 else False
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
mains = sorted(glob.glob(os.path.join(CL, "main", "Crownfall_Main_v[0-9][0-9][0-9].blend")))
path = mains[-1] if MAINV == "latest" else os.path.join(CL, "main", f"Crownfall_Main_{MAINV}.blend")
bpy.ops.wm.open_mainfile(filepath=path, load_ui=False)
import tools_common as T
import cf_render as R
import cf_integrate as I

LOG = {"main": os.path.basename(path), "tag": TAG, "hidden": [], "added": {}, "warnings": []}
sc = bpy.context.scene
OUT = os.path.join(CL, "renders", "tools", "combined")
os.makedirs(OUT, exist_ok=True)
TOOLS = ["CFCL_Tools_FarLandscape", "CFCL_Tools_Arches", "CFCL_Tools_Trees", "CFCL_Tools_Ivy"]
REPLACED = ["Ruin_SkullSeat_Wall", "Ruin_LeftFlank_WallLow", "Ruin_RightFlank_ColumnStanding"]
# 1. hide auto-included tool copies + replaced ruins
for o in sc.objects:
    a = o.get("cfcl_asset", "")
    if (isinstance(a, str) and a.startswith("CFCL_Tools_")) or o.name in REPLACED or (HIDE_FAR and isinstance(a, str) and a == "CFCL_Terrain_FarCliffs"):
        if not o.hide_render:
            o.hide_render = True; o.hide_viewport = True
            LOG["hidden"].append(o.name)
# 2. append the latest tool assets at env layout, then apply the env->world transform
root = bpy.data.collections.new("CF_50_TOOLS_CHECK"); sc.collection.children.link(root)
all_new = {}
for a in TOOLS:
    folder = os.path.join(CL, "assets", a)
    if not I.latest_blend(folder):
        continue
    before = set(bpy.data.objects)
    try:
        I.append_asset(folder, root, 1.0, LOG["warnings"])
    except Exception as e:
        LOG["warnings"].append(f"{a}: {e!r}"); continue
    all_new[a] = [o for o in bpy.data.objects if o not in before]
    print("[check] appended", a, len(all_new[a]), flush=True)
# ONE depsgraph update for all appends (append_asset sets loc/rot/scale; matrix_world is stale until updated)
bpy.context.view_layer.update()
for a, new in all_new.items():
    for o in new:
        if o.parent is None:
            o.matrix_world = T.M_ENV @ o.matrix_world
    newcol = [c for c in bpy.data.collections if c.name.startswith(a) and c.get("cfcl_blend")]
    LOG["added"][a] = {"blend": newcol[-1]["cfcl_blend"] if newcol else None,
                       "objects": len([o for o in new if not o.hide_render])}
print("[check] placed", flush=True)
CAMS = {"hero": ((0, -30.0, 9.0), (0, 20, 5.5), 24), "god": ((0, -26.0, 30.0), (0, 2, -2), 26),
        "tele": ((0, -30.0, 9.0), (12, 200, 22), 45), "worm": ((6.0, -14.0, 1.2), (0, 30, 14), 18)}
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.resolution_percentage = 100
try:
    sc.eevee.taa_render_samples = 48
except Exception:
    pass
for v in VIEWS:
    loc, tgt, lens = CAMS[v]
    cam = R.camera("TOOLS_CAM_" + v, loc, tgt, lens)
    cam.data.clip_end = 5000
    t1 = time.time()
    p = os.path.join(OUT, f"combined_{TAG}_{v}.png")
    R.render_to(p, cam)
    LOG.setdefault("renders", {})[v] = {"path": os.path.relpath(p, CL), "s": round(time.time() - t1, 1)}
T.write_json(os.path.join(OUT, f"combined_{TAG}_log.json"), LOG)
print("COMBINED_DONE", json.dumps(LOG, default=str)[:3000])
