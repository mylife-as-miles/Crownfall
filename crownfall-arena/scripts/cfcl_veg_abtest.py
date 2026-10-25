"""A/B debug renders of the rock top in a saved dress demo (read-only on the .blend; writes PNGs only).
python lib/run_blender.py scripts/cfcl_veg_abtest.py -- <demo.blend> <out_prefix>"""
import sys
import os
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=args[0])
import cf_render as R
sc = bpy.context.scene
R.setup_render(sc, "EEVEE", (960, 540), 24)
R.setup_world(sc)
R.standard_lights(3.0, lava=False)
cam = R.camera("AB_cam", (-1.0, 0.0, 2.2), (-2.5, 2.4, 1.0), 32.0)
shell = bpy.data.objects.get("CFCL_Veg_Demo_Rock_MossShell")
R.render_to(args[1] + "_A_shell_on.png", cam)
for m in shell.modifiers:
    m.show_render = False
R.render_to(args[1] + "_B_no_solidify.png", cam)
shell.hide_render = True
R.render_to(args[1] + "_C_shell_hidden.png", cam)
