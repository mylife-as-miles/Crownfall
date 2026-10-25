"""Render views of a saved main scene, one Blender process per call (keeps GPU memory bounded on the 4 GB card).
Usage: python lib/run_blender.py scripts/render_main_views.py --timeout 1800 -- v002 elevated,board_ground"""
import sys, os, json, time
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment".replace("\\\\", "\\")
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
argv = sys.argv[sys.argv.index("--") + 1:]
VER, VIEWS = argv[0], argv[1].split(",")
PCT = int(argv[2]) if len(argv) > 2 else 100
CAMS = {
    "hero": ((0, -30.0, 9.0), (0, 20, 5.5), 24), "hero_low": ((0, -16.5, 3.4), (0, 30, 9.0), 22),
    "elevated": ((0, -34.0, 40.0), (0, 6, -2), 24), "top": ((0, 15, 230), (0, 15.0001, 0), 30),
    "board_ground": ((3.0, -9.0, 1.8), (0, 8, 1.2), 24), "monuments": ((0, -8.0, 8.0), (0, 45, 16), 28),
    "god": ((0, -26.0, 30.0), (0, 2, -2), 26), "kg_hero_wide": ((3.933, -33.868, 17.043), (0, 11.362, 5.244), 28),
    "kg_duel_ground": ((0, -17.262, 3.715), (0, 6.118, 2.404), 36), "kg_map_topdown": ((0, -1.311, 48.07), (0, 0, 0.0001), 45), "worm": ((6.0, -14.0, 1.2), (0, 30, 14), 18), "shoulder": ((-9.5, -11.0, 2.4), (2, 25, 6), 24, 5.0),
    "axial": ((0, -45.0, 14.0), (0, 40, 12), 30), "high34": ((-45.0, -55.0, 40.0), (0, 15, 0), 30),
}
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend"), load_ui=False)
import cf_render as R
out = os.path.join(CL, "renders", "main", VER); os.makedirs(out, exist_ok=True)
bpy.context.scene.render.resolution_percentage = PCT
# 4 GB GPU budget (v009 crashed twice with STATUS_STACK_BUFFER_OVERRUN mid-render)
_ee = bpy.context.scene.eevee
for _k, _v in (("shadow_pool_size", "256"), ("volumetric_tile_size", "8"), ("volumetric_samples", 64)):
    try: setattr(_ee, _k, _v)
    except Exception as e: print("eevee", _k, e)
try:
    bpy.context.preferences.system.gl_texture_limit = "CLAMP_1024"
except Exception as e:
    print("texlimit", e)
for v in VIEWS:
    loc, tgt, lens = CAMS[v][:3]
    cam = bpy.data.objects.get("CF_CAM_" + v)
    if cam is None:
        cam = R.camera("CF_CAM_" + v, loc, tgt, lens)
        if len(CAMS[v]) > 3:
            import math; cam.rotation_euler.rotate_axis("Z", math.radians(CAMS[v][3]))
    cam.data.clip_end = 4000
    t = time.time(); R.render_to(os.path.join(out, f"main_{VER}_{v}.png"), cam); print("VIEW", v, round(time.time() - t, 1))
