"""Inspect moss-shell attributes in a saved dress demo (debug helper, read-only).
python lib/run_blender.py scripts/cfcl_veg_inspect.py -- <demo.blend>"""
import sys
import bpy
import numpy as np

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=path)
for o in bpy.data.objects:
    if o.name.endswith("_MossShell") and o.type == "MESH":
        me = o.data
        a = me.attributes.get("cf_edge")
        n = len(me.vertices)
        info = {"obj": o.name, "verts": n, "faces": len(me.polygons), "mats": [m.name if m else None for m in me.materials],
                "mods": [(m.type, getattr(m, "thickness", None)) for m in o.modifiers]}
        if a:
            v = np.empty(n, np.float32)
            a.data.foreach_get("value", v)
            info.update(edge_min=float(v.min()), edge_mean=float(v.mean()), edge_frac_gt_0p5=float((v > 0.5).mean()),
                        domain=a.domain, dtype=a.data_type)
        else:
            info["cf_edge"] = "MISSING"
        mi = np.empty(len(me.polygons), np.int32)
        me.polygons.foreach_get("material_index", mi)
        info["dry_frac"] = float((mi == 1).mean())
        m = me.materials[0]
        info["moss_has_cf_edge_node"] = any(nd.bl_idname == "ShaderNodeAttribute" and nd.attribute_name == "cf_edge"
                                            for nd in m.node_tree.nodes)
        print("[inspect]", info, flush=True)
