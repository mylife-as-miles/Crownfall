"""CFCL_Tools_Trees - gnarled ancient trees (E33 direction: dense rounded crown clusters, crimson/oxblood and
coral-like branching trees, a dark-green dense crown for ledges) built with the MODULAR TREE extension.

Modular Tree (bl_ext.blender_org.modular_tree, native m_tree 5.6) is driven headless through its own API:
  * m_tree.TrunkFunction -> BranchFunction -> sub BranchFunction, Tree.execute_functions(),
    m_tree.ManifoldMesher().mesh_tree()  (exactly what its mtree.quick_generate operator does),
  * python_classes.mesh_utils.create_mesh_from_cpp() -> Blender mesh with its radius/direction attributes,
  * python_classes.resources.node_groups.distribute_leaves() -> its leaf-distribution GN modifier, fed with our
    low-poly leaf card, then applied (instances realised).
Our code adds: a twist (SimpleDeform), rounded crown clumps of leaf cards at the twig ends (E33 crowns),
a cf_sdf boulder the tree grows from and cf_vegetation.root_mesh roots gripping it, cf_materials
(Bark / CrimsonLeaf / Fern / Basalt).
Usage: python lib/run_blender.py scripts/tools_trees.py --timeout 2400 -- [render 1/0]
"""
import sys, os, json, math, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree
import tools_common as T
import cf_render as R
import cf_materials as M
import cf_sdf as S
import cf_vegetation as V

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = (argv[0] != "0") if argv else True
ASSET = "CFCL_Tools_Trees"
VER = T.next_version(ASSET)
RDIR = os.path.join(T.CL, "renders", "tools", "trees")
os.makedirs(RDIR, exist_ok=True)
LOG = {"asset": ASSET, "version": VER, "trees": {}, "warnings": []}
t0 = time.time()

R.reset_scene()
T.enable("modular_tree")
from m_tree import m_tree as MT  # noqa: E402  (installed from the extension's wheel)
MTU = sys.modules["bl_ext.blender_org.modular_tree.python_classes.mesh_utils"]
NGM = sys.modules["bl_ext.blender_org.modular_tree.python_classes.resources.node_groups"]
sc = bpy.context.scene
col = bpy.data.collections.new(ASSET)
sc.collection.children.link(col)
V.set_material_lib(M) if hasattr(V, "set_material_lib") else None


def PW(v):
    return MT.PropertyWrapper(MT.ConstantProperty(float(v)))


NEST = {"start": ("distribution", "start"), "end": ("distribution", "end"), "density": ("distribution", "density"),
        "gravity": ("gravity", "strength"), "stiffness": ("gravity", "stiffness"), "up": ("gravity", "up_attraction"),
        "split": ("split", "probability"), "split_angle": ("split", "angle"), "split_radius": ("split", "radius")}
WRAP = {"length", "start_radius", "randomness", "start_angle"}


def branch_fn(seed, **kw):
    b = MT.BranchFunction()
    b.seed = seed
    for k, v in kw.items():
        if k in NEST:
            setattr(getattr(b, NEST[k][0]), NEST[k][1], float(v))
        elif k in WRAP:
            setattr(b, k, PW(v))
        else:
            setattr(b, k, v)
    return b


SPECS = {
    "CrimsonCrown": dict(seed=17, height=4.6, twist=95, radial=9, crown="CrimsonLeaf", leaf_scale=0.32, leaf_density=6,
                         clumps=11, clump_r=(0.75, 1.15), clump_leaves=300, leaf_size=0.23, blob=0.66,
                         trunk=dict(length=8, start_radius=1.05, end_radius=0.14, shape=0.45, up_attraction=0.2,
                                    resolution=2.0, randomness=0.65),
                         br=dict(start=0.38, end=0.97, length=5.2, density=1.3, start_angle=48, randomness=0.55,
                                 gravity=3.0, stiffness=0.3, up=0.35, split=0.55, split_angle=38, break_chance=0.03,
                                 flatness=0.25, start_radius=0.5, resolution=2.0, end_radius=0.05),
                         sub=dict(start=0.25, end=0.95, length=2.0, density=2.0, start_angle=42, randomness=0.5,
                                  gravity=2.5, up=0.45, split=0.35, start_radius=0.45, resolution=2.0, end_radius=0.03),
                         roots=5, rock=(1.7, 1.4, 1.0)),
    "CoralTree": dict(seed=29, height=4.0, twist=40, radial=6, crown="CrimsonLeaf", leaf_scale=0.25, leaf_density=8,
                      clumps=0, clump_r=(0.3, 0.5), clump_leaves=0, leaf_size=0.22, bark="coral",
                      trunk=dict(length=4.5, start_radius=0.55, end_radius=0.14, shape=0.45, up_attraction=0.5,
                                 resolution=2.0, randomness=0.45),
                      br=dict(start=0.18, end=0.98, length=4.2, density=1.6, start_angle=34, randomness=0.42,
                              gravity=0.6, stiffness=0.6, up=0.75, split=0.85, split_angle=32, split_radius=0.85,
                              break_chance=0.05, flatness=0.6, start_radius=0.66, resolution=2.0, end_radius=0.12),
                      sub=dict(start=0.15, end=0.95, length=1.3, density=2.2, start_angle=36, randomness=0.4,
                               gravity=0.4, up=0.8, split=0.7, split_angle=30, start_radius=0.65, resolution=2.0,
                               end_radius=0.11),
                      roots=4, rock=(1.3, 1.2, 0.8)),
    "GreenCrown": dict(seed=41, height=3.8, twist=80, radial=9, crown="Fern", leaf_scale=0.3, leaf_density=6,
                       clumps=9, clump_r=(0.75, 1.2), clump_leaves=300, leaf_size=0.23, blob=0.66,
                       trunk=dict(length=5, start_radius=0.95, end_radius=0.14, shape=0.45, up_attraction=0.2,
                                  resolution=2.0, randomness=0.6),
                       br=dict(start=0.32, end=0.95, length=4.6, density=1.6, start_angle=62, randomness=0.55,
                               gravity=4.0, stiffness=0.25, up=0.3, split=0.55, split_angle=40, break_chance=0.02,
                               flatness=0.45, start_radius=0.5, resolution=2.0, end_radius=0.05),
                       sub=dict(start=0.2, end=0.95, length=1.8, density=2.2, start_angle=48, randomness=0.5,
                                gravity=2.0, up=0.4, split=0.35, start_radius=0.45, resolution=2.0, end_radius=0.03),
                       roots=4, rock=(1.5, 1.2, 0.85)),
}


def leaf_card():
    """Low-poly diamond leaf (2 tris), m_tree convention (+Y along), cf foliage UV contract."""
    me = bpy.data.meshes.new("CFCL_ToolLeafCard")
    verts = [(0, 0, 0), (-0.34, 0.42, 0.04), (0, 1.0, 0.02), (0.34, 0.42, 0.04)]
    me.from_pydata(verts, [], [(0, 3, 2, 1)])
    uv = me.uv_layers.new(name="UVMap")
    for li, vi in enumerate([0, 3, 2, 1]):
        x, y, _ = verts[vi]
        uv.data[li].uv = (x / 0.34, y)
    for nm, val in (("cf_part", 0.0), ("cf_rand", 0.5), ("cf_leafmark", 1.0)):
        a = me.attributes.new(nm, "FLOAT", "POINT")
        a.data.foreach_set("value", np.full(4, val, np.float32))
    ob = bpy.data.objects.new("CFCL_ToolLeafCard", me)
    return ob


LEAF = leaf_card()
REALIZE = bpy.data.node_groups.new("CFCL_RealizeInstances", "GeometryNodeTree")
REALIZE.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
REALIZE.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
_gi = REALIZE.nodes.new("NodeGroupInput"); _go = REALIZE.nodes.new("NodeGroupOutput")
_rn = REALIZE.nodes.new("GeometryNodeRealizeInstances")
REALIZE.links.new(_gi.outputs[0], _rn.inputs[0]); REALIZE.links.new(_rn.outputs[0], _go.inputs[0])


def rock(name, rx, ry, rz, seed):
    """Half-buried boulder (cf_sdf, fbm + warp), origin at ground contact; bottom 35% below z=0."""
    def f(P):
        Q = S.warp(P, 0.12, 0.8, seed=seed)
        d = S.box(Q, (0, 0, rz * 0.25), (rx * 0.85, ry * 0.85, rz * 0.8), R=S.rot_matrix(0, 0, 17), round_r=min(rx, rz) * 0.25)
        d = S.smin(d, S.box(Q, (rx * 0.35, -ry * 0.2, rz * 0.6), (rx * 0.5, ry * 0.55, rz * 0.6), R=S.rot_matrix(6, -9, 38), round_r=0.1), 0.15)
        d = d + 0.07 * S.fbm(Q, 1.4, 3, seed=seed) * min(rx, rz) + 0.04 * S.ridged(Q, 3.0, 2, seed=seed + 1) * min(rx, rz)
        return S.smax(d, -(P[:, 2] + rz * 0.45), 0.05)
    v, q = S.mesh_sdf(f, (-rx * 1.4, -ry * 1.4, -rz * 0.5), (rx * 1.4, ry * 1.4, rz * 1.6), min(rx, ry, rz) / 16, verbose=False)
    ob = S.to_blender_mesh(name, v, q, collection=col)
    dm = ob.modifiers.new("dec", "DECIMATE"); dm.ratio = min(1.0, 2600 / max(1, 2 * len(q)))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=dm.name)
    return ob


def make_tree(name, sp):
    tree = MT.Tree()
    tr = MT.TrunkFunction()
    tr.seed = sp["seed"]
    for k, v in sp["trunk"].items():
        setattr(tr, k, v)
    br = branch_fn(sp["seed"] + 1, **sp["br"])
    sub = branch_fn(sp["seed"] + 2, **sp["sub"])
    br.add_child(sub)
    tr.add_child(br)
    tree.set_trunk_function(tr)
    tree.execute_functions()
    mesher = MT.ManifoldMesher()
    mesher.radial_n_points = sp["radial"]
    mesher.smooth_iterations = 2
    cm = mesher.mesh_tree(tree)
    me = bpy.data.meshes.new(name + "_Wood")
    MTU.create_mesh_from_cpp(me, cm)
    ob = bpy.data.objects.new(name + "_Wood", me)
    col.objects.link(ob)
    return ob


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o is ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def clumps(mb, wood, sp, rng, s):
    """E33 crowns: rounded clusters of leaf cards around twig ends (thin vertices of the wood mesh)."""
    me = wood.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    rad = np.empty(n, np.float32); me.attributes["radius"].data.foreach_get("value", rad)
    thin = co[(rad < np.percentile(rad, 12)) & (co[:, 2] > co[:, 2].max() * 0.45)]
    if len(thin) == 0 or sp["clumps"] == 0:
        return 0
    # farthest-point sampling for well-spread clump centres
    idx = [int(np.argmax(thin[:, 2]))]
    dmin = np.linalg.norm(thin - thin[idx[0]], axis=1)
    for _ in range(sp["clumps"] - 1):
        i = int(np.argmax(dmin)); idx.append(i)
        dmin = np.minimum(dmin, np.linalg.norm(thin - thin[i], axis=1))
    count = 0
    for ci in idx:
        c = thin[ci]
        rc = rng.uniform(*sp["clump_r"]) / s
        # inner mass: low-poly displaced ico blob (leaf material, dark interior) so light cannot pass through
        bmp = bmesh.new()
        bmesh.ops.create_icosphere(bmp, subdivisions=2, radius=rc * sp.get("blob", 0.5))
        sd = rng.random() * 40
        for v in bmp.verts:
            v.co *= 1.0 + 0.38 * noise.noise(v.co * (3.0 / rc) + Vector((sd, 0, 0)))
            v.co.z *= 0.8
        base_i = len(mb.co)
        rr = rng.random()
        for v in bmp.verts:
            mb.v(c + np.array(v.co[:]), (0.0, 0.5), 0.0, rr)
        for fce in bmp.faces:
            mb.f(tuple(base_i + vv.index for vv in fce.verts), mat=1)      # inner mass: own (shadowed) material
        bmp.free()
        for _ in range(sp["clump_leaves"]):
            d = rng.normal(size=3); d[2] = abs(d[2]) * 0.8 + 0.25; d /= np.linalg.norm(d)
            p = c + d * rc * rng.uniform(0.62, 1.05)
            # leaf lies roughly tangent to the clump (faces outward), random spin, droops a little
            t1 = np.cross(d, [0.0, 0.0, 1.0]); t1 = t1 / (np.linalg.norm(t1) + 1e-9)
            t2 = np.cross(d, t1)
            a = rng.uniform(0, 2 * math.pi)
            along = (math.cos(a) * t1 + math.sin(a) * t2)
            along = along - np.array([0, 0, 0.35]); along /= np.linalg.norm(along)
            across = np.cross(d, along)
            L = sp["leaf_size"] / s * rng.uniform(0.7, 1.25)
            W = L * 0.42
            rr = rng.random()
            v0 = mb.v(p - along * L * 0.5, (0, 0), 0.0, rr)
            v1 = mb.v(p - along * L * 0.08 - across * W + d * L * 0.06, (-1, 0.42), 0.0, rr)
            v2 = mb.v(p + along * L * 0.5, (0, 1), 0.0, rr)
            v3 = mb.v(p - along * L * 0.08 + across * W + d * L * 0.06, (1, 0.42), 0.0, rr)
            mb.f((v0, v3, v2, v1))
            count += 1
    return count


def coral_material():
    m = M.get("Bark", moss=0.05).copy()
    m.name = "CFCL_Tools_CoralBark"
    nt = m.node_tree
    pr = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bc = pr.inputs["Base Color"]
    src = bc.links[0].from_socket
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(src, mix.inputs["A"])
    mix.inputs["B"].default_value = (1.7, 0.30, 0.28, 1.0)       # oxblood coral tint over the bark furrows
    nt.links.new(mix.outputs["Result"], bc)
    return m


CORAL = coral_material()
objs = []
for name, sp in SPECS.items():
    t1 = time.time()
    rng = np.random.default_rng(sp["seed"])
    full = "CFCL_ToolTree_" + name
    wood = make_tree(full, sp)
    mn, mx = R.bounds([wood])
    s = sp["height"] / max(mx.z - mn.z, 1e-3)               # m_tree units -> env
    LOG["trees"][name] = {"mtree_verts": len(wood.data.vertices), "mtree_height_units": round(mx.z - mn.z, 2)}
    # twist like an ancient trunk (SimpleDeform about Z at the base)
    tw = wood.modifiers.new("Twist", "SIMPLE_DEFORM")
    tw.deform_method = "TWIST"; tw.angle = math.radians(sp["twist"]); tw.deform_axis = "Z"
    # leaves through Modular Tree's own distribution node group, then realised
    leaves_ob = None
    try:
        NGM.distribute_leaves(wood, leaf_object=LEAF, density=sp["leaf_density"], scale=sp["leaf_scale"], max_radius=0.06)
        lm = wood.modifiers.get(NGM.LEAVES_MODIFIER_NAME)
        rz = wood.modifiers.new("Realize", "NODES"); rz.node_group = REALIZE
        # evaluate leaves separately so wood and leaves get their own materials
        dg = bpy.context.evaluated_depsgraph_get()
        lme = bpy.data.meshes.new_from_object(wood.evaluated_get(dg))
        wood.modifiers.remove(lm); wood.modifiers.remove(wood.modifiers["Realize"])
        apply_mods(wood)                                       # twist
        same = np.allclose(np.array([v.co[:] for v in lme.vertices[:50]]), np.array([v.co[:] for v in wood.data.vertices[:50]]), atol=1e-4)
        LOG["trees"][name]["leaf_split_check"] = bool(same)
        nw = len(wood.data.vertices)
        bm = bmesh.new(); bm.from_mesh(lme); bm.verts.ensure_lookup_table()
        # wood part of the evaluated mesh = first faces with the tree's vertex count; keep only leaves
        lmk = bm.verts.layers.float.get("cf_leafmark")
        kill = [v for v in bm.verts if lmk is None or v[lmk] < 0.5]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
        bm.to_mesh(lme); bm.free()
        leaves_ob = bpy.data.objects.new(full + "_LeavesMT", lme)
        col.objects.link(leaves_ob)
        LOG["trees"][name]["mtree_leaf_tris"] = T.tri_count([leaves_ob])
    except Exception as e:
        LOG["warnings"].append(f"{name} distribute_leaves: {e!r}")
        for m in list(wood.modifiers):
            if m.type == "NODES":
                wood.modifiers.remove(m)
        apply_mods(wood)
    # crown clumps (own) in m_tree units
    mb = V.MB()
    nclump = clumps(mb, wood, sp, rng, s)
    dk = bpy.data.materials.get(f"CFCL_Tools_{sp['crown']}_Interior")
    if dk is None:
        # plain, dark, rough, NON-translucent crown core (the foliage shader's translucency made the cores glow)
        dk = bpy.data.materials.new(f"CFCL_Tools_{sp['crown']}_Interior")
        dk.use_nodes = True
        _pr = next(n for n in dk.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
        _pr.inputs["Base Color"].default_value = (0.028, 0.006, 0.007, 1) if "Crimson" in sp["crown"] else (0.011, 0.015, 0.006, 1)
        _pr.inputs["Roughness"].default_value = 0.95
    # slots must exist BEFORE MB.to_object's mesh.validate(), or it clamps material_index 1 -> 0
    clump_ob = mb.to_object(full + "_Crown", materials=(M.get(sp["crown"]), dk), collection=col) if nclump else None
    # scale everything to env, origin at trunk base
    parts = [o for o in (wood, leaves_ob, clump_ob) if o]
    for o in parts:
        o.data.transform(Matrix.Scale(s, 4))
    # random per-leaf cf_rand for the m_tree leaves (blocks of 4 verts = one card)
    for lo in [o for o in (leaves_ob,) if o]:
        nv = len(lo.data.vertices)
        a = lo.data.attributes.get("cf_rand") or lo.data.attributes.new("cf_rand", "FLOAT", "POINT")
        a.data.foreach_set("value", np.repeat(rng.random(nv // 4 + 1), 4)[:nv].astype(np.float32))
    # boulder + roots gripping it
    rx, ry, rz = sp["rock"]
    rk = rock(full + "_Rock", rx, ry, rz, sp["seed"])
    rk.location = (0, 0, 0)
    top_z = max(v.co.z for v in rk.data.vertices if abs(v.co.x) < rx * 0.25 and abs(v.co.y) < ry * 0.25)
    for o in parts:
        o.data.transform(Matrix.Translation((0, 0, top_z - 0.15)))
    bvh = BVHTree.FromObject(rk, bpy.context.evaluated_depsgraph_get())
    rmb = V.MB()
    base_r = float(sp["trunk"]["start_radius"]) * s
    for k in range(sp["roots"]):
        a = 2 * math.pi * k / sp["roots"] + rng.uniform(-0.3, 0.3)
        st = np.array([math.cos(a) * base_r * 0.8, math.sin(a) * base_r * 0.8, top_z + 0.1])
        dr = np.array([math.cos(a), math.sin(a), -0.35])
        V.root_mesh(rmb, bvh, st, dr, rng.uniform(1.8, 2.8), base_r * rng.uniform(0.35, 0.5), rng, depth=1, nbranch=2,
                    seed=sp["seed"] * 10 + k)
    roots_ob = rmb.to_object(full + "_Roots", collection=col)
    # materials
    if sp.get("bark") == "coral":
        wood.data.materials.append(CORAL); roots_ob.data.materials.append(CORAL)
    else:
        M.assign(wood, "Bark", moss=0.25); M.assign(roots_ob, "Root")
    M.assign(rk, "Basalt", curvature=True, moss=0.55)
    if leaves_ob is not None:
        M.assign(leaves_ob, sp["crown"])
    # join to one object per tree (material slots kept); budget decimate on wood/roots only
    for o in (wood, roots_ob):
        tri = T.tri_count([o])
        lim = 17000 if o is wood else 5000
        if tri > lim:
            d = o.modifiers.new("budget", "DECIMATE"); d.ratio = lim / tri
            apply_mods(o)
    pieces = [o for o in (rk, wood, roots_ob, leaves_ob, clump_ob) if o]
    for o in bpy.context.view_layer.objects:
        o.select_set(o in pieces)
    bpy.context.view_layer.objects.active = wood
    bpy.ops.object.join()
    wood.name = full
    wood.data.name = full
    for a in ("radius", "stem_id", "hierarchy_depth", "branch_extent", "direction", "pivot_position", "phyllotaxis_angle", "vein_distance"):
        if a in wood.data.attributes:
            wood.data.attributes.remove(wood.data.attributes[a])
    objs.append(wood)
    mn, mx = R.bounds([wood])
    LOG["trees"][name].update({"tris": T.tri_count([wood]), "bounds_env": [[round(v, 2) for v in mn], [round(v, 2) for v in mx]],
                               "clump_leaves": nclump * 2, "s": round(time.time() - t1, 1),
                               "materials": [m.name for m in wood.data.materials]})
    print("[tree]", name, LOG["trees"][name], flush=True)

bpy.data.objects.remove(LEAF)
# ---------------------------------------------------------------- placements
PLACE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools_trees_layout.json")))
ground = T.load_ground()
placements = []
LOG["placements"] = {}
by = {o.name: o for o in objs}
for pl in PLACE["placements"]:
    src = by.get(pl["source"])
    if not src:
        continue
    x, y = pl["xy"]
    gz, nm, nor = T.ground_z(ground, x, y)
    zs = [T.ground_z(ground, x + dx, y + dy)[0] for dx, dy in ((0.6, 0), (-0.6, 0), (0, 0.6), (0, -0.6))]
    zs = [z for z in zs if z is not None]
    if gz is None:
        LOG["warnings"].append(f"{pl['name']}: no ground"); gz = 0.0
    z = min([gz] + zs) - 0.1
    rec = {"source": src.name, "name": pl["name"], "location": [x, y, round(z, 3)], "rotation_deg": [0, 0, pl.get("yaw", 0)],
           "scale": [pl.get("scale", 1.0)] * 3}
    ob2 = src.copy(); col.objects.link(ob2)
    ob2.location = rec["location"]; ob2.rotation_euler = (0, 0, math.radians(rec["rotation_deg"][2])); ob2.scale = rec["scale"]
    bpy.context.view_layer.update()
    chk = T.placement_check(T.world_verts_env([ob2], 3000))
    chk["ground"] = nm
    chk["ground_spread"] = round(max(zs + [gz]) - min(zs + [gz]), 2)
    bpy.data.objects.remove(ob2)
    rec["check"] = chk
    placements.append(rec)
    LOG["placements"][pl["name"]] = chk
    print("[tree] place", pl["name"], json.dumps(chk), flush=True)
c = bpy.data.collections.get("TOOLS_GroundRef")
if c:
    for o in list(c.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(c)
bpy.ops.outliner.orphans_purge(do_recursive=True)
for i, o in enumerate(objs):                       # lineup inside the file (origin = ground contact)
    o.location = (i * 9.0, 0, 0)
blend = T.save_blend(ASSET, VER)
for o in objs:
    o.location = (0, 0, 0)
arr = {"asset": ASSET, "blend": os.path.basename(blend), "units": "env (main build: world = env*4.6 + (0,0,1.94))",
       "placements": [{k: v for k, v in r.items() if k in ("source", "name", "location", "rotation_deg", "scale")} for r in placements]}
T.write_json(os.path.join(T.asset_dir(ASSET), "arrangement.json"), arr)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)

if DO_RENDER:
    R.setup_render(sc, "EEVEE", (1100, 720), 48)
    R.setup_world(sc)
    R.standard_lights(25.0)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, T.ENV_DZ - 0.02))
    gnd = bpy.context.active_object; M.assign(gnd, "Basalt", moss=0.3)
    for o in objs:
        o.hide_render = True
    T.to_world_scale(objs)
    LOG["renders"] = {}
    for o in objs:
        o.hide_render = False
        mn, mx = R.bounds([o]); c = (mn + mx) / 2; size = (mx - mn).length
        short = o.name.replace("CFCL_ToolTree_", "")
        for vn, az, el, dm, lens, tz in (("front", 10, 8, 1.0, 35, 0.5), ("side", 100, 12, 1.0, 35, 0.5),
                                          ("low_back", 200, 2, 0.9, 28, 0.55), ("roots", 35, 18, 0.38, 40, 0.12)):
            a_, e_ = math.radians(az), math.radians(el)
            tgt = Vector((c.x, c.y, mn.z + (mx.z - mn.z) * tz))
            loc = tgt + Vector((math.sin(a_) * math.cos(e_), -math.cos(a_) * math.cos(e_), math.sin(e_))) * size * dm * (35 / lens) * 1.2
            cam = T.view_cam(f"CAM_{short}_{vn}", loc, tgt, lens)
            pth = os.path.join(RDIR, f"tree_v{VER:03d}_{short}_{vn}.png")
            T.render(pth, cam)
            LOG["renders"][f"{short}_{vn}"] = os.path.relpath(pth, T.CL)
        o.hide_render = True
LOG["seconds"] = round(time.time() - t0, 1)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
print("TREES_DONE", json.dumps({"trees": LOG["trees"], "warnings": LOG["warnings"]})[:3000])
