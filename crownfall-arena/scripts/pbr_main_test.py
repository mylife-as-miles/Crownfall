"""Apply assets/CFCL_PBR/pbr_mapping.json to a main scene opened READ-ONLY and render test views.

Usage: python lib/run_blender.py scripts/pbr_main_test.py --timeout 2400 -- <tag> <mode> [views] [optional_keys] [ver]
  mode: pbr | base          (base = render the scene untouched, for before/after)
  views: comma list of hero,god (default both)
  optional_keys: comma list of pbr_mapping 'optional' keys (or '-')
  ver: main scene version (default v003)
Never saves over main/*.blend.  If env CFCL_PBR_SAVE=1, saves renders/pbr/test_<tag>.blend (unpacked textures).
"""
import sys, os, json, time, math
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = argv[0] if argv else "test01"
MODE = argv[1] if len(argv) > 1 else "pbr"
VIEWS = argv[2].split(",") if len(argv) > 2 and argv[2] not in ("", "all") else ["hero", "god"]
OPT = tuple(x for x in (argv[3].split(",") if len(argv) > 3 else []) if x and x != "-")
VER = argv[4] if len(argv) > 4 else "v003"
SRC = os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend")
OUT = os.path.join(CL, "renders", "pbr")
os.makedirs(OUT, exist_ok=True)
CAMS = {"hero": ((0, -30.0, 9.0), (0, 20, 5.5), 24), "god": ((0, -26.0, 30.0), (0, 2, -2), 26),
        "elevated": ((0, -34.0, 40.0), (0, 6, -2), 24), "board_ground": ((3.0, -9.0, 1.8), (0, 8, 1.2), 24)}

t0 = time.time()
bpy.ops.wm.open_mainfile(filepath=SRC, load_ui=False)
import cf_render as R
import cf_pbr as P
sc = bpy.context.scene
LOG = {"tag": TAG, "mode": MODE, "src": os.path.basename(SRC), "optional": OPT, "views": {}}
if MODE == "pbr":
    t1 = time.time()
    LOG["mapping"] = P.apply_mapping(list(sc.objects), optional=OPT)
    LOG["mapping_s"] = round(time.time() - t1, 1)
    print("MAPPING", json.dumps(LOG["mapping"], indent=1))
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.resolution_percentage = 100
try:
    sc.eevee.taa_render_samples = 48
except Exception:
    pass
for v in VIEWS:
    loc, tgt, lens = CAMS[v]
    cam = R.camera(f"CF_PBRCAM_{v}", loc, tgt, lens)
    cam.data.clip_end = 4000
    t1 = time.time()
    p = os.path.join(OUT, f"{TAG}_{MODE}_{v}.png")
    R.render_to(p, cam)
    LOG["views"][v] = {"path": p, "s": round(time.time() - t1, 1)}
# optional extra pass: argv[5] = "<optional_key>:<view>[,<view>]" -> apply that optional mapping and re-render
if len(argv) > 5 and ":" in argv[5]:
    okey, oviews = argv[5].split(":", 1)
    LOG["extra"] = P.apply_mapping(list(sc.objects), optional=(okey,))
    for v in oviews.split(","):
        cam = bpy.data.objects.get(f"CF_PBRCAM_{v}") or R.camera(f"CF_PBRCAM_{v}", *CAMS[v])
        p = os.path.join(OUT, f"{TAG}_{MODE}_{okey}_{v}.png")
        R.render_to(p, cam)
        LOG["views"][f"{okey}_{v}"] = {"path": p}
if os.environ.get("CFCL_PBR_SAVE") == "1":
    try:
        bpy.ops.file.unpack_all(method="USE_LOCAL") if False else None
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"test_{TAG}.blend"), compress=True, copy=True)
LOG["seconds"] = round(time.time() - t0, 1)
R.write_json(os.path.join(OUT, f"{TAG}_{MODE}_log.json"), LOG)
print("PBR_MAIN_TEST_DONE", json.dumps({k: LOG[k] for k in ("tag", "mode", "seconds")}))
