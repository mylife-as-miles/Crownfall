"""TOOLS INTEGRATOR probe: verify every installed extension can be driven headless and dump the APIs we need.
python lib/run_blender.py scripts/tools_probe.py --timeout 600
"""
import sys, os, json, time, traceback
import bpy, addon_utils

EXT = r"C:\Users\MILES\AppData\Roaming\Blender Foundation\Blender\5.2\extensions\blender_org"
PK = ["Bagapie", "antlandscape", "arch_generator", "erosion_terrain_extension", "ivygen", "modular_tree", "terrainmixer", "ucupaint"]
for p in PK:
    try:
        addon_utils.enable("bl_ext.blender_org." + p, default_set=True, persistent=False)
    except Exception as e:
        print("ENABLE_FAIL", p, e)

out = {}

def sect(name, fn):
    t = time.time()
    try:
        out[name] = fn()
    except Exception as e:
        out[name] = "FAIL " + repr(e)
        traceback.print_exc()
    print("SECT", name, round(time.time() - t, 2), "s")

# ---------------------------------------------------------------- arch generator
def arch():
    r = {}
    bpy.ops.mesh.arch_create()
    o = bpy.context.view_layer.objects.active
    p = o.arch_props
    p.arch_style = "GOTHIC"; p.pillar_style = "FLUTED"; p.base_style = "ATTIC"; p.capital_style = "IONIC"
    r["gothic_fluted"] = (len(o.data.vertices), len(o.data.polygons), [round(v, 2) for v in o.dimensions])
    mod = sys.modules["bl_ext.blender_org.arch_generator.builders"]
    r["builders"] = [n for n in dir(mod) if not n.startswith("_")]
    return r
sect("arch", arch)

# ---------------------------------------------------------------- ivygen
def ivy():
    m = sys.modules["bl_ext.blender_org.ivygen"]
    return [n for n in dir(m) if not n.startswith("_")]
sect("ivy", ivy)

# ---------------------------------------------------------------- modular tree
def mtree():
    from m_tree import m_tree as M
    r = {"classes": [n for n in dir(M) if not n.startswith("_")]}
    for cn in ("TrunkFunction", "BranchFunction", "GrowthFunction", "ManifoldMesher", "Tree", "PipeRadiusFunction"):
        c = getattr(M, cn, None)
        if c is None:
            continue
        try:
            inst = c()
            attrs = {}
            for a in dir(inst):
                if a.startswith("_"):
                    continue
                try:
                    v = getattr(inst, a)
                    attrs[a] = repr(v)[:60]
                except Exception as e:
                    attrs[a] = "ERR"
            r[cn] = attrs
        except Exception as e:
            r[cn] = "ctor fail " + repr(e)
    b = M.BranchFunction()
    for s in ("distribution", "gravity", "split", "crown"):
        try:
            sub = getattr(b, s)
            r["Branch." + s] = {a: repr(getattr(sub, a))[:50] for a in dir(sub) if not a.startswith("_")}
        except Exception as e:
            r["Branch." + s] = repr(e)
    # quick tree
    tree = M.Tree()
    tr = M.TrunkFunction(); tr.seed = 3
    br = M.BranchFunction(); br.seed = 4
    tr.add_child(br); tree.set_trunk_function(tr); tree.execute_functions()
    me = M.ManifoldMesher(); me.radial_n_points = 8; me.smooth_iterations = 2
    cm = me.mesh_tree(tree)
    r["quick_verts"] = len(cm.get_vertices()) // 3
    r["quick_polys"] = len(cm.get_polygons()) // 4
    return r
sect("mtree", mtree)

# ---------------------------------------------------------------- A.N.T.
def ant():
    r = {}
    op = bpy.ops.mesh.landscape_add
    props = op.get_rna_type().properties
    r["props"] = {p.identifier: (p.type, getattr(p, "default", None) if p.type != "ENUM" else [i.identifier for i in p.enum_items])
                  for p in props if p.identifier not in ("rna_type",)}
    r["props"] = {k: (v[0], v[1] if not isinstance(v[1], (list,)) or len(v[1]) < 30 else v[1][:30]) for k, v in r["props"].items()}
    for k in list(r["props"]):
        v = r["props"][k]
        try:
            json.dumps(v)
        except Exception:
            r["props"][k] = (v[0], str(v[1]))
    res = op(refresh=True, subdivision_x=64, subdivision_y=64, noise_type="strata_hterrain")
    o = bpy.context.view_layer.objects.active
    r["result"] = [str(res), o.name if o else None, len(o.data.vertices) if o else 0, [round(x, 2) for x in o.dimensions] if o else None]
    r["eroder_props"] = [p.identifier for p in bpy.ops.mesh.eroder.get_rna_type().properties]
    return r
sect("ant", ant)

# ---------------------------------------------------------------- erosion terrain
def ero():
    m = sys.modules["bl_ext.blender_org.erosion_terrain_extension.terrain.terrain"]
    sc = bpy.context.scene
    tp = sc.terrain_props
    tp.grid_points_x = tp.grid_points_y = 48
    tp.iteration_amount = 300
    t = time.time()
    bpy.ops.noiseterrain.generate()
    bpy.ops.erosionterrain.generate()
    o = bpy.data.objects.get("Terrain")
    return {"fns": [n for n in dir(m) if not n.startswith("_")], "terrain": [len(o.data.vertices), [round(x, 2) for x in o.dimensions]], "s": round(time.time() - t, 2)}
sect("erosion", ero)

# ---------------------------------------------------------------- Bagapie node groups
def baga():
    r = {}
    for f in ("BagaPie_Nodes.blend", "BagaPie_Nodes_Tools.blend", "BagaPie_IvyGenerator.blend"):
        with bpy.data.libraries.load(os.path.join(EXT, "Bagapie", f), link=False) as (src, dst):
            r[f] = list(src.node_groups)
    with bpy.data.libraries.load(os.path.join(EXT, "Bagapie", "BagaPie_Nodes.blend"), link=False) as (src, dst):
        dst.node_groups = [n for n in src.node_groups if n in ("BagaPie_Scatter", "BagaPie_Column", "BagaPie_Wall")]
    for ng in dst.node_groups:
        if ng is None:
            continue
        r["iface_" + ng.name] = [(i.name, getattr(i, "socket_type", ""), repr(getattr(i, "default_value", ""))[:40])
                                 for i in ng.interface.items_tree if getattr(i, "in_out", "") == "INPUT"]
    return r
sect("bagapie", baga)

# ---------------------------------------------------------------- Terrain Mixer / Ucupaint
def tm():
    with bpy.data.libraries.load(os.path.join(EXT, "terrainmixer", "TerrainMixer.blend"), link=False) as (src, dst):
        return {"node_groups": list(src.node_groups)[:40], "materials": list(src.materials), "worlds": list(src.worlds),
                "objects": list(src.objects)[:20]}
sect("terrainmixer", tm)
sect("ucupaint", lambda: [c for c in dir(bpy.ops) if "yp" in c.lower() or "ucu" in c.lower()] + [o for o in dir(bpy.ops.wm) if o.startswith("y_")][:15] + [o for o in dir(bpy.ops.node) if o.startswith("y_")][:25])

p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs", "tools_probe.json")
json.dump(out, open(p, "w"), indent=1, default=str)
print("PROBE_DONE", p)
