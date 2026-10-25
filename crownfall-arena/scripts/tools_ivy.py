"""CFCL_Tools_Ivy - ivy grown with the IVYGEN extension over the hero hand forearm, ruins pieces and near ribs.

IvyGen (bl_ext.blender_org.ivygen) is driven headless through its own module code (its operator needs a 3D
cursor/active mesh UI context; the algorithm is plain Python):
    ivy = IvyGenModule.Ivy(primaryWeight, randomWeight, gravityWeight, adhesionWeight, branchingProbability,
                           leafProbability, ivySize, ivyLeafSize, ivyBranchSize, maxFloatLength, maxAdhesionDistance)
    ivy.seed(point); while alive and ivy.maxLength < maxIvyLength: ivy.grow(target, IvyGenModule.bvhtree_from_object(target))
    IvyGenModule.createIvyGeometry(ivy, True)  -> its 'IVY_Curve' (stems, per-point radii) + 'IvyLeaf' quads
Then our code: stems -> mesh (bevelled curve), every IvyGen leaf quad -> a folded 2-tri leaf card on the same
frame (cf foliage UV contract), ~85 % dark green/olive (CFCL_Vine), ~15 % crimson (CFCL_CrimsonLeaf) clustered
by noise; leaves capped per target to hold the 150k-tri total.
Placement: every ivy object is stored in its TARGET's local frame, so its arrangement entry uses exactly the
target's placed transform (location/rotation/scale copied from the target asset's arrangement.json).
Usage: python lib/run_blender.py scripts/tools_ivy.py --timeout 2400 -- [render 1/0]
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
ASSET = "CFCL_Tools_Ivy"
VER = T.next_version(ASSET)
RDIR = os.path.join(T.CL, "renders", "tools", "ivy")
os.makedirs(RDIR, exist_ok=True)
LOG = {"asset": ASSET, "version": VER, "targets": {}, "warnings": []}
t0 = time.time()

R.reset_scene()
T.enable("ivygen")
IVG = sys.modules["bl_ext.blender_org.ivygen"]
sc = bpy.context.scene
col = bpy.data.collections.new(ASSET); sc.collection.children.link(col)
ref = bpy.data.collections.new("TOOLS_IvyTargets"); sc.collection.children.link(ref)

# ---------------------------------------------------------------- targets (placed exactly like the main build)
for a in ("CFCL_Hero_Hand", "CFCL_Terrain_Ribs", "CFCL_Tools_Arches", "CFCL_Arch_RuinsKit"):
    I.append_asset(os.path.join(T.CL, "assets", a), ref, 1.0, LOG["warnings"])
bpy.context.view_layer.update()

TARGETS = [
    # name in scene, label, leaf cap, seeds spec
    dict(obj="CFCL_Hero_Hand", label="HeroHand_Forearm", cap=15500, length=3.0, seeds=7, seed_band=(0.0, 0.45),
         up_limit=0.62, hang_seeds=2),
    dict(obj="ToolArch_SkullFlank_GothicPortal", label="Portal", cap=7600, length=3.2, seeds=6, seed_band=(0.0, 0.3),
         up_limit=1.0, hang_seeds=3),
    dict(obj="ToolArch_NearLeft_Colonnade", label="NearLeftColonnade", cap=6000, length=2.6, seeds=5, seed_band=(0.0, 0.3),
         up_limit=1.0, hang_seeds=2),
    dict(obj="Ruin_RightFlank_LancetArch", label="LancetArch", cap=5100, length=2.4, seeds=4, seed_band=(0.0, 0.3),
         up_limit=1.0, hang_seeds=2),
    dict(obj="CFCL_Rib_H_near_01", label="Rib_H_near_01", cap=5100, length=3.0, seeds=5, seed_band=(0.0, 0.25),
         up_limit=0.75, hang_seeds=1),
    dict(obj="CFCL_Rib_M_near_07", label="Rib_M_near_07", cap=5100, length=3.0, seeds=5, seed_band=(0.0, 0.25),
         up_limit=0.75, hang_seeds=1),
]
ARRS = {}
for a in ("CFCL_Hero_Hand", "CFCL_Terrain_Ribs", "CFCL_Tools_Arches", "CFCL_Arch_RuinsKit"):
    p = os.path.join(T.CL, "assets", a, "arrangement.json")
    if os.path.exists(p):
        for pl in json.load(open(p))["placements"]:
            ARRS[pl["name"]] = (a, pl)

VINE = M.get("Vine")
CRIM = M.get("CrimsonLeaf")
STEM = M.get("Root")


def world_mesh_arrays(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = o.evaluated_get(dg).to_mesh()
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    nr = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("normal", nr)
    nr = nr.reshape(-1, 3)
    o.evaluated_get(dg).to_mesh_clear()
    Mw = np.array(o.matrix_world)
    co = co @ Mw[:3, :3].T + Mw[:3, 3]
    nr = nr @ np.linalg.inv(Mw[:3, :3])
    nr /= np.linalg.norm(nr, axis=1, keepdims=True) + 1e-9
    return co, nr


def fps(P, k, rng):
    if len(P) == 0:
        return []
    idx = [rng.randrange(len(P))]
    d = np.linalg.norm(P - P[idx[0]], axis=1)
    for _ in range(k - 1):
        i = int(np.argmax(d)); idx.append(i)
        d = np.minimum(d, np.linalg.norm(P - P[i], axis=1))
    return idx


MAX_ROOTS = 9
STEM_BUDGET = 7000          # tris per target (stems)


def grow_one(target, bvh, seed_pt, seed, length, up_limit_z, params):
    random_mod = IVG  # IvyGen uses the stdlib random it imported (rand_val/rand_seed)
    IVG.rand_seed(seed)
    ivy = IVG.Ivy(**params)
    ivy.seed(Vector(seed_pt))
    it = 0
    while it < 1200 and ivy.maxLength < length and any(r.alive for r in ivy.ivyRoots):
        if len(ivy.ivyRoots) >= MAX_ROOTS:
            ivy.branchingProbability = 1.0          # IvyGen stores 1 - p: 1.0 = no further branching
        ivy.grow(target, bvh)
        # height cap (e.g. only the forearm on the hand): kill roots that climbed above the limit
        for r in ivy.ivyRoots:
            if r.alive and r.ivyNodes[-1].pos.z > up_limit_z:
                r.alive = False
        it += 1
    return ivy


def stem_mesh(ivy, every=4, sides=3):
    """IvyGen root node chains -> light tube mesh (IvyGen radius: (1/(parents+1)+1)*ivyBranchSize*(1.3 - l/L))."""
    bm = bmesh.new()
    for root in ivy.ivyRoots:
        nodes = list(root.ivyNodes)
        if len(nodes) < 3:
            continue
        L = nodes[-1].length
        rc = (1.0 / (root.parents + 1) + 1.0) * ivy.ivyBranchSize
        pick = nodes[::every] + ([nodes[-1]] if (len(nodes) - 1) % every else [])
        P = [n.pos.copy() for n in pick]
        rads = [max(rc * (1.3 - n.length / max(L, 1e-6)), rc * 0.2) for n in pick]
        rings = []
        for k, p_ in enumerate(P):
            t = (P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)])
            t = t.normalized() if t.length > 1e-9 else Vector((0, 0, 1))
            a = t.orthogonal().normalized(); b = t.cross(a)
            rings.append([bm.verts.new(p_ + (a * math.cos(j * 2 * math.pi / sides) + b * math.sin(j * 2 * math.pi / sides)) * rads[k])
                          for j in range(sides)])
        for k in range(len(rings) - 1):
            for j in range(sides):
                j2 = (j + 1) % sides
                try:
                    bm.faces.new((rings[k][j], rings[k][j2], rings[k + 1][j2], rings[k + 1][j]))
                except ValueError:
                    pass
    me = bpy.data.meshes.new("ivy_stems")
    bm.to_mesh(me); bm.free()
    return me


def leaves_and_stems(ivy, rng, label, crimson_frac=0.15):
    """IvyGen geometry -> stems mesh data + folded leaf cards (arrays, world/env space)."""
    before = set(bpy.data.objects)
    IVG.createIvyGeometry(ivy, True)
    new = [o for o in bpy.data.objects if o not in before]
    curve = next((o for o in new if o.type == "CURVE"), None)
    leafo = next((o for o in new if o.type == "MESH"), None)
    stems = stem_mesh(ivy)
    L = []
    if leafo is not None:
        lm = leafo.data
        co = np.empty(len(lm.vertices) * 3, np.float32); lm.vertices.foreach_get("co", co)
        co = co.reshape(-1, 4, 3)
        L = co
    for o in new:
        d = o.data
        bpy.data.objects.remove(o)
        try:
            if d.users == 0:
                (bpy.data.curves if isinstance(d, bpy.types.Curve) else bpy.data.meshes).remove(d)
        except Exception:
            pass
    return stems, L


def build_leaf_mesh(name, quads, rng, crimson_frac):
    """Each IvyGen quad (centre +- X +- Y) becomes a folded diamond leaf: base/tip on the midrib, lobes raised."""
    n = len(quads)
    if n == 0:
        return None
    c = quads.mean(1)
    X = (quads[:, 1] - quads[:, 0]) / 2.0
    Y = (quads[:, 3] - quads[:, 0]) / 2.0
    Nn = np.cross(X, Y)
    Nn /= np.linalg.norm(Nn, axis=1, keepdims=True) + 1e-9
    size = np.linalg.norm(Y, axis=1, keepdims=True)
    base = c - Y * 0.95
    tip = c + Y * 0.95
    left = c - X * 0.62 - Y * 0.1 + Nn * size * 0.18
    right = c + X * 0.62 - Y * 0.1 + Nn * size * 0.18
    V = np.stack([base, right, tip, left], 1).reshape(-1, 3)
    F = (np.arange(n)[:, None] * 4 + np.array([0, 1, 2, 3])[None, :])
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V)); me.vertices.foreach_set("co", V.astype(np.float32).ravel())
    me.loops.add(F.size); me.loops.foreach_set("vertex_index", F.ravel().astype(np.int32))
    me.polygons.add(n); me.polygons.foreach_set("loop_start", (np.arange(n) * 4).astype(np.int32))
    me.update(calc_edges=True)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", np.tile(np.array([[0, 0], [1, 0.45], [0, 1], [-1, 0.45]], np.float32), (n, 1)).ravel())
    rnd = np.repeat(np.array([rng.random() for _ in range(n)], np.float32), 4)
    for nm, val in (("cf_part", np.zeros(len(V), np.float32)), ("cf_rand", rnd)):
        a = me.attributes.new(nm, "FLOAT", "POINT"); a.data.foreach_set("value", val)
    # crimson patches: noise over the leaf centres (clustered, not salt-and-pepper)
    nz = np.array([noise.noise(Vector(p * 1.3)) for p in c])
    thr = np.quantile(nz, 1.0 - crimson_frac)
    me.polygons.foreach_set("material_index", (nz > thr).astype(np.int32))
    me.materials.append(VINE); me.materials.append(CRIM)
    return me


total_tris = 0
ivy_objs = []
for ti, tg in enumerate(TARGETS):
    t1 = time.time()
    o = bpy.data.objects.get(tg["obj"])
    if o is None:
        LOG["warnings"].append(f"target {tg['obj']} not found"); continue
    rng = random.Random(100 + ti)
    co, nr = world_mesh_arrays(o)
    zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
    hgt = zmax - zmin
    bvh = IVG.bvhtree_from_object(o)
    # seeds: low on the target (ground contact band) + a few high 'hang' seeds on up-facing ledges
    band = (co[:, 2] > zmin + hgt * tg["seed_band"][0]) & (co[:, 2] < zmin + hgt * tg["seed_band"][1]) & (nr[:, 2] > -0.3)
    cand = co[band]
    if len(cand) > 20000:
        cand = cand[np.linspace(0, len(cand) - 1, 20000).astype(int)]
    seeds = [cand[i] + nr[band][i if i < len(nr[band]) else 0] * 0.01 for i in fps(cand, tg["seeds"], rng)]
    hi = (co[:, 2] > zmin + hgt * 0.45) & (co[:, 2] < zmin + hgt * tg["up_limit"]) & (nr[:, 2] > 0.6)
    hcand = co[hi]
    if len(hcand) > 20000:
        hcand = hcand[np.linspace(0, len(hcand) - 1, 20000).astype(int)]
    hang = [hcand[i] for i in fps(hcand, tg["hang_seeds"], rng)] if len(hcand) else []
    params = dict(primaryWeight=0.5, randomWeight=0.25, gravityWeight=1.6, adhesionWeight=0.55,
                  branchingProbability=0.10, leafProbability=0.55, ivySize=0.028, ivyLeafSize=0.085,
                  ivyBranchSize=0.0045, maxFloatLength=0.35, maxAdhesionDistance=0.7)
    stems_meshes, leaf_quads = [], []
    for k, sp in enumerate(seeds + hang):
        is_hang = k >= len(seeds)
        p2 = dict(params)
        if is_hang:
            p2.update(gravityWeight=3.0, maxFloatLength=0.9, primaryWeight=0.3, adhesionWeight=0.35)
        ivy = grow_one(o, bvh, sp, 1000 * ti + k, tg["length"] * (0.7 if is_hang else 1.0), zmin + hgt * tg["up_limit"], p2)
        st, lq = leaves_and_stems(ivy, rng, tg["label"])
        if st is not None:
            stems_meshes.append(st)
        if len(lq):
            leaf_quads.append(lq)
    quads = np.concatenate(leaf_quads) if leaf_quads else np.zeros((0, 4, 3))
    if len(quads) > tg["cap"]:
        keep = np.sort(np.random.default_rng(ti).choice(len(quads), tg["cap"], replace=False))
        quads = quads[keep]
    lme = build_leaf_mesh(f"CFCL_ToolIvy_{tg['label']}_Leaves", quads, rng, 0.15)
    # join stems + leaves into one object; then express in the TARGET's local frame
    bm = bmesh.new()
    nstem_faces = 0
    for st in stems_meshes:
        bm.from_mesh(st)
        bpy.data.meshes.remove(st)
    nstem_faces = len(bm.faces)
    # stems -> temp object, decimated to budget; then stems + leaves merged with bmesh (no operator join)
    stm = bpy.data.meshes.new("tmp_stems"); bm.to_mesh(stm); bm.free()
    so = bpy.data.objects.new("tmp_stems", stm); col.objects.link(so)
    st_tris = T.tri_count([so])
    if st_tris > STEM_BUDGET:
        dmm = so.modifiers.new("stem_budget", "DECIMATE"); dmm.ratio = STEM_BUDGET / st_tris
        dg = bpy.context.evaluated_depsgraph_get()
        stm2 = bpy.data.meshes.new_from_object(so.evaluated_get(dg))
    else:
        stm2 = stm.copy()
    bpy.data.objects.remove(so)
    bm = bmesh.new()
    bm.from_mesh(stm2)
    for f_ in bm.faces:
        f_.material_index = 0
    n_st = len(bm.faces)
    if lme is not None:
        bm.from_mesh(lme)                                     # leaf faces keep 0/1 -> shift to 1/2
        bm.faces.ensure_lookup_table()
        for i_ in range(n_st, len(bm.faces)):
            bm.faces[i_].material_index += 1
    me = bpy.data.meshes.new(f"CFCL_ToolIvy_{tg['label']}")
    bm.to_mesh(me); bm.free()
    for m_ in (STEM, VINE, CRIM):
        me.materials.append(m_)
    ob = bpy.data.objects.new(f"CFCL_ToolIvy_{tg['label']}", me); col.objects.link(ob)
    bpy.context.view_layer.update()
    imn, imx = R.bounds([ob]); tmn, tmx = R.bounds([o])
    LOG.setdefault("debug_bounds", {})[tg["label"]] = {"ivy_world": [[round(v, 2) for v in imn], [round(v, 2) for v in imx]],
                                                      "target_world": [[round(v, 2) for v in tmn], [round(v, 2) for v in tmx]],
                                                      "seed0": [round(float(v), 2) for v in seeds[0]] if seeds else None}
    Minv = o.matrix_world.inverted()
    ob.data.transform(Minv)
    ob.matrix_world = o.matrix_world.copy()
    tris = T.tri_count([ob])
    total_tris += tris
    ivy_objs.append((ob, o, tg))
    src_asset, pl = ARRS.get(o.name, (None, None))
    LOG["targets"][tg["label"]] = {"target_object": o.name, "target_asset": src_asset, "seeds": len(seeds), "hang_seeds": len(hang),
                                   "leaves": int(len(quads)), "stem_faces": nstem_faces, "tris": tris,
                                   "s": round(time.time() - t1, 1)}
    print("[ivy]", tg["label"], LOG["targets"][tg["label"]], flush=True)
LOG["tris_total"] = total_tris

# ---------------------------------------------------------------- save: ivy only (targets removed), arrangement = target transforms
placements = []
for ob, o, tg in ivy_objs:
    src_asset, pl = ARRS.get(o.name, (None, None))
    if pl is None:
        LOG["warnings"].append(f"no arrangement entry for {o.name}"); continue
    placements.append({"source": ob.name, "name": ob.name, "location": pl["location"], "rotation_deg": pl["rotation_deg"],
                       "scale": pl["scale"], "target": {"asset": src_asset, "placement": o.name}})
target_mats = {ob.name: o.matrix_world.copy() for ob, o, tg in ivy_objs}
target_obj_mats = {tg["obj"]: o.matrix_world.copy() for ob, o, tg in ivy_objs}
for x in list(ref.all_objects):
    x.hide_render = True
for ob, o, tg in ivy_objs:
    ob.matrix_world = Matrix.Identity(4)                # stored in target-local frame
bpy.ops.outliner.orphans_purge(do_recursive=True)
# keep targets out of the saved file
tmp_targets = [x.name for x in ref.all_objects]
for x in list(ref.all_objects):
    bpy.data.objects.remove(x, do_unlink=True)
bpy.data.collections.remove(ref)
bpy.ops.outliner.orphans_purge(do_recursive=True)
blend = T.save_blend(ASSET, VER)
arr = {"asset": ASSET, "blend": os.path.basename(blend),
       "units": "env; each ivy mesh is in its target's local frame -> placement = the target's placement",
       "placements": placements}
T.write_json(os.path.join(T.asset_dir(ASSET), "arrangement.json"), arr)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)

# ---------------------------------------------------------------- previews: re-append targets, world scale
if DO_RENDER:
    ref = bpy.data.collections.new("PV_Targets"); sc.collection.children.link(ref)
    for a in ("CFCL_Hero_Hand", "CFCL_Terrain_Ribs", "CFCL_Tools_Arches", "CFCL_Arch_RuinsKit"):
        I.append_asset(os.path.join(T.CL, "assets", a), ref, 1.0, [])
    bpy.context.view_layer.update()
    for ob, o, tg in ivy_objs:
        ob.matrix_world = target_mats[ob.name]
        tgo = bpy.data.objects.get(tg["obj"])
        if tgo is not None:
            if tgo.parent is not None:
                tgo.parent = None
            tgo.matrix_world = target_obj_mats[tg["obj"]]
    R.setup_render(sc, "EEVEE", (1100, 720), 48)
    R.setup_world(sc)
    R.standard_lights(20.0)
    roots = [x for x in sc.objects if x.parent is None and x.type in ("MESH", "EMPTY", "CURVE")]
    T.to_world_scale(roots)
    LOG["renders"] = {}
    bpy.context.view_layer.update()
    for ob, o, tg in ivy_objs:
        o2 = bpy.data.objects.get(tg["obj"])
        if o2:
            a1, b1 = R.bounds([ob]); a2, b2 = R.bounds([o2])
            LOG.setdefault("debug_bounds_preview", {})[tg["label"]] = [[round(v, 1) for v in a1], [round(v, 1) for v in b1],
                                                                     [round(v, 1) for v in a2], [round(v, 1) for v in b2]]
    for ob, o, tg in ivy_objs:
        o2 = bpy.data.objects.get(tg["obj"])
        show = {ob.name, tg["obj"]} | {c.name for c in (o2.children if o2 else [])}
        for x in sc.objects:
            if x.type in ("MESH", "CURVE"):
                x.hide_render = x.name not in show
        mn, mx = R.bounds([o2] if o2 else [ob])
        c = (mn + mx) / 2; size = (mx - mn).length
        for vn, az, el, dm, tz in (("a", 20, 12, 0.95, 0.4), ("b", -60, 20, 0.95, 0.45), ("close", 35, 8, 0.45, 0.25)):
            a_, e_ = math.radians(az), math.radians(el)
            tgt = Vector((c.x, c.y, mn.z + (mx.z - mn.z) * tz))
            # face the side the hero camera sees (toward -Y)
            loc = tgt + Vector((math.sin(a_) * math.cos(e_), -math.cos(a_) * math.cos(e_), math.sin(e_))) * size * dm * 1.3
            cam = T.view_cam(f"CAM_{tg['label']}_{vn}", loc, tgt, 35)
            pth = os.path.join(RDIR, f"ivy_v{VER:03d}_{tg['label']}_{vn}.png")
            T.render(pth, cam)
            LOG["renders"][f"{tg['label']}_{vn}"] = os.path.relpath(pth, T.CL)
LOG["seconds"] = round(time.time() - t0, 1)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
print("IVY_DONE", json.dumps({"targets": LOG["targets"], "tris_total": total_tris, "warnings": LOG["warnings"]})[:3000])
