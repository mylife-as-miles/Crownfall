"""READ-ONLY probe of main/Crownfall_Main_v002.blend for the ritual-floor layout (never saves).
Writes renders/ritual_floor/main_v002_layout.json (object world bounds) and main_v002_hmap.npz
(top-down ray-cast height + hit-object-category grid).
python lib/run_blender.py scripts/ritual_floor_probe.py --timeout 900
"""
import os
import sys
import json
import numpy as np
import bpy
from mathutils import Vector

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
OUT = os.path.join(CL, "renders", "ritual_floor")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", "Crownfall_Main_v002.blend"), load_ui=False)
sc = bpy.context.scene
bpy.context.view_layer.update()


def wb(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = [min(c[i] for c in cs) for i in range(3)]
    mx = [max(c[i] for c in cs) for i in range(3)]
    return [round(v, 2) for v in mn], [round(v, 2) for v in mx]


objs = []
for o in sc.objects:
    if o.type not in ("MESH", "CURVE", "EMPTY", "LIGHT", "CAMERA"):
        continue
    mn, mx = wb(o) if o.type in ("MESH", "CURVE") else ([round(v, 2) for v in o.matrix_world.translation],) * 2
    objs.append({"name": o.name, "type": o.type, "col": o.users_collection[0].name if o.users_collection else "",
                 "hide_render": o.hide_render, "min": mn, "max": mx,
                 "mats": [m.name for m in getattr(o.data, "materials", []) if m][:3] if o.type == "MESH" else []})
json.dump({"objects": objs, "camera": sc.camera.name if sc.camera else None},
          open(os.path.join(OUT, "main_v002_layout.json"), "w"), indent=1)

# hide volumes / atmosphere / particles so the rays hit solid ground only
for o in sc.objects:
    n = o.name.lower()
    vol = False
    if o.type == "MESH":
        for m in o.data.materials:
            if m and m.node_tree:
                out = [nd for nd in m.node_tree.nodes if nd.type == "OUTPUT_MATERIAL"]
                if out and out[0].inputs["Volume"].is_linked and not out[0].inputs["Surface"].is_linked:
                    vol = True
    if vol or o.hide_render or any(k in n for k in ("fog", "mist", "haze", "cloud", "ember", "eclipse", "corona",
                                                     "sky", "dust", "spark", "volume")):
        o.hide_viewport = True
    if o.type == "MESH" and o.users_collection and "VEGETATION" in o.users_collection[0].name.upper():
        o.hide_viewport = True
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()

CATS = [("board", ("board",)), ("dais", ("dais", "boardskirt", "stele", "altar")), ("lava", ("lava", "abyss")),
        ("skull", ("skull",)), ("hand", ("hand",)), ("rib", ("rib",)), ("bank", ("canyon", "bank", "backfill")),
        ("central", ("central", "seat")), ("ruin", ("ruin", "arch_", "far")), ("cliff", ("cliff",))]


def cat(name):
    n = name.lower()
    for i, (c, keys) in enumerate(CATS):
        if any(k in n for k in keys):
            return i + 1
    return 99


xs = np.arange(-100, 100.01, 1.5)
ys = np.arange(-70, 130.01, 1.5)
H = np.full((len(ys), len(xs)), np.nan, np.float32)
C = np.zeros((len(ys), len(xs)), np.int16)
names = {}
for j, y in enumerate(ys):
    for i, x in enumerate(xs):
        hit, loc, nrm, idx, ob, mw = sc.ray_cast(dg, Vector((x, y, 300.0)), Vector((0, 0, -1)))
        if hit:
            H[j, i] = loc.z
            C[j, i] = cat(ob.name)
            names[ob.name] = names.get(ob.name, 0) + 1
np.savez(os.path.join(OUT, "main_v002_hmap.npz"), H=H, C=C, xs=xs, ys=ys)
json.dump({"cats": [c for c, _ in CATS], "hit_objects": names}, open(os.path.join(OUT, "main_v002_hits.json"), "w"),
          indent=1)
print("PROBE_DONE", len(objs), "objects", len(names), "hit objects")
