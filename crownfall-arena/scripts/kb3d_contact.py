"""Clay contact renders of KitBash3D kit roots (textures absent): renders/kb3d/<root>.png
Usage: python lib/run_blender.py scripts/kb3d_contact.py -- <kit.blend> <regex_exclude>"""
import bpy, sys, os, re, math
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0], load_ui=False)
import cf_render as R
from mathutils import Vector
sc = bpy.context.scene
OUT = os.path.join(CL, "renders", "kb3d"); os.makedirs(OUT, exist_ok=True)
clay = bpy.data.materials.new("CLAY"); clay.use_nodes = True
b = clay.node_tree.nodes.get("Principled BSDF"); b.inputs["Base Color"].default_value = (0.42, 0.40, 0.37, 1); b.inputs["Roughness"].default_value = 0.8
for o in sc.objects:
    if o.type == "MESH":
        o.data.materials.clear(); o.data.materials.append(clay)
def tree(o):
    yield o
    for c in o.children: yield from tree(c)
roots = [o for o in sc.objects if o.parent is None and not re.search(argv[1], o.name)]
R.setup_render(sc, "EEVEE", (480, 480), 16)
R.setup_world(sc, top=(0.35, 0.36, 0.37), horizon=(0.5, 0.5, 0.48), strength=1.0)
for l in [o for o in sc.objects if o.type == "LIGHT"]: bpy.data.objects.remove(l)
R.standard_lights(10.0, lava=False)
cam = R.camera("KB_CAM", (0, -10, 5), (0, 0, 0), 35)
for r in roots:
    obs = set(tree(r))
    for o in sc.objects:
        if o.type == "MESH": o.hide_render = o not in obs
    mn, mx = R.bounds([o for o in obs if o.type == "MESH"])
    if mx.x < mn.x: continue
    ctr = (mn + mx) / 2; size = (mx - mn).length
    d = size * 1.25
    cam.location = ctr + Vector((math.sin(math.radians(-35)) * d * 0.8, -math.cos(math.radians(-35)) * d * 0.8, d * 0.35))
    R.look_at(cam, ctr)
    sc.camera = cam; sc.render.filepath = os.path.join(OUT, r.name + ".png")
    bpy.ops.render.render(write_still=True)
print("KBDONE", len(roots))
