"""Inventory a KitBash3D native .blend: asset roots (top-level objects), dims, triangles, materials, images.
Usage: python lib/run_blender.py scripts/kb3d_inventory.py -- <kit.blend> <out.json>"""
import bpy, sys, json, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0], load_ui=False)
dg = bpy.context.evaluated_depsgraph_get()
def tris(o):
    if o.type != "MESH": return 0
    return sum(len(p.vertices) - 2 for p in o.data.polygons)
def tree(o):
    yield o
    for c in o.children:
        yield from tree(c)
roots = [o for o in bpy.context.scene.objects if o.parent is None]
out = {"collections": {c.name: len(c.all_objects) for c in bpy.data.collections}, "roots": [],
       "materials": len(bpy.data.materials), "images": [], "n_objects": len(bpy.data.objects)}
for r in roots:
    obs = list(tree(r))
    pts = [o.matrix_world @ Vector(c) for o in obs if o.type == "MESH" for c in o.bound_box]
    if not pts: continue
    mn = [min(p[i] for p in pts) for i in range(3)]; mx = [max(p[i] for p in pts) for i in range(3)]
    mats = sorted({s.material.name for o in obs for s in getattr(o, "material_slots", []) if s.material})
    out["roots"].append({"name": r.name, "type": r.type, "n": len(obs), "tris": sum(tris(o) for o in obs),
                         "dims": [round(mx[i] - mn[i], 2) for i in range(3)], "center": [round((mx[i] + mn[i]) / 2, 1) for i in range(3)],
                         "mats": mats[:8], "cols": [c.name for c in r.users_collection]})
for im in bpy.data.images:
    out["images"].append({"name": im.name, "packed": bool(im.packed_file), "path": im.filepath[:160], "size": list(im.size)})
json.dump(out, open(argv[1], "w"), indent=1)
print("INV roots", len(out["roots"]), "objects", out["n_objects"], "materials", out["materials"], "images", len(out["images"]))
