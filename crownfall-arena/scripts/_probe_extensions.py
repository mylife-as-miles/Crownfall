import bpy, addon_utils, json
pk = ["Bagapie", "antlandscape", "arch_generator", "erosion_terrain_extension", "ivygen", "modular_tree", "terrainmixer", "ucupaint"]
res = {}
for p in pk:
    mod = "bl_ext.blender_org." + p
    try:
        addon_utils.enable(mod, default_set=True, persistent=False)
        ok = mod in {m.__name__ for m in addon_utils.modules()} and addon_utils.check(mod)[1]
    except Exception as e:
        ok = f"ERR {e}"
    res[p] = {"enabled": ok}
# operator namespaces that appeared
cats = {}
for cat in dir(bpy.ops):
    if any(k in cat.lower() for k in ("bagapie", "ant", "arch", "erosion", "ivy", "mtree", "modular", "terrain", "ucupaint", "tree")):
        try: cats[cat] = [o for o in dir(getattr(bpy.ops, cat)) if not o.startswith("_")][:25]
        except Exception: pass
print("PROBE", json.dumps(res))
for k, v in cats.items(): print("OPS", k, v)
ng = [g.name for g in bpy.data.node_groups]
print("NODEGROUPS", ng[:20])
