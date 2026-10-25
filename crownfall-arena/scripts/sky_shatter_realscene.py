"""CFCL_Sky_Shatter - judge the sky in the REAL main scene.

Opens a main-build .blend READ-ONLY (it is never saved), removes the CFCL_Sky_Shatter objects that the main build
appended, appends the requested arrangement of this asset (e.g. a staged new version) exactly the way
build_main_scene.py does (cf_integrate.append_asset, world metres, unscaled), and renders the hero camera.

python lib/run_blender.py scripts/sky_shatter_realscene.py --timeout 3000 -- --main main/Crownfall_Main_v014_hero.blend
       --arr arrangement_stage.json --out renders/sky_shatter/real_v010_hero.png [--res 960x540] [--samples 32]
"""
import json
import os
import sys
import time

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
for _p in (os.path.join(CL, "lib"), os.path.join(CL, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
A = {}
i = 0
while i < len(argv):
    if argv[i].startswith("--"):
        A[argv[i][2:]] = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
        i += 2 if A[argv[i][2:]] is not True else 1
    else:
        i += 1
MAIN = os.path.join(CL, A.get("main", r"main\Crownfall_Main_v014_hero.blend"))
ARR = A.get("arr", "arrangement.json")
OUT = os.path.join(CL, A.get("out", r"renders\sky_shatter\real_hero.png"))
t0 = time.time()
bpy.ops.wm.open_mainfile(filepath=MAIN)
import cf_render as R  # noqa: E402  (after open: the module keeps no scene state)
import cf_integrate as I  # noqa: E402
sc = bpy.context.scene
old = [o for o in bpy.data.objects if o.get("cfcl_asset") == "CFCL_Sky_Shatter" or o.name.startswith("CFCL_SkyShatter_")]
n_old = len(old)
for o in old:
    bpy.data.objects.remove(o, do_unlink=True)
for c in [c for c in bpy.data.collections if c.name.startswith("CFCL_Sky_Shatter")]:
    bpy.data.collections.remove(c)
parent = bpy.data.collections.get("CF_00_BOARD_MASSIVE") or sc.collection
warn = []
got = I.append_asset(os.path.join(CL, "assets", "CFCL_Sky_Shatter"), parent, 1.0, warn, arrangement=ARR)
cam = bpy.data.objects.get("CF_CAM_hero") or R.camera("CF_CAM_hero", (0, -30.0, 9.0), (0, 20, 5.5), 24)
cam.data.clip_end = 4000
sc.camera = cam
if A.get("res"):
    sc.render.resolution_x, sc.render.resolution_y = (int(v) for v in str(A["res"]).split("x"))
    sc.render.resolution_percentage = 100
if A.get("samples"):
    sc.eevee.taa_render_samples = int(A["samples"])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
sc.render.filepath = OUT
sc.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
info = {"main": MAIN, "arrangement": ARR, "removed_old": n_old, "placed": len(got), "warnings": warn,
        "camera": [list(cam.location), cam.data.lens], "res": [sc.render.resolution_x, sc.render.resolution_y],
        "samples": sc.eevee.taa_render_samples, "volumetric_end": getattr(sc.eevee, "volumetric_end", None),
        "seconds": round(time.time() - t0, 1)}
json.dump(info, open(OUT.replace(".png", "_info.json"), "w"), indent=1)
print("[realscene]", json.dumps(info), flush=True)
# NOTE: deliberately no save - the main .blend is read-only for this agent.
