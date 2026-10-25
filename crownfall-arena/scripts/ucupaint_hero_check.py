"""Hero-camera check of the Ucupaint monuments (baked runtime materials only), env units.

python lib/run_blender.py scripts/ucupaint_hero_check.py --timeout 1800 -- <tag> [skull=vN hand=vN altar=vN]

Main build convention: world = env x4.6 + (0,0,1.94).  Hero camera (0,-30,9)->(0,20,5.5) 24 mm is converted to
env units.  Lighting = cf_render standard rig + the coordinator's plan: a COOL fill on the skull and a WARM rim
on the hand.  Also renders a tighter 75 mm crop of each monument from the same camera position.
Writes renders/ucupaint/hero/<tag>_*.png
"""
import sys
import os
import math
import bpy
from mathutils import Vector

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CL, "lib"))
import cf_render as R            # noqa: E402
import cf_integrate as I         # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = argv[0] if argv else "check"
OUT = os.path.join(CL, "renders", "ucupaint", "hero")
os.makedirs(OUT, exist_ok=True)
K, DZ = 4.6, 1.94


def env(p):
    return Vector(((p[0]) / K, (p[1]) / K, (p[2] - DZ) / K))


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
sc = bpy.context.scene
root = bpy.data.collections.new("UCU_HERO")
sc.collection.children.link(root)
warn = []
placed = {}
for name in ("CFCL_Ucupaint_Skull", "CFCL_Ucupaint_Hand", "CFCL_Ucupaint_AltarDais"):
    folder = os.path.join(CL, "assets", name)
    if os.path.exists(folder) and I.latest_blend(folder):
        placed[name] = I.append_asset(folder, root, 1.0, warn)
        print("[hero] placed", name, len(placed[name]), flush=True)
print("[hero] warnings", warn, flush=True)
# stand-in board (21.85 m world = 4.75 env) at the dais
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.59))
sb = bpy.context.active_object
sb.name = "StandIn_Board"
sb.scale = (4.75, 4.75, 0.34)
m = bpy.data.materials.new("StandInBoard")
m.use_nodes = True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.08, 0.075, 0.07, 1)
sb.data.materials.append(m)
# ground plane
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 8, -0.9))
gp = bpy.context.active_object
gm = bpy.data.materials.new("Ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.03, 0.028, 0.025, 1)
gp.data.materials.append(gm)

R.setup_render(sc, "EEVEE", (1280, 720), 48)
R.setup_world(sc)
R.standard_lights(6.0)
# coordinator lighting plan: cool fill on the skull, warm rim on the hand
sk = bpy.data.objects.get("CFCL_Hero_Skull")
hd = bpy.data.objects.get("CFCL_Hero_Hand")
if sk:
    R.add_light("UCU_CoolFill_Skull", "AREA", sk.location + Vector((2.5, -4.0, 3.0)), (55, 0, 30), 900.0,
                (0.70, 0.82, 1.0), 4.0)
if hd:
    R.add_light("UCU_WarmRim_Hand", "AREA", hd.location + Vector((-1.0, 4.5, 4.0)), (-60, 0, 170), 1400.0,
                (1.0, 0.62, 0.30), 3.0)
cam_loc, cam_tgt = env((0, -30.0, 9.0)), env((0, 20.0, 5.5))
cam = R.camera("HERO24", cam_loc, cam_tgt, 24)
R.render_to(os.path.join(OUT, TAG + "_hero24.png"), cam)
for nm, ob in (("skull", sk), ("hand", hd)):
    if ob is None:
        continue
    mn, mx = R.bounds([ob])
    c = R.camera("HERO75_" + nm, cam_loc, (mn + mx) / 2, 75)
    R.render_to(os.path.join(OUT, TAG + "_hero75_" + nm + ".png"), c)
c = R.camera("HERO50_dais", cam_loc, Vector((0, 0, -0.6)), 50)
R.render_to(os.path.join(OUT, TAG + "_hero50_dais.png"), c)
print("[hero] done", flush=True)
