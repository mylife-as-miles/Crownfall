"""CFCL_Tools_Debris - masonry chips / pebbles scattered with BAGAPIE's scatter node group, baked to real meshes.

Bagapie's wm.scatter operator needs a viewport selection (and weight-paint toggles), so headless we use its
node group directly: BagaPie_Scatter is appended from Bagapie/BagaPie_Nodes.blend (the same file its
Import_Nodes() appends from) and wired into a Geometry Nodes modifier on a copy of each target surface:
    Group Input -> BagaPie_Scatter(Collection = our chip kit, Distance Min, Density Max, Seed, Scale, Random
    Rotation, WEIGHT_PAINT_INPUT = named attribute 'debris_w') -> Realize Instances -> Group Output
The evaluated result (chips only) is baked into one mesh per surface.  The weight keeps chips off the dais/board
(env r < 5.2), off steep faces, and concentrates them near monument/ruin bases.
Usage: python lib/run_blender.py scripts/tools_debris.py --timeout 1800 -- [render 1/0]
"""
import sys, os, json, math, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, noise
import tools_common as T
import cf_render as R
import cf_materials as M
import cf_integrate as I

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = (argv[0] != "0") if argv else True
ASSET = "CFCL_Tools_Debris"
VER = T.next_version(ASSET)
RDIR = os.path.join(T.CL, "renders", "tools", "debris")
os.makedirs(RDIR, exist_ok=True)
LOG = {"asset": ASSET, "version": VER, "surfaces": {}, "warnings": []}
BUDGET = 78000
R.reset_scene()
T.enable("Bagapie")
sc = bpy.context.scene
col = bpy.data.collections.new(ASSET); sc.collection.children.link(col)
kit = bpy.data.collections.new("TOOLS_DebrisKit"); sc.collection.children.link(kit)

# ---------------------------------------------------------------- chip kit (low-poly, unit-ish sizes in env)
rng = random.Random(3)


def chip(i):
    bm = bmesh.new()
    if i % 3 == 2:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
        for v in bm.verts:
            v.co *= 1 + 0.25 * noise.noise(v.co * 2.0 + Vector((i, 0, 0)))
        bmesh.ops.scale(bm, vec=(1.0, rng.uniform(0.6, 0.9), rng.uniform(0.35, 0.6)), verts=bm.verts)
    else:
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(rng.uniform(0.7, 1.4), rng.uniform(0.5, 1.0), rng.uniform(0.3, 0.6)), verts=bm.verts)
        for _ in range(3):
            n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 1))).normalized()
            far = max(v.co.dot(n) for v in bm.verts)
            geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=n * (far - rng.uniform(0.12, 0.3)), plane_no=n, clear_outer=True)
            bnd = [e for e in bm.edges if e.is_boundary]
            if bnd:
                bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mn = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -mn * 0.75), verts=bm.verts)     # sits slightly sunk
    me = bpy.data.meshes.new(f"CFCL_DebrisChip_{i}")
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(f"CFCL_DebrisChip_{i}", me)
    kit.objects.link(o)
    return o


chips = [chip(i) for i in range(9)]
stone = M.get("AncientStone", moss=0.3)
for c in chips:
    c.data.materials.append(stone)
LOG["kit_tris"] = [T.tri_count([c]) for c in chips]

# ---------------------------------------------------------------- Bagapie scatter node group
with bpy.data.libraries.load(os.path.join(T.EXT_DIR, "Bagapie", "BagaPie_Nodes.blend"), link=False) as (src, dst):
    dst.node_groups = ["BagaPie_Scatter"]
BS = bpy.data.node_groups["BagaPie_Scatter"]


def scatter_tree(seed, density, dmin, smin, smax):
    ng = bpy.data.node_groups.new(f"CFCL_DebrisScatter_{seed}", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi = ng.nodes.new("NodeGroupInput"); go = ng.nodes.new("NodeGroupOutput")
    s = ng.nodes.new("GeometryNodeGroup"); s.node_tree = BS
    na = ng.nodes.new("GeometryNodeInputNamedAttribute"); na.data_type = "FLOAT"; na.inputs["Name"].default_value = "debris_w"
    rz = ng.nodes.new("GeometryNodeRealizeInstances")
    ng.links.new(gi.outputs[0], s.inputs["Geometry"])
    vals = {"Collection": kit, "Distance Min": dmin, "Density Max": density, "Seed": seed, "Align Z": 0.6,
            "Scale Min": smin, "Scale Max": smax, "Viewport display %": 100.0}
    for k, v in vals.items():
        try:
            s.inputs[k].default_value = v
        except Exception as e:
            LOG["warnings"].append(f"input {k}: {e!r}")
    try:
        s.inputs["Random Rotation Max"].default_value = (math.radians(25), math.radians(25), math.radians(360))
    except Exception:
        pass
    try:
        ng.links.new(na.outputs["Attribute"], s.inputs["WEIGHT_PAINT_INPUT"])
    except Exception as e:
        LOG["warnings"].append(f"weight link: {e!r}")
    ng.links.new(s.outputs[0], rz.inputs[0])
    ng.links.new(rz.outputs[0], go.inputs[0])
    return ng


# ---------------------------------------------------------------- target surfaces (placed like the main build)
ref = bpy.data.collections.new("TOOLS_Surfaces"); sc.collection.children.link(ref)
I.append_asset(os.path.join(T.CL, "assets", "CFCL_Terrain_Central"), ref, 1.0, [])
bpy.context.view_layer.update()                    # append_asset sets loc/rot/scale; matrix_world is stale until updated
anchors = [(-2.86, 9.48), (4.5, 10.0), (-4.7, 9.9), (5.2, 10.9), (-7.0, 15.0), (7.9, 5.4), (-7.9, 5.8), (3.4, 8.0)]
SURF = [("CFCL_Terrain_SkullSeat", 9.0, 0.05), ("CFCL_Terrain_HandSeat", 9.0, 0.05), ("CFCL_Terrain_Central", 6.0, 0.06),
        ("CFCL_Terrain_RearSlabs", 7.0, 0.05)]
outs = []
for k, (name, dens, dmin) in enumerate(SURF):
    src = bpy.data.objects.get(name)
    if src is None:
        LOG["warnings"].append(f"surface {name} missing"); continue
    tgt = src.copy(); tgt.data = src.data.copy(); col.objects.link(tgt)
    tgt.data.transform(tgt.matrix_world); tgt.matrix_world = Matrix.Identity(4)
    me = tgt.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    nr = np.empty(n * 3, np.float32); me.vertices.foreach_get("normal", nr); nr = nr.reshape(-1, 3)
    r = np.hypot(co[:, 0], co[:, 1])
    dA = np.min(np.stack([np.hypot(co[:, 0] - ax, co[:, 1] - ay) for ax, ay in anchors], 1), 1)
    w = np.clip((r - 5.2) / 0.8, 0, 1) * np.clip((nr[:, 2] - 0.55) / 0.3, 0, 1) * (0.25 + 0.75 * np.clip(1.6 - dA / 2.2, 0, 1))
    a = me.attributes.new("debris_w", "FLOAT", "POINT"); a.data.foreach_set("value", w.astype(np.float32))
    bmm = bmesh.new(); bmm.from_mesh(me); bmm.verts.ensure_lookup_table()
    kill = [f_ for f_ in bmm.faces if np.mean([w[v_.index] for v_ in f_.verts]) < 0.3]
    bmesh.ops.delete(bmm, geom=kill, context="FACES")
    bmm.to_mesh(me); bmm.free()
    w = np.ones(len(me.vertices), np.float32)
    a = me.attributes.get("debris_w")
    if a is not None:
        a.data.foreach_set("value", w)
    mod = tgt.modifiers.new("BagaPie_Scatter", "NODES")
    mod.node_group = scatter_tree(11 + k, dens, dmin, 0.08, 0.32)
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(tgt.evaluated_get(dg))
    bpy.data.objects.remove(tgt)
    o = bpy.data.objects.new(f"CFCL_ToolDebris_{name.replace('CFCL_Terrain_', '')}", baked)
    col.objects.link(o)
    if not o.data.materials:
        o.data.materials.append(stone)
    outs.append(o)
    LOG["surfaces"][name] = {"tris": T.tri_count([o]), "weight_mean": float(w.mean())}
    print("[debris]", name, LOG["surfaces"][name], flush=True)
tot = T.tri_count(outs)
if tot > BUDGET:                                       # thin uniformly to budget (drop whole chips)
    keep = BUDGET / tot
    for o in outs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        islands = []
        seen = set()
        for f in bm.faces:
            if f.index in seen:
                continue
            stack = [f]; isl = []
            while stack:
                g = stack.pop()
                if g.index in seen:
                    continue
                seen.add(g.index); isl.append(g)
                for e in g.edges:
                    for g2 in e.link_faces:
                        if g2.index not in seen:
                            stack.append(g2)
            islands.append(isl)
        rr = random.Random(5)
        kill = [f for isl in islands if rr.random() > keep for f in isl]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(o.data); bm.free()
LOG["tris_total"] = T.tri_count(outs)
for x in list(ref.all_objects) + list(kit.objects):
    bpy.data.objects.remove(x, do_unlink=True)
bpy.data.collections.remove(ref); bpy.data.collections.remove(kit)
bpy.ops.outliner.orphans_purge(do_recursive=True)
blend = T.save_blend(ASSET, VER)
arr = {"asset": ASSET, "blend": os.path.basename(blend), "units": "env (chips baked in place, identity transforms)",
       "placements": [{"source": o.name, "name": o.name, "location": [0, 0, 0], "rotation_deg": [0, 0, 0], "scale": [1, 1, 1]} for o in outs]}
T.write_json(os.path.join(T.asset_dir(ASSET), "arrangement.json"), arr)
if DO_RENDER:
    ref = bpy.data.collections.new("PV"); sc.collection.children.link(ref)
    I.append_asset(os.path.join(T.CL, "assets", "CFCL_Terrain_Central"), ref, 1.0, [])
    I.append_asset(os.path.join(T.CL, "assets", "CFCL_Hero_Skull"), ref, 1.0, [])
    I.append_asset(os.path.join(T.CL, "assets", "CFCL_Hero_Hand"), ref, 1.0, [])
    R.setup_render(sc, "EEVEE", (1280, 720), 48); R.setup_world(sc); R.standard_lights(20.0)
    bpy.context.view_layer.update()
    roots = [x for x in sc.objects if x.parent is None and x.type in ("MESH", "EMPTY")]
    T.to_world_scale(roots)
    for vn, (loc, tgt_, lens) in {"skullseat": ((-4 * 4.6, 1 * 4.6, 5 * 4.6), (-3.3 * 4.6, 9 * 4.6, 0), 35),
                                   "handseat": ((7 * 4.6, 2 * 4.6, 5 * 4.6), (4 * 4.6, 10 * 4.6, 0), 35),
                                   "hero": T.HERO}.items():
        cam = T.view_cam("CAM_" + vn, loc, tgt_, lens)
        T.render(os.path.join(RDIR, f"debris_v{VER:03d}_{vn}.png"), cam)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
print("DEBRIS_DONE", json.dumps(LOG, default=str)[:2000])
