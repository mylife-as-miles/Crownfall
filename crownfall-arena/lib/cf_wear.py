"""Crownfall (Claude track) - global wear / roughness pass for the main scene (Blender shader editor + procedural masks).

One shared node group (CF_Wear) is inserted in front of every Principled BSDF whose material matches a profile
rule.  It takes the material's own Base Color / Roughness / Normal and layers storytelling imperfections on top:

  edge    convex arrises (baked cf_wconvex, world-space curvature) - polished, paler, glossy
  chips   fractures on those arrises (voronoi cells)                - matte, pale fresh break, bump in
  cavity  concave + AO grime                                         - dark, fully matte
  ground  bottom of each object (Generated Z) - soil creep           - dark brown, matte
  top     up-facing dust / ash                                        - pale, matte
  streak  vertical run-off on steep faces                             - damp, darker, glossy
  crack   sparse voronoi-edge cracks + hairlines                      - near-black, matte, bump in
  breakup 3-scale roughness/value noise + contrast expansion around 0.55
  scratch fine directional scratches (board)                          - roughness up, slightly paler
  rust    iron oxide patches + pitting (metal); the Rust output scales metallic down
  veg     near plant roots / moss (baked cf_vegnear)                  - damp, mossy dark green, glossy

apply(scene, cfg, log) is called by build_main_scene after vegetation dressing.  Everything is procedural and must be
baked to textures for the GLB/three.js runtime."""
import re

import bpy
import numpy as np
from mathutils.kdtree import KDTree

import cf_materials as cfm

GROUP = "CF_Wear"
PARAMS = ("Edge", "Chips", "Cavity", "Ground", "Top", "Streak", "Crack", "Contrast", "Breakup", "Scratch", "Rust",
          "Veg")

# strengths per profile; k = curvature window (1/m) for cf_wconvex/cf_wconcave: 1 above k[1], 0 below k[0]
PROFILES = {
    "stone":  dict(Edge=1.0, Chips=1.0, Cavity=1.0, Ground=0.8, Top=0.55, Streak=0.85, Crack=0.75, Contrast=1.2,
                   Breakup=1.3, Veg=1.0, Scale=1.0, k=(0.8, 8.0)),
    "bone":   dict(Edge=0.8, Chips=0.7, Cavity=1.25, Ground=1.0, Top=0.5, Streak=1.0, Crack=0.7, Contrast=1.1,
                   Breakup=1.4, Veg=1.0, Scale=2.2, k=(0.4, 4.0)),
    "hand":   dict(Edge=0.9, Chips=0.8, Cavity=1.15, Ground=1.0, Top=0.45, Streak=1.0, Crack=0.8, Contrast=1.1,
                   Breakup=1.4, Veg=1.0, Scale=1.8, k=(0.5, 5.0)),
    "terrain": dict(Edge=0.55, Chips=0.4, Cavity=0.8, Ground=0.0, Top=0.45, Streak=0.6, Crack=0.4, Contrast=0.6,
                    Breakup=0.8, Veg=0.8, Scale=3.0, k=(0.25, 2.5)),
    "metal":  dict(Edge=1.3, Chips=0.5, Cavity=1.0, Ground=0.4, Top=0.3, Streak=0.6, Crack=0.0, Contrast=0.9,
                   Breakup=1.0, Scratch=0.5, Rust=1.8, Veg=0.6, Scale=0.45, k=(2.0, 20.0)),
    # the playing surface stays readable: small colour shifts, roughness-led wear
    "board_tiles": dict(Edge=0.35, Chips=0.22, Cavity=0.3, Crack=0.12, Contrast=0.35, Breakup=0.45, Scratch=0.65,
                        Scale=0.6, k=(4.0, 40.0)),
    "board_frame": dict(Edge=0.8, Chips=0.7, Cavity=0.7, Crack=0.3, Contrast=0.6, Breakup=0.7, Scratch=0.3,
                        Streak=0.3, Scale=0.8, k=(2.0, 20.0)),
    "board_bronze": dict(Edge=1.0, Chips=0.2, Cavity=0.9, Contrast=0.7, Breakup=0.8, Scratch=0.6,
                         Scale=0.4, k=(3.0, 30.0)),
}

# first match wins; "skip" = leave untouched (sky, fx, volumes, lava, vegetation, far haze cards)
RULES = [
    (r"Eclipse|Fog|Mist|Glow|Smoke|SkyShatter|FarLand|haze|Cloud|Lava(?!.*Cooled)|Ember", "skip"),
    (r"Meshy_(coral|crimson|fungus)", "skip"),
    (r"PBR_(IvoryMarble|ObsidianOnyx)", "board_tiles"),
    (r"PBR_GoldInlay", "board_bronze"),
    (r"Meshy_rib", "bone"),
    (r"Meshy_(landmass|roots)", "terrain"),
    (r"Moss|Leaf|Fern|Fungus|Sedge|Vine|Root|Cutout|Ivy|Grass|Foliage|Bark|Petal|Flower", "skip"),
    (r"CliffBlocky", "skip"),
    (r"BoardArena_(Marble|TileBasalt)", "board_tiles"),
    (r"BoardArena_Bronze", "board_bronze"),
    (r"BoardArena_", "board_frame"),
    (r"Bronze|Manacle|Iron|Chain|Metal|Cuff", "metal"),
    (r"BoneStone|Skull", "bone"),
    (r"HandStone", "hand"),
    (r"AncientStone|RitualFloor_(Carved|Paving|CheckerTop|LooseTile)|PBR_(Ashlar|MasonryBlocks|MossyRock|SeatRock|CarvedStone)"
     r"|Arch_", "stone"),
    (r"PBR_(PlateauGround|MoundGround|BasaltRib|Obsidian|CooledLava)|CFEnv_Basalt|Captured|RitualFloor_Obsidian"
     r"|Basalt|Terrain", "terrain"),
]
VEG = r"Moss|Leaf|Fern|Fungus|Sedge|Vine|Root|Cutout|Ivy|Grass|Foliage|Meshy_(coral|crimson|fungus|roots)"


class _Tree:
    """Lets cf_materials.NB build inside a node group."""
    def __init__(self, nt):
        self.node_tree = nt


def wear_group():
    ng = bpy.data.node_groups.get(GROUP)
    if ng is not None:
        return ng
    ng = bpy.data.node_groups.new(GROUP, "ShaderNodeTree")
    io = ng.interface

    def sock(name, kind, out=False, default=None, lo=None, hi=None):
        s = io.new_socket(name=name, in_out="OUTPUT" if out else "INPUT", socket_type=kind)
        if default is not None:
            s.default_value = default
        if lo is not None:
            s.min_value, s.max_value = lo, hi
        return s

    sock("Color", "NodeSocketColor", default=(0.5, 0.5, 0.5, 1.0))
    sock("Roughness", "NodeSocketFloat", default=0.6, lo=0.0, hi=1.0)
    sock("Normal", "NodeSocketVector")
    for p in PARAMS:
        sock(p, "NodeSocketFloat", default=0.0, lo=0.0, hi=4.0)
    sock("Scale", "NodeSocketFloat", default=1.0, lo=0.05, hi=50.0)
    sock("Color", "NodeSocketColor", out=True)
    sock("Roughness", "NodeSocketFloat", out=True)
    sock("Normal", "NodeSocketVector", out=True)
    sock("Rust", "NodeSocketFloat", out=True)

    nb = cfm.NB(_Tree(ng))
    gi = nb.n("NodeGroupInput")
    go = nb.n("NodeGroupOutput")
    I = gi.outputs.get

    def fmix(f, a, b):
        return nb.add(a, nb.mul(nb.sub(b, a), f))

    def half(x):
        return nb.sub(x, 0.5)

    # ---- coordinates (world metres / Scale) and shared noises
    p = nb.vop("SCALE", nb.geo().outputs["Position"], s=nb.m("DIVIDE", 1.0, I("Scale")))
    wc = nb.tn(p, 0.6, 2.0).outputs["Color"]
    pw = nb.vop("ADD", p, nb.vop("SCALE", nb.vop("SUBTRACT", wc, (0.5, 0.5, 0.5)), s=0.25))
    n_big = nb.tn(p, 0.22, 3.0, 0.55).outputs["Fac"]
    n_mid = nb.tn(pw, 1.4, 4.0, 0.6).outputs["Fac"]
    n_fine = nb.tn(pw, 8.0, 6.0, 0.65).outputs["Fac"]
    _, _, nz = nb.vsep(nb.geo().outputs["Normal"])

    # ---- masks
    breakup = nb.mul(nb.add(nb.add(nb.mul(half(n_big), 0.55), nb.mul(half(n_mid), 0.45)), nb.mul(half(n_fine), 0.3)),
                     I("Breakup"))
    edge_raw = nb.ss(nb.add(nb.attr("cf_wconvex"), nb.mul(half(n_mid), 0.6)), 0.3, 0.75)
    edge = nb.c01(nb.mul(edge_raw, I("Edge")))
    cell = nb.tv(pw, 3.2, "F1").outputs["Distance"]
    chipm = nb.mul(nb.ss(cell, 0.05, 0.4, 1.0, 0.0), nb.ss(n_fine, 0.45, 0.62))
    chips = nb.c01(nb.mul(nb.mul(edge_raw, chipm), nb.mul(I("Chips"), 1.5)))
    ao = nb.n("ShaderNodeAmbientOcclusion")
    try:
        ao.samples = 8
    except Exception:
        pass
    nb.link(I("Scale"), ao.inputs["Distance"])
    cav0 = nb.mx(nb.ss(nb.sub(1.0, ao.outputs["AO"]), 0.08, 0.55), nb.attr("cf_wconcave"))
    cav = nb.c01(nb.mul(nb.mul(cav0, nb.ss(n_mid, 0.25, 0.7, 0.55, 1.15)), I("Cavity")))
    tc = nb.n("ShaderNodeTexCoord")
    _, _, gz = nb.vsep(tc.outputs["Generated"])
    ground = nb.c01(nb.mul(nb.ss(nb.add(gz, nb.mul(half(n_mid), 0.18)), 0.2, 0.0), I("Ground")))
    top = nb.c01(nb.mul(nb.mul(nb.ss(nb.add(nz, nb.mul(half(n_big), 0.6)), 0.55, 0.92), nb.ss(n_mid, 0.35, 0.6)),
                        I("Top")))
    steep = nb.ss(nb.absv(nz), 0.85, 0.45)
    sn = nb.tn(nb.vop("MULTIPLY", p, (2.8, 2.8, 0.22)), 1.0, 5.0, 0.6).outputs["Fac"]
    streak = nb.c01(nb.mul(nb.mul(nb.mul(nb.ss(sn, 0.52, 0.66), steep), nb.ss(n_big, 0.3, 0.6)), I("Streak")))
    # cracks: voronoi cell edges on a strongly warped field, drawn only in broken runs (a closed cell net reads as
    # turtle-shell tiles), width varying along the run
    cw = nb.tn(p, 0.35, 3.0, 0.6).outputs["Color"]
    pc = nb.vop("ADD", pw, nb.vop("SCALE", nb.vop("SUBTRACT", cw, (0.5, 0.5, 0.5)), s=1.1))
    vc = nb.tv(pc, 0.9, "DISTANCE_TO_EDGE").outputs["Distance"]
    runs = nb.ss(nb.tn(pc, 2.6, 2.0).outputs["Fac"], 0.5, 0.58)
    width = nb.add(0.008, nb.mul(n_fine, 0.04))
    crack_main = nb.mul(nb.mul(nb.ss(vc, width, 0.0), runs),
                        nb.ss(nb.add(n_big, nb.mul(half(n_mid), 0.4)), 0.52, 0.64))
    hv = nb.tv(pc, 4.0, "DISTANCE_TO_EDGE").outputs["Distance"]
    hruns = nb.ss(nb.tn(pc, 9.0, 2.0).outputs["Fac"], 0.52, 0.6)
    hair = nb.mul(nb.mul(nb.mul(nb.ss(hv, 0.012, 0.0), hruns), nb.ss(n_mid, 0.55, 0.7)), 0.5)
    crack = nb.c01(nb.mul(nb.add(crack_main, hair), I("Crack")))
    s1 = nb.tn(nb.vop("MULTIPLY", p, (1.5, 70.0, 70.0)), 1.0, 2.0).outputs["Fac"]
    s2 = nb.tn(nb.vop("MULTIPLY", p, (70.0, 1.5, 70.0)), 1.0, 2.0).outputs["Fac"]
    scr = nb.mx(nb.ss(s1, 0.66, 0.72), nb.ss(s2, 0.67, 0.73))
    scratch = nb.c01(nb.mul(nb.mul(scr, nb.ss(n_mid, 0.4, 0.6)), I("Scratch")))
    # rust gathers in recesses, under the band (ground) and in sparse blooms - not even blotches
    rust_f = nb.add(nb.add(nb.mul(n_mid, 0.55), nb.mul(cav0, 0.9)), nb.add(nb.mul(half(n_big), 0.4), nb.mul(ground, 0.4)))
    rust = nb.c01(nb.mul(nb.mul(nb.ss(rust_f, 0.52, 0.7), nb.ss(n_fine, 0.3, 0.55, 0.55, 1.0)), I("Rust")))
    pcell = nb.tv(p, 25.0, "F1").outputs["Distance"]
    pits = nb.c01(nb.mul(nb.mul(nb.ss(pcell, 0.0, 0.25, 1.0, 0.0), nb.ss(n_fine, 0.5, 0.6)), I("Rust")))
    veg = nb.c01(nb.mul(nb.attr("cf_vegnear"), I("Veg")))

    # ---- roughness: expand contrast around 0.55, then each story layer pulls it to its own value
    r = nb.c01(nb.add(nb.add(0.55, nb.mul(nb.sub(I("Roughness"), 0.55), nb.add(1.0, I("Contrast")))), breakup))
    for f, v in ((nb.mul(cav, 0.9), 0.96), (nb.mul(top, 0.8), 0.92), (nb.mul(ground, 0.8), 0.88),
                 (nb.mul(streak, 0.85), 0.2), (nb.mul(veg, 0.6), 0.32), (nb.mul(edge, 0.7), 0.28), (chips, 0.9),
                 (crack, 0.97), (rust, 0.9), (pits, 0.98)):
        r = fmix(f, r, v)
    r = nb.mx(nb.c01(nb.add(r, nb.mul(scratch, 0.28))), 0.06)

    # ---- colour
    col = nb.hsv(I("Color"), h=nb.add(0.5, nb.mul(nb.mul(half(n_big), 0.03), I("Breakup"))),
                 s=nb.add(1.0, nb.mul(nb.mul(half(n_mid), 0.3), I("Breakup"))),
                 v=nb.add(1.0, nb.mul(nb.add(nb.mul(half(n_big), 0.5), nb.mul(half(n_mid), 0.3)), I("Breakup"))))
    col = nb.cmix(nb.mul(cav, 0.8), col, (0.16, 0.13, 0.10, 1.0), "MULTIPLY")
    col = nb.cmix(nb.mul(top, 0.4), col, (0.40, 0.37, 0.33, 1.0))
    col = nb.cmix(nb.mul(ground, 0.7), col, (0.10, 0.08, 0.055, 1.0))
    col = nb.cmix(nb.mul(streak, 0.55), col, (0.55, 0.55, 0.55, 1.0), "MULTIPLY")
    moss = nb.rampc(n_fine, [(0.0, (0.03, 0.045, 0.018)), (1.0, (0.075, 0.095, 0.035))])
    col = nb.cmix(nb.mul(veg, 0.6), col, moss)
    col = nb.cmix(nb.mul(edge, 0.55), col, nb.hsv(col, s=0.8, v=1.4))
    col = nb.cmix(nb.mul(chips, 0.8), col, nb.hsv(col, s=0.7, v=1.6))
    col = nb.cmix(nb.mul(crack, 0.9), col, (0.02, 0.018, 0.015, 1.0))
    col = nb.cmix(nb.mul(scratch, 0.25), col, nb.hsv(col, v=1.25))
    rustc = nb.rampc(n_fine, [(0.0, (0.07, 0.032, 0.018)), (0.5, (0.22, 0.085, 0.035)), (1.0, (0.36, 0.15, 0.055))])
    col = nb.cmix(rust, col, rustc)
    col = nb.cmix(nb.mul(pits, 0.8), col, (0.05, 0.02, 0.01, 1.0))

    # ---- relief: cracks and chips cut in, rust crusts up, fine grain everywhere
    h = nb.add(nb.mul(crack, -1.0), nb.mul(chips, -0.7))
    h = nb.add(h, nb.mul(nb.mul(half(n_fine), 0.35), I("Breakup")))
    h = nb.add(h, nb.sub(nb.mul(nb.mul(rust, n_fine), 0.3), nb.mul(pits, 0.5)))
    bump = nb.n("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.55
    nb.link(nb.mul(I("Scale"), 0.04), bump.inputs["Distance"])
    nb.link(h, bump.inputs["Height"])
    nb.link(I("Normal"), bump.inputs["Normal"])

    nb.link(col, go.inputs["Color"])
    nb.link(r, go.inputs["Roughness"])
    nb.link(bump.outputs["Normal"], go.inputs["Normal"])
    nb.link(rust, go.inputs["Rust"])
    return ng


def classify(name, rules=RULES):
    for pat, prof in rules:
        if re.search(pat, name):
            return prof
    return None


def _src(nt, sock):
    """(output socket or None, default value) feeding `sock`."""
    if sock.is_linked:
        return sock.links[0].from_socket, None
    v = sock.default_value
    return None, (tuple(v) if hasattr(v, "__len__") else v)


def insert(mat, prof, params):
    nt = mat.node_tree
    ng = wear_group()
    done = 0
    for b in [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"]:
        g = nt.nodes.new("ShaderNodeGroup")
        g.node_tree = ng
        g.label = "CF_Wear " + prof
        g.location = (b.location.x - 260, b.location.y - 120)
        for k in PARAMS + ("Scale",):
            g.inputs[k].default_value = float(params.get(k, 0.0))
        for name in ("Base Color", "Roughness"):
            out, val = _src(nt, b.inputs[name])
            tgt = g.inputs["Color" if name == "Base Color" else "Roughness"]
            if out is not None:
                nt.links.new(out, tgt)
            else:
                tgt.default_value = val
        out, _ = _src(nt, b.inputs["Normal"])
        if out is None:
            out = nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"]
        nt.links.new(out, g.inputs["Normal"])
        nt.links.new(g.outputs["Color"], b.inputs["Base Color"])
        nt.links.new(g.outputs["Roughness"], b.inputs["Roughness"])
        nt.links.new(g.outputs["Normal"], b.inputs["Normal"])
        if params.get("Rust", 0) > 0:
            mout, mval = _src(nt, b.inputs["Metallic"])
            inv = nt.nodes.new("ShaderNodeMath")
            inv.operation = "SUBTRACT"
            inv.inputs[0].default_value = 1.0
            nt.links.new(g.outputs["Rust"], inv.inputs[1])
            mm = nt.nodes.new("ShaderNodeMath")
            mm.operation = "MULTIPLY"
            if mout is not None:
                nt.links.new(mout, mm.inputs[0])
            else:
                mm.inputs[0].default_value = mval
            nt.links.new(inv.outputs[0], mm.inputs[1])
            nt.links.new(mm.outputs[0], b.inputs["Metallic"])
        done += 1
    mat["cf_wear"] = prof
    return done


def _world_verts(o, limit=None, rng=None):
    me = o.data
    n = len(me.vertices)
    if n == 0:
        return np.zeros((0, 3))
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    if limit and n > limit:
        co = co[(rng or np.random.default_rng(0)).choice(n, limit, replace=False)]
    m = np.array(o.matrix_world, dtype=np.float64)
    return co @ m[:3, :3].T + m[:3, 3]


def bake_vegnear(targets, vegs, reach=2.2, cell=2.5, drip=(0.8, 1.6, 2.4), log=None):
    """cf_vegnear (0..1) on single-user target meshes: 1 at plant roots / moss, fading over `reach` m, with extra
    reach straight down (damp drip lines under vines and moss)."""
    rng = np.random.default_rng(7)
    pts = [_world_verts(v, 400, rng) for v in vegs if v.type == "MESH"]
    pts = [p_ for p_ in pts if len(p_)]
    if not pts:
        return 0
    P = np.concatenate(pts)
    P = np.concatenate([P] + [P - (0.0, 0.0, d) for d in drip])
    kd = KDTree(len(P))
    for i, q in enumerate(P):
        kd.insert(q, i)
    kd.balance()
    key = lambda a: (np.floor(a / cell).astype(np.int64) + 50000) @ np.array([1, 100003, 100003 ** 2], np.int64)
    base = np.unique(np.floor(P / cell).astype(np.int64), axis=0)
    off = np.array([(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)], np.int64)
    near = np.unique(((base[:, None, :] + off[None]).reshape(-1, 3) + 50000) @ np.array([1, 100003, 100003 ** 2],
                                                                                        np.int64))
    n_done = 0
    for o in targets:
        me = o.data
        W = _world_verts(o)
        val = np.zeros(len(W), np.float32)
        cand = np.nonzero(np.isin(key(W), near))[0]
        for i in cand:
            d = kd.find(W[i])[2]
            if d < reach:
                t = 1.0 - d / reach
                val[i] = t * t * (3 - 2 * t)
        a = me.attributes.get("cf_vegnear") or me.attributes.new("cf_vegnear", "FLOAT", "POINT")
        a.data.foreach_set("value", val)
        n_done += 1
        if log is not None and len(cand):
            log.append(f"{o.name}: {int((val > 0.05).sum())} verts near plants")
    return n_done


def bake_wcurv(o, k):
    """cf_wconvex / cf_wconcave from cf_materials' world-space curvature estimate, windowed for main-scene viewing
    distances (k in 1/m)."""
    me = o.data
    n = len(me.vertices)
    if n < 4 or len(me.edges) < 3:
        return False
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    nor = np.empty(n * 3, np.float32)
    me.vertex_normals.foreach_get("vector", nor)
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    kap = cfm.curvature_arrays(co.reshape(-1, 3).astype(np.float64), nor.reshape(-1, 3).astype(np.float64),
                               e.reshape(-1, 2), 2)
    kap = kap / max(sum(abs(x) for x in o.matrix_world.to_scale()) / 3.0, 1e-6)
    den = max(k[1] - k[0], 1e-6)
    for nm, arr in (("cf_wconvex", np.clip((kap - k[0]) / den, 0, 1)), ("cf_wconcave", np.clip((-kap - k[0]) / den, 0, 1))):
        a = me.attributes.get(nm) or me.attributes.new(nm, "FLOAT", "POINT")
        a.data.foreach_set("value", arr.astype(np.float32))
    return True


def apply(scene, cfg=None, log=None):
    cfg = cfg or {}
    log = log if log is not None else {}
    rules = [tuple(r) for r in cfg.get("rules", [])] + RULES
    profiles = {k: dict(v) for k, v in PROFILES.items()}
    for k, v in cfg.get("profiles", {}).items():
        profiles.setdefault(k, {}).update(v)
    objs = [o for o in scene.objects if o.type == "MESH" and not o.hide_render]
    mat_prof, counts = {}, {}
    for o in objs:
        for s in o.material_slots:
            m = s.material
            if m and m.name not in mat_prof:
                mat_prof[m.name] = classify(m.name, rules)
    for name, prof in mat_prof.items():
        m = bpy.data.materials[name]
        if prof in (None, "skip") or prof not in profiles or not m.node_tree or m.get("cf_wear"):
            continue
        if insert(m, prof, profiles[prof]):
            counts[prof] = counts.get(prof, 0) + 1
    # per-mesh attributes (one bake per mesh datablock; linked duplicates share it)
    seen, n_curv = set(), 0
    for o in objs:
        if o.data.name in seen or not o.material_slots or not o.material_slots[0].material:
            continue
        prof = mat_prof.get(o.material_slots[0].material.name)
        if prof in profiles:
            seen.add(o.data.name)
            n_curv += bool(bake_wcurv(o, profiles[prof]["k"]))
    # plants = objects whose main material is vegetation (a ruin with a secondary moss slot is not a plant)
    vegs = [o for o in objs if o.material_slots and o.material_slots[0].material
            and re.search(VEG, o.material_slots[0].material.name)]
    tgts = [o for o in objs if o.data.users == 1 and o.material_slots and o.material_slots[0].material
            and mat_prof.get(o.material_slots[0].material.name) in ("stone", "bone", "hand", "terrain")
            and profiles[mat_prof[o.material_slots[0].material.name]].get("Veg", 0) > 0]
    vlog = []
    n_veg = bake_vegnear(tgts, vegs, log=vlog)
    log.update({"materials": counts, "unclassified": sorted(n for n, p in mat_prof.items() if p is None),
                "curvature_meshes": n_curv, "vegnear_meshes": n_veg, "veg_sources": len(vegs),
                "vegnear_detail": vlog[:40]})
    print("[cf_wear]", counts, "curv", n_curv, "vegnear", n_veg, flush=True)
    return log
