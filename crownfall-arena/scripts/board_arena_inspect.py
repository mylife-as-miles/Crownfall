"""Inventory a saved asset .blend (read-only): objects, types, collections, materials, tris, shared meshes.
python lib/run_blender.py scripts/board_arena_inspect.py --timeout 300 -- <path.blend> [name_prefix]"""
import sys
import json
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
path = args[0]
prefix = args[1] if len(args) > 1 else "CFCL_Board_"
bpy.ops.wm.open_mainfile(filepath=path)
dg = bpy.context.evaluated_depsgraph_get()
types, tris, mats, meshes = {}, 0, set(), set()
for o in bpy.data.objects:
    types[o.type] = types.get(o.type, 0) + 1
    if o.type == "MESH":
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
        meshes.add(o.data.name)
        for m in o.data.materials:
            if m:
                mats.add(m.name)
out = {"objects": len(bpy.data.objects), "types": types, "tris_rendered": tris, "unique_meshes": len(meshes),
       "non_asset_objects": [o.name for o in bpy.data.objects if not o.name.startswith(prefix)],
       "collections": {c.name: len(c.objects) for c in bpy.data.collections},
       "materials": sorted(mats), "images": [i.name for i in bpy.data.images]}
a1 = bpy.data.objects.get("CFCL_Board_Tile_a1")
if a1:
    out["a1"] = list(a1.location)
print("INSPECT", json.dumps(out, indent=1))
