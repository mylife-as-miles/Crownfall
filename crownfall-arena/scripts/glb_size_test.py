"""Measure what a GLB of a main scene would weigh (test exports, never saves the blend).
Usage: python lib/run_blender.py scripts/glb_size_test.py -- <ver>
-> exports/glb_test/<ver>_{raw,draco,draco_mat}.glb + <ver>_report.json (triangles by asset / collection)."""
import sys, os, json, time, collections
CL = os.environ.get("CF_ROOT") or r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
import bpy

VER = sys.argv[sys.argv.index("--") + 1:][0]
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend"), load_ui=False)
sc = bpy.context.scene
OUT = os.path.join(CL, "exports", "glb_test")
os.makedirs(OUT, exist_ok=True)

# volumes (fog/mist boxes), lights and cameras are runtime effects, not geometry
for o in list(sc.objects):
    vol = o.type == "MESH" and any(s.material and s.material.node_tree and any(
        n.type == "OUTPUT_MATERIAL" and n.inputs["Volume"].is_linked for n in s.material.node_tree.nodes)
        for s in o.material_slots)
    if vol or o.type in ("LIGHT", "CAMERA", "LIGHT_PROBE"):
        o.hide_render = True

dg = bpy.context.evaluated_depsgraph_get()
by_asset, by_col, total = collections.Counter(), collections.Counter(), 0
meshes = [o for o in sc.objects if o.type == "MESH" and not o.hide_render and o.visible_get()]
for o in meshes:
    me = o.evaluated_get(dg).to_mesh()
    t = sum(len(p.vertices) - 2 for p in me.polygons)
    o.evaluated_get(dg).to_mesh_clear()
    total += t
    by_asset[o.get("cfcl_asset") or (o.users_collection[0].name if o.users_collection else "?")] += t
    top = o.users_collection[0]
    by_col[top.name] += t
rep = {"ver": VER, "objects": len(meshes), "triangles": total,
       "by_asset": dict(by_asset.most_common(30)), "images": len(bpy.data.images),
       "image_px": sum(i.size[0] * i.size[1] for i in bpy.data.images)}
print("TRIS", total, flush=True)

common = dict(export_format="GLB", use_renderable=True, use_visible=True, export_apply=True, export_lights=False,
              export_cameras=False, export_animations=False, export_extras=False)
for tag, kw in (("raw", dict(export_materials="NONE", export_draco_mesh_compression_enable=False)),
                ("draco", dict(export_materials="NONE", export_draco_mesh_compression_enable=True,
                               export_draco_mesh_compression_level=6)),
                ("draco_mat", dict(export_materials="EXPORT", export_draco_mesh_compression_enable=True,
                                   export_draco_mesh_compression_level=6, export_image_format="JPEG"))):
    p = os.path.join(OUT, f"{VER}_{tag}.glb")
    t = time.time()
    try:
        bpy.ops.export_scene.gltf(filepath=p, **common, **kw)
        rep[tag + "_MB"] = round(os.path.getsize(p) / 1e6, 1)
    except Exception as e:
        rep[tag + "_error"] = repr(e)[:300]
    rep[tag + "_s"] = round(time.time() - t, 1)
    print("EXPORT", tag, rep.get(tag + "_MB"), rep.get(tag + "_error", ""), flush=True)
json.dump(rep, open(os.path.join(OUT, f"{VER}_report.json"), "w"), indent=1)
print("REPORT", json.dumps({k: v for k, v in rep.items() if k != "by_asset"}))
