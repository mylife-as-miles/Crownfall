"""Import a downloaded scan once, decimate it to a working budget, save vendor/scans/<slug>/prep.blend, and render an
8-azimuth orientation sheet (renders/scans/<slug>_az.jpg, each tile labelled with its azimuth).
Usage: python lib/run_blender.py scripts/scan_prep.py -- <slug> <target_tris>"""
import glob
import math
import os
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import cf_render as R  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
SLUG, TARGET = argv[0], int(argv[1])
root = os.path.join(CL, "vendor", "scans", SLUG, "source")
src = (glob.glob(os.path.join(root, "*", "*.obj")) + glob.glob(os.path.join(root, "*", "*.stl")))[0]
R.reset_scene()
if src.lower().endswith(".obj"):
    bpy.ops.wm.obj_import(filepath=src, forward_axis="NEGATIVE_Z", up_axis="Y")
else:
    bpy.ops.wm.stl_import(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in objs:
    bpy.context.view_layer.objects.active = o
    n = R.tri_count([o])
    if n > TARGET:
        m = o.modifiers.new("dec", "DECIMATE")
        m.ratio = TARGET / n
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    print("PREP", o.name, n, "->", R.tri_count([o]))
# centre on the bbox middle (xy) and floor (z), unit-normalise the largest side to 1.0
mn, mx = R.bounds(objs)
ctr, size = (mn + mx) / 2, max(mx - mn)
for o in objs:
    o.data.transform(Matrix.Scale(1.0 / size, 4) @ Matrix.Translation(-Vector((ctr.x, ctr.y, mn.z))))
    o.data.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CL, "vendor", "scans", SLUG, "prep.blend"))
sc = bpy.context.scene
R.setup_world(sc, top=(0.42, 0.42, 0.42), horizon=(0.5, 0.5, 0.5), strength=1.0)
out = os.path.join(CL, "renders", "scans", SLUG + "_az")
os.makedirs(out, exist_ok=True)
views = tuple((f"az{a:03d}", a, 8) for a in range(0, 360, 45))
paths = R.turntable(objs, os.path.join(out, SLUG), views=views, lens=50.0, dist_mult=1.2, res=(480, 400), samples=16, ground=False)
print("AZ", paths)
