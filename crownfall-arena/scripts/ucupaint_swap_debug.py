"""Debug: append Ucupaint runtime objects into a main blend (read-only, never saved) and report material/image status.
python lib/run_blender.py scripts/ucupaint_swap_debug.py -- <main.blend> skull=8 hand=4"""
import sys
import os
import bpy

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0], load_ui=False)
MON = {"skull": ("CFCL_Ucupaint_Skull", ["CFCL_Hero_Skull"]), "hand": ("CFCL_Ucupaint_Hand", ["CFCL_Hero_Hand"])}
for a in argv[1:]:
    k, v = a.split("=")
    asset, names = MON[k]
    blend = os.path.join(CL, "assets", asset, "%s_v%03d.blend" % (asset, int(v)))
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.objects = list(names)
    for o in dst.objects:
        print("[dbg]", k, o.name, "mats", [s.material.name if s.material else None for s in o.material_slots],
              "uv", [u.name for u in o.data.uv_layers], "active_render",
              [u.name for u in o.data.uv_layers if u.active_render], flush=True)
        for s in o.material_slots:
            m = s.material
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE":
                    im = n.image
                    print("[dbg]   img", im.name, "path", im.filepath, "abs", bpy.path.abspath(im.filepath),
                          "exists", os.path.exists(bpy.path.abspath(im.filepath)), "size", tuple(im.size),
                          "has_data", im.has_data, "cs", im.colorspace_settings.name, flush=True)
                if n.type == "BSDF_PRINCIPLED":
                    print("[dbg]   bsdf metallic link", n.inputs["Metallic"].is_linked,
                          "default", n.inputs["Metallic"].default_value, flush=True)
    old = bpy.data.objects.get(names[0])
    print("[dbg] old", old.name if old else None, "mats", [s.material.name for s in old.material_slots] if old else None,
          flush=True)
print("[dbg] main filepath", bpy.data.filepath)
