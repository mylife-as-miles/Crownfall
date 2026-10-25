# READ-ONLY inventory of a COPY of Codex's v002_WORKING scene (copy is deleted afterwards).
import bpy, json, os, shutil, collections
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
SRC = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\outputs\Crownfall_Environment_v002\Crownfall_Environment_v002_WORKING.blend"
COPY = os.path.join(CL, "preview", "_codex_v002_inventory_copy.blend")
shutil.copy2(SRC, COPY)
bpy.ops.wm.open_mainfile(filepath=COPY, load_ui=False)
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
rows = []
for o in sc.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); t = len(me.loop_triangles); o.evaluated_get(dg).to_mesh_clear()
    import mathutils
    bb = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    mn = [round(min(v[i] for v in bb), 2) for i in range(3)]; mx = [round(max(v[i] for v in bb), 2) for i in range(3)]
    rows.append({"name": o.name, "tris": t, "min": mn, "max": mx, "mats": [s.material.name for s in o.material_slots if s.material][:4],
                 "cols": [c.name for c in o.users_collection], "parent": o.parent.name if o.parent else None})
prefix = collections.Counter()
for r in rows:
    key = "_".join(r["name"].split("_")[:2]) if r["name"].startswith(("ENV", "CF")) else r["name"].split("_")[0]
    prefix[key] += r["tris"]
json.dump({"objects": rows, "tris_by_prefix": prefix.most_common()}, open(os.path.join(CL, "research", "codex_v002_inventory.json"), "w"), indent=1)
print("INV", len(rows), sum(r["tris"] for r in rows))
for k, v in prefix.most_common(40): print("  ", k, v)
bpy.ops.wm.read_factory_settings(use_empty=True)
os.remove(COPY)
