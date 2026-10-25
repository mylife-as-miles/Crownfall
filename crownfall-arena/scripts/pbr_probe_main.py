"""Read-only probe of a main scene .blend: object names, materials, UVs, world scale, bounds.
Never saves.  Usage: python lib/run_blender.py scripts/pbr_probe_main.py --timeout 900 -- v003"""
import sys, os, json
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
import bpy
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = argv[0] if argv else "v003"
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend"), load_ui=False)
out = []
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    me = o.data
    bb = [o.matrix_world @ __import__("mathutils").Vector(c) for c in o.bound_box]
    mn = [min(v[i] for v in bb) for i in range(3)]; mx = [max(v[i] for v in bb) for i in range(3)]
    sc = o.matrix_world.to_scale()
    out.append({"name": o.name, "mesh": me.name, "users": me.users, "polys": len(me.polygons),
                "uv": len(me.uv_layers), "mats": [s.material.name if s.material else None for s in o.material_slots],
                "hide_render": o.hide_render, "parent": o.parent.name if o.parent else None,
                "cols": [c.name for c in o.users_collection], "scale": [round(x, 3) for x in sc],
                "min": [round(x, 2) for x in mn], "max": [round(x, 2) for x in mx],
                "inst": o.instance_type})
mats = {}
for m in bpy.data.materials:
    imgs = [n.image.name for n in (m.node_tree.nodes if m.use_nodes and m.node_tree else []) if n.type == "TEX_IMAGE" and n.image]
    mats[m.name] = {"users": m.users, "images": imgs}
res = {"objects": out, "materials": mats,
       "render": {"engine": bpy.context.scene.render.engine, "res": [bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y],
                  "view_transform": bpy.context.scene.view_settings.view_transform, "look": bpy.context.scene.view_settings.look,
                  "exposure": bpy.context.scene.view_settings.exposure},
       "collections": {c.name: [len(c.objects), c.hide_render] for c in bpy.data.collections}}
os.makedirs(os.path.join(CL, "renders", "pbr"), exist_ok=True)
json.dump(res, open(os.path.join(CL, "renders", "pbr", f"_probe_main_{VER}.json"), "w"), indent=1)
print("PROBE_DONE", len(out), "mesh objects", len(mats), "materials")
