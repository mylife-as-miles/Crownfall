"""A/B: run the user's Crownfall_Kings_Gambit_Blender_Lookdev.py (unmodified logic) on a COPY of a main scene.
Only the CONFIG block values are set for this scene (board width, object names, cursor-centre mode).
Usage: python lib/run_blender.py scripts/run_user_lookdev_kit.py --timeout 2400 -- v005 hero,god,KG_HERO_WIDE,KG_DUEL_GROUND,KG_MAP_TOPDOWN"""
import sys, os, re, time
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
argv = sys.argv[sys.argv.index("--") + 1:]
VER, VIEWS = argv[0], argv[1].split(",")
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend"), load_ui=False)
sc = bpy.context.scene
sc.cursor.location = (0, 0, 0)
src = open(os.path.join(CL, "tools_from_user", "Crownfall_Kings_Gambit_Blender_Lookdev.py"), encoding="utf-8").read()
cfg = {"USE_SELECTION_BOUNDS": "False", "FALLBACK_BOARD_WIDTH": "21.85",
       "SKULL_OBJECT_NAME": "'CFCL_Hero_Skull'", "HAND_OBJECT_NAME": "'CFCL_Hero_Hand'", "ECLIPSE_OBJECT_NAME": "'CFCL_Eclipse_Body'"}
for k, v in cfg.items():
    src, n = re.subn(rf"^{k}\s*=.*$", f"{k} = {v}", src, count=1, flags=re.M)
    assert n == 1, k
exec(compile(src, "Crownfall_Kings_Gambit_Blender_Lookdev.py", "exec"), {"__name__": "__main__"})
sc.render.resolution_percentage = 100          # kit sets 70% preview; keep A/B at full size
import cf_render as R
out = os.path.join(CL, "renders", "user_kit", VER); os.makedirs(out, exist_ok=True)
CAMS = {"hero": ((0, -30.0, 9.0), (0, 20, 5.5), 24), "god": ((0, -26.0, 30.0), (0, 2, -2), 26)}
for v in VIEWS:
    if v.startswith("KG_"):
        cam = bpy.data.objects.get("KG | CAMERA | " + v[3:])
    else:
        cam = bpy.data.objects.get("CF_CAM_" + v) or R.camera("CF_CAM_" + v, *CAMS[v])
    if cam is None:
        print("NOCAM", v); continue
    cam.data.clip_end = 4000
    t = time.time(); R.render_to(os.path.join(out, f"kit_{VER}_{v}.png"), cam); print("VIEW", v, round(time.time() - t, 1))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}_userkit.blend"), compress=True)
print("KIT_DONE")
