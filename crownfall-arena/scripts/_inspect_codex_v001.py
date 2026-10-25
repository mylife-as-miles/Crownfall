# READ-ONLY inspection of Codex's saved v001 file. Never saves.
import bpy, json, os
p = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\outputs\Crownfall_Environment_v001\Crownfall_Environment_v001.blend"
bpy.ops.wm.open_mainfile(filepath=p, load_ui=False)
out = {"scenes": [s.name for s in bpy.data.scenes], "collections": {}, "cameras": {}, "lights": {}}
def walk(c, depth=0):
    out["collections"][c.name] = {"depth": depth, "n_objects": len(c.objects), "children": [ch.name for ch in c.children]}
    for ch in c.children: walk(ch, depth+1)
for s in bpy.data.scenes:
    walk(s.collection)
big = []
for o in bpy.data.objects:
    if o.type == 'CAMERA':
        out["cameras"][o.name] = {"loc": list(o.location), "rot": list(o.rotation_euler), "lens": o.data.lens}
    elif o.type == 'LIGHT':
        out["lights"][o.name] = {"type": o.data.type, "loc": list(o.location), "energy": o.data.energy, "color": list(o.data.color)}
    elif o.type == 'MESH':
        big.append((o.name, [round(v,2) for v in o.location], [round(v,2) for v in o.dimensions], [c.name for c in o.users_collection]))
big.sort(key=lambda t: -t[2][0]*t[2][1]*t[2][2])
out["largest_meshes"] = big[:45]
out["n_mesh_objects"] = len(big)
sc = bpy.data.scenes.get("Crownfall_Environment_v001") or bpy.context.scene
out["render"] = {"engine": sc.render.engine, "view_transform": sc.view_settings.view_transform, "look": sc.view_settings.look, "world": sc.world.name if sc.world else None}
open(r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment\research\codex_v001_inventory.json","w").write(json.dumps(out, indent=1))
print("INVENTORY_OK", len(big))
