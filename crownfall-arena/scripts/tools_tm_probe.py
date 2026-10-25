"""Probe Terrain Mixer headless: append its setup via its own operator, dump structure, test-bake a tiny image.
python lib/run_blender.py scripts/tools_tm_probe.py --timeout 900
"""
import sys, os, json, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import tools_common as T

T.enable("terrainmixer")
out = {}
sc = bpy.context.scene
try:
    r = bpy.ops.object.replace_with_terrain()
    out["replace_with_terrain"] = str(r)
except Exception as e:
    out["replace_with_terrain"] = "FAIL " + repr(e)
    traceback.print_exc()


def sock_val(s):
    try:
        v = s.default_value
        try:
            return [round(x, 4) for x in v]
        except TypeError:
            return round(v, 4) if isinstance(v, float) else (v.name if hasattr(v, "name") else v)
    except Exception:
        return None


cols = {}
for c in bpy.data.collections:
    cols[c.name] = {"objects": [(o.name, o.type, o.data.name if o.data else None) for o in c.objects],
                    "children": [ch.name for ch in c.children]}
out["collections"] = cols
objs = {}
for o in bpy.data.objects:
    d = {"type": o.type, "loc": [round(x, 3) for x in o.location], "scale": [round(x, 3) for x in o.scale],
         "dims": [round(x, 3) for x in o.dimensions], "hide_render": o.hide_render,
         "props": {k: str(o[k])[:80] for k in o.keys()},
         "mods": [(m.name, m.type, getattr(m, "node_group", None) and m.node_group.name) for m in o.modifiers],
         "mats": [s.material.name if s.material else None for s in o.material_slots]}
    if o.type == "MESH":
        d["verts"] = len(o.data.vertices)
    if o.type == "CAMERA":
        d["cam"] = {"type": o.data.type, "ortho": o.data.ortho_scale, "rot": [round(x, 3) for x in o.rotation_euler]}
    for m in o.modifiers:
        if m.type == "NODES":
            try:
                d.setdefault("mod_inputs", {})[m.name] = {k: str(m[k])[:60] for k in m.keys()}
            except Exception:
                pass
        if m.type in ("SUBSURF", "DISPLACE"):
            d.setdefault("mod_detail", {})[m.name] = {a: str(getattr(m, a)) for a in ("levels", "render_levels", "strength", "mid_level", "texture", "texture_coords") if hasattr(m, a)}
    objs[o.name] = d
out["objects"] = objs
mats = {}
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    nodes = []
    for n in m.node_tree.nodes:
        e = {"name": n.name, "type": n.bl_idname, "label": n.label}
        if n.bl_idname == "ShaderNodeGroup" and n.node_tree:
            e["group"] = n.node_tree.name
            e["inputs"] = {i.name: sock_val(i) for i in n.inputs}
        if n.bl_idname == "ShaderNodeTexImage" and n.image:
            e["image"] = [n.image.name, n.image.filepath]
        if n.bl_idname == "ShaderNodeOutputMaterial":
            e["linked"] = {i.name: [(l.from_node.name, l.from_socket.name) for l in i.links] for i in n.inputs}
        nodes.append(e)
    mats[m.name] = {"nodes": nodes, "disp_method": getattr(m, "displacement_method", None)}
out["materials"] = mats
out["images"] = [(i.name, i.filepath, list(i.size), i.source) for i in bpy.data.images]
out["node_groups"] = {g.name: [(i.name, getattr(i, "in_out", "")) for i in g.interface.items_tree][:40] for g in bpy.data.node_groups
                      if g.name in ("TerrainShapeGN", "ValleysGN", "TextureControlGN", "Terramel_Lite", "Terramel Lite", "ScatterMaster", "Rock", "Shape Switch")}
out["scene"] = {"engine": sc.render.engine, "camera": sc.camera.name if sc.camera else None, "tm": {k: str(getattr(sc.terrain_mixer, k)) for k in ("tm_baking_mode_active",)}}
p = os.path.join(T.CL, "logs", "tools_tm_probe.json")
json.dump(out, open(p, "w"), indent=1, default=str)
print("TM_PROBE_DONE", p)
