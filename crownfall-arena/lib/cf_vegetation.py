"""Crownfall (Claude track) - vegetation kit builders + surface dressing tool (surface/vegetation agent).

INTEGRATION USAGE (recommended calls per target type; objects may have any world transform)
--------------------------------------------------------------------------------------------
    import cf_vegetation as V
    KIT = V.latest_kit()     # or the explicit path assets/CFCL_Veg_Kit/CFCL_Veg_Kit_v005.blend
    EX = V.board_exclude     # nothing over the board frame + 3 cm, r<0.5 m above z-0.1, nor in the -Y corridor
    ECL = (3.95, 20.0, 5.25) # crimson/ferns lean slightly toward the eclipse
    # altar drum (dia ~1.2 m, top z -0.054): small plants in the lunettes/steps, 2-4 cm moss-free board margin
    V.dress(altar, KIT, seed=11, exclude_fn=EX, **V.PRESETS["altar"])
    # hero skull (~2.7 m wide): moss on crown/brow/sutures, drips from brow + orbit roofs, ferns in shade
    V.dress(skull, KIT, seed=21, exclude_fn=EX, lean_target=ECL, **V.PRESETS["skull"])
    # hero hand (~4.5 m visible): mossy forearm, shelf fungi, vines/drips from wrist and fingers, roots
    V.dress(hand, KIT, seed=31, exclude_fn=EX, lean_target=ECL, **V.PRESETS["hand"])
    # basalt rib (4-20 m tall): ledge moss, crimson bands at the base, fungi on stumps; scale up with distance
    V.dress(rib, KIT, seed=41 + i, exclude_fn=EX, **V.PRESETS["rib"])             # 4-9 m near ribs
    V.dress(rib, KIT, seed=41 + i, exclude_fn=EX, **dict(V.PRESETS["rib"], scale=2.5))  # mid/far ribs
    # central rock / island under the dais (r 4-7 m): everything, moderate density
    V.dress(rock, KIT, seed=51, exclude_fn=EX, lean_target=ECL, **V.PRESETS["rock"],
            attract=[(-1.6, -0.4, -2.0, 2.0), (1.6, -0.4, -2.0, 2.0)])   # e.g. lava bank points: crimson densest there
  Each call returns {"collection", "instance_count", "moss_faces", "max_contact_gap_m", ...} and creates
  CFCL_Veg_<obj>/{_MossShell,_Clumps,_Hanging,_Roots}.  Deterministic per (mesh, seed, kwargs).  Cost: ~3-10 s
  and 50-300 linked-duplicate instances per target; instanced triangles can reach 0.1-0.4 M per target, so lower
  `density` (or drop "crimson"/"ferns") for far or VR-budget targets.  Dress the FINAL (placed, transformed)
  object; re-dressing creates a new collection (delete the old one first).

USAGE (inside Blender, after sys.path.insert(0, <CL>/lib))
------------------------------------------------------------
    import cf_vegetation as V
    kit = V.latest_kit()            # assets/CFCL_Veg_Kit/CFCL_Veg_Kit_v###.blend (highest ###)
    rep = V.dress(rock_obj, kit, seed=7, scale=1.0, density=1.0,
                  exclude_fn=V.board_exclude)            # board + 3 cm margin + player -Y corridor
    print(rep["collection"], rep["instance_count"], rep["moss_faces"], rep["max_contact_gap_m"])

dress(target_obj, kit_blend_path=None, families=ALL_FAMILIES, density=1.0, seed=0, exclude_fn=None,
      scale=1.0, moss_cover=0.35, moss_thickness=(0.006, 0.026), lean_target=None, lean_amount=0.25,
      max_clusters=None, vine_count=None, drip_count=None, root_count=None, collection=None,
      max_instanced_tris=150000, verbose=True)
  * attract: optional list of (x, y, z, radius) world points (lava banks, the altar) near which crimson
    clusters become up to 3.5x more likely ("crimson densest near lava and altar").  Ferns are only placed
    where the ray-cast shelter is >= 0.12 (shaded flanks, never open crowns); moss cushions prefer open tops.
  * max_instanced_tris caps the summed triangles of all instances per call (clumps get <= 70 %, hanging +
    fungi the rest); when the budget gets tight the smallest variant is used, then placement stops.
    rep["instanced_tris"], rep["tri_budget"], rep["budget_limited"] report it.

  * Works on any mesh object with any world transform (all analysis in world space, evaluated mesh).
  * Deterministic for a given (target mesh, seed, kwargs).
  * `scale` multiplies plant sizes, spacings, moss thickness and noise sizes (monuments: 2-6).
  * Families: "moss_shell" (faces with normal.z > ~0.45 under a multi-scale noise + crevice mask, duplicated,
    offset 1-4 cm along normals with lumpy displacement, tucked edges, Solidify; material Moss/MossDry),
    "cushions", "crimson", "ferns", "tufts" (clustered linked-duplicate instances: Poisson cluster centres,
    3-9 members with one dominant, per-cluster scale 0.6-1.4, biased to stone edges / cracks / sheltered
    spots, aligned to the surface normal blended with world up), "fungi" (shelf fungi on steep faces),
    "vines" + "drips" (hang from overhang lips (normal.z < -0.3) and rims, length fitted to the free drop
    found by scene ray casts), "roots" (unique meshes grown ON the target surface by nearest-point walking
    with gravity, so they conform over edges; branching, tapering, flattened, half-embedded).
  * Output: collection CFCL_Veg_<target> with children _MossShell, _Clumps, _Hanging, _Roots (toggle freely).
  * exclude_fn(p: (x,y,z) world) -> True to forbid vegetation at p.  Instance bounding boxes, vine drops,
    moss vertices and root paths are all tested.
  * Returns dict: collection, instance_count, moss_faces, max_contact_gap_m (max distance from any instance
    origin / moss vertex / vine anchor / root path point to the target surface, measured with BVH nearest-point
    + ray casts), plus counts, footprint gap stats, near-edge fraction, timing.

KIT (build_kit / scripts/cfcl_veg_kit.py): one collection per family, objects at origin, +Z up:
  ferns  CFCL_Veg_Fern_A/B/C      radial fronds, rachis + alternating pinnae, gravity arch, 0.3-1.2 m
  crimson CFCL_Veg_Crimson_A/B/C  compound-leaf shrubs with stems, serrated leaflets, flower spikes (B,C)
  vines  CFCL_Veg_Vine_A/B/C      hanging strands with leaves; origin = top anchor, wall on -Y, leaves face +Y
  drips  CFCL_Veg_Drip_A/B        5-35 cm hanging moss strands (A) / root hairs (B); origin = anchor
  roots  CFCL_Veg_Root_A/B/C      roots pre-draped over a 90 deg edge (origin on the edge, top = XY plane at z=0
                                  for y<0, wall = XZ plane for z<0)
  cushions CFCL_Veg_MossCushion_A/B/C  lumpy moss cushions, flat base 1.2 cm below origin
  tufts  CFCL_Veg_Tuft_A/B/C       dark olive sedge/grass tufts (C with seed stalks)
  fungi  CFCL_Veg_Fungus_A/B/C     tiered shelf fungi; wall = XZ plane, shelves protrude +Y
Mesh attributes for materials: UV "UVMap", POINT floats "cf_part" (0 leaf, 0.5 stem, 1 flower) and "cf_rand".
"""
import math
import os
import glob
import time

import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

try:
    import cf_materials as M
except Exception:  # pragma: no cover
    M = None

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
KIT_DIR = os.path.join(CL, "assets", "CFCL_Veg_Kit")
ALL_FAMILIES = ("moss_shell", "cushions", "crimson", "ferns", "tufts", "fungi", "vines", "drips", "roots")
FAMILY_COLL = {"ferns": "CFCL_Veg_Ferns", "crimson": "CFCL_Veg_Crimson", "vines": "CFCL_Veg_Vines",
               "drips": "CFCL_Veg_Drips", "roots": "CFCL_Veg_Roots", "cushions": "CFCL_Veg_MossCushions",
               "tufts": "CFCL_Veg_Tufts", "fungi": "CFCL_Veg_Fungi"}
Z = np.array([0.0, 0.0, 1.0])

# Recommended dress() kwargs per target type (see module docstring).  Sizes follow AGENT_BRIEF_COMMON 2 (revised).
PRESETS = {
    "altar": dict(scale=0.35, density=1.0, moss_cover=0.25, max_instanced_tris=100000,
                  families=("moss_shell", "cushions", "crimson", "ferns", "tufts", "drips")),
    "skull": dict(scale=0.8, density=0.8, moss_cover=0.45, drip_count=4, max_instanced_tris=150000,
                  families=("moss_shell", "cushions", "crimson", "ferns", "tufts", "drips", "vines", "roots")),
    "hand": dict(scale=1.0, density=0.8, moss_cover=0.55, drip_count=4, max_instanced_tris=150000,
                 families=("moss_shell", "cushions", "crimson", "ferns", "fungi", "drips", "vines", "roots")),
    "rib": dict(scale=1.5, density=0.5, moss_cover=0.3, drip_count=4, max_instanced_tris=60000,
                families=("moss_shell", "cushions", "crimson", "tufts", "fungi", "drips")),
    "rock": dict(scale=1.5, density=0.7, moss_cover=0.35, max_instanced_tris=150000, families=ALL_FAMILIES),
}


def set_material_lib(mod):
    """Use a different material module (e.g. cf_materials_dev) for kit building."""
    global M
    M = mod


def _mat(name):
    return M.get(name) if M is not None else None


# ============================================================== small vector helpers
def _n(v):
    v = np.asarray(v, float)
    l = float(np.linalg.norm(v))
    return v / l if l > 1e-12 else v


def _perp(d):
    a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    return _n(np.cross(d, a))


def _rot(v, axis, ang):
    """Rodrigues rotation of v about unit axis by ang (rad)."""
    k = _n(axis)
    c, s = math.cos(ang), math.sin(ang)
    return v * c + np.cross(k, v) * s + k * np.dot(k, v) * (1 - c)


def _ss(x, a, b):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# value noise / fbm on numpy points (cf_sdf perlin)
def _fbm(P, freq, octaves=3, seed=0):
    try:
        import cf_sdf as S
        return S.fbm(np.asarray(P, np.float32), freq, octaves, seed=seed)
    except Exception:  # pragma: no cover
        return np.zeros(len(P), np.float32)


# ============================================================== mesh builder
class MB:
    """Accumulates verts / faces / per-corner UVs / per-vertex attributes; builds a Blender mesh."""

    def __init__(self):
        self.co = []
        self.uv = []      # per vertex default uv
        self.part = []
        self.rand = []
        self.faces = []
        self.fuv = []     # per face: tuple of corner uvs or None
        self.fmat = []

    def v(self, p, uv=(0.0, 0.0), part=0.0, rnd=0.0):
        self.co.append((float(p[0]), float(p[1]), float(p[2])))
        self.uv.append((float(uv[0]), float(uv[1])))
        self.part.append(float(part))
        self.rand.append(float(rnd))
        return len(self.co) - 1

    def f(self, idx, uvs=None, mat=0):
        self.faces.append(tuple(int(i) for i in idx))
        self.fuv.append(uvs)
        self.fmat.append(int(mat))

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def translate(self, off):
        self.co = [(x + off[0], y + off[1], z + off[2]) for x, y, z in self.co]

    def to_object(self, name, materials=(), collection=None):
        me = bpy.data.meshes.new(name)
        nv = len(self.co)
        me.vertices.add(nv)
        me.vertices.foreach_set("co", np.asarray(self.co, np.float32).ravel())
        sizes = np.array([len(f) for f in self.faces], np.int32)
        loops = np.array([i for f in self.faces for i in f], np.int32)
        me.loops.add(len(loops))
        me.loops.foreach_set("vertex_index", loops)
        me.polygons.add(len(sizes))
        starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
        me.polygons.foreach_set("loop_start", starts)
        try:
            me.polygons.foreach_set("loop_total", sizes)
        except Exception:
            pass
        uvs = []
        for f, fu in zip(self.faces, self.fuv):
            if fu is None:
                uvs.extend(self.uv[i] for i in f)
            else:
                uvs.extend(fu)
        uvl = me.uv_layers.new(name="UVMap")
        arr = np.asarray(uvs, np.float32).ravel()
        try:
            uvl.uv.foreach_set("vector", arr)
        except Exception:
            uvl.data.foreach_set("uv", arr)
        for nm, vals in (("cf_part", self.part), ("cf_rand", self.rand)):
            a = me.attributes.new(nm, "FLOAT", "POINT")
            a.data.foreach_set("value", np.asarray(vals, np.float32))
        me.polygons.foreach_set("material_index", np.asarray(self.fmat, np.int32))
        me.update(calc_edges=True)
        me.validate(clean_customdata=False)
        for m in materials:
            me.materials.append(m)
        me.shade_smooth()
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob


# ============================================================== primitives
def leaf(mb, base, d, up, length, width, rows=4, cols=3, prof=0.75, fold=0.3, curl=-0.3, twist=0.0,
         serr=0.0, part=0.0, rnd=0.0, mat=0, wfun=None):
    """Tapered leaf blade with a folded midrib (V-fold), gravity curl and optional serration.
    base: attachment point; d: growth direction; up: approximate blade normal; width: full width.
    Width profile w(t) = sin(pi * t**prof) unless wfun(t) given (prof<1: widest near base)."""
    d = _n(d)
    side = np.cross(d, np.asarray(up, float))
    side = _n(side) if np.linalg.norm(side) > 1e-6 else _perp(d)
    seg = length / rows
    C, S_, N_ = [np.asarray(base, float)], [side], [np.cross(side, d)]
    cur, dd, ss = C[0].copy(), d.copy(), side.copy()
    for i in range(rows):
        dd = _n(_rot(dd, ss, curl / rows))
        if twist:
            ss = _n(_rot(ss, dd, twist / rows))
        ss = _n(ss - dd * np.dot(ss, dd))
        cur = cur + dd * seg
        C.append(cur.copy())
        S_.append(ss.copy())
        N_.append(np.cross(ss, dd))
    us = np.linspace(-1, 1, cols)
    w_of = wfun or (lambda t: math.sin(math.pi * (t ** prof)) if 0 < t < 1 else 0.0)
    rows_idx = []
    for i in range(rows + 1):
        t = i / rows
        w = 0.5 * width * max(0.0, w_of(t))
        if w < 1e-5:
            rows_idx.append([mb.v(C[i], (0.0, t), part, rnd)])
            continue
        r = []
        for u in us:
            ww = w
            if serr and abs(u) > 0.99:
                ww = w * (1 + serr * (1 if i % 2 else -1))
            p = C[i] + S_[i] * (u * ww) + N_[i] * (abs(u) * ww * fold)
            r.append(mb.v(p, (u, t), part, rnd))
        rows_idx.append(r)
    for i in range(rows):
        a, b = rows_idx[i], rows_idx[i + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for j in range(len(b) - 1):
                mb.f((a[0], b[j + 1], b[j]), mat=mat)
        elif len(b) == 1:
            for j in range(len(a) - 1):
                mb.f((a[j], a[j + 1], b[0]), mat=mat)
        else:
            for j in range(len(a) - 1):
                mb.f((a[j], a[j + 1], b[j + 1], b[j]), mat=mat)


def tube(mb, pts, radii, sides=5, part=0.5, rnd=0.0, mat=0, nref=None, flatten=1.0, v0=0.0):
    """Tube along a polyline with parallel-transport frames (or frames from reference normals `nref`,
    flattening the section along them by `flatten`).  Last radius ~0 closes the tip with a cone."""
    P = np.asarray(pts, float)
    n = len(P)
    if n < 2:
        return
    T = np.zeros_like(P)
    T[1:-1] = P[2:] - P[:-2]
    T[0] = P[1] - P[0]
    T[-1] = P[-1] - P[-2]
    T = np.array([_n(t) for t in T])
    frames = []
    Nprev = _perp(T[0]) if nref is None else _n(nref[0] - T[0] * np.dot(nref[0], T[0]))
    for i in range(n):
        if nref is not None:
            Ni = nref[i] - T[i] * np.dot(nref[i], T[i])
            Ni = _n(Ni) if np.linalg.norm(Ni) > 1e-6 else Nprev
        else:
            Ni = Nprev - T[i] * np.dot(Nprev, T[i])
            Ni = _n(Ni) if np.linalg.norm(Ni) > 1e-6 else _perp(T[i])
        Bi = np.cross(T[i], Ni)
        frames.append((Ni, Bi))
        Nprev = Ni
    L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]) + v0
    rings = []
    for i in range(n):
        r = float(radii[i])
        if i == n - 1 and r < 1e-4:
            rings.append([mb.v(P[i], (0.5, L[i]), part, rnd)])
            continue
        Ni, Bi = frames[i]
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            p = P[i] + Ni * (math.cos(a) * r * flatten) + Bi * (math.sin(a) * r)
            ring.append(mb.v(p, (k / sides, L[i]), part, rnd))
        rings.append(ring)
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        if len(b) == 1:
            for k in range(sides):
                k2 = (k + 1) % sides
                mb.f((a[k], a[k2], b[0]), uvs=((k / sides, L[i]), ((k + 1) / sides, L[i]), ((k + 0.5) / sides, L[i + 1])),
                     mat=mat)
            continue
        for k in range(sides):
            k2 = (k + 1) % sides
            mb.f((a[k], a[k2], b[k2], b[k]),
                 uvs=((k / sides, L[i]), ((k + 1) / sides, L[i]), ((k + 1) / sides, L[i + 1]), (k / sides, L[i + 1])),
                 mat=mat)


def bud(mb, c, axis, length, radius, part=1.0, rnd=0.0, mat=0, sides=4, spin=0.0):
    """Small elongated bipyramid (flower bud / seed)."""
    a = _n(axis)
    u = _perp(a)
    u = _rot(u, a, spin)
    w = np.cross(a, u)
    top = mb.v(c + a * length * 0.6, (0, 1), part, rnd)
    bot = mb.v(c - a * length * 0.4, (0, 0), part, rnd)
    ring = [mb.v(c + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * radius,
                 (k / sides, 0.5), part, rnd) for k in range(sides)]
    for k in range(sides):
        k2 = (k + 1) % sides
        mb.f((ring[k], ring[k2], top), mat=mat)
        mb.f((ring[k2], ring[k], bot), mat=mat)


def _polyline_at(P, t):
    """Point + tangent at normalized arc length t on polyline P."""
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    L = np.concatenate([[0], np.cumsum(seg)])
    s = np.clip(t, 0, 1) * L[-1]
    i = int(np.clip(np.searchsorted(L, s) - 1, 0, len(seg) - 1))
    f = (s - L[i]) / max(seg[i], 1e-9)
    return P[i] + (P[i + 1] - P[i]) * f, _n(P[i + 1] - P[i])


def _live_rand(rng):
    """cf_rand value that is NOT selected as dead/dry by the foliage materials."""
    while True:
        r = float(rng.random())
        if (r * 7.13) % 1.0 < 0.86:
            return r


def _dead_rand(rng):
    return (int(rng.integers(0, 7)) + 0.97) / 7.13


# ============================================================== FERNS
FERN_V = {"A": dict(n=8, L=(0.26, 0.38), pairs=14, crown=0.025, fiddle=0, dead=1, sides=3),
          "B": dict(n=11, L=(0.50, 0.75), pairs=18, crown=0.045, fiddle=1, dead=1, sides=4),
          "C": dict(n=12, L=(0.90, 1.22), pairs=21, crown=0.065, fiddle=2, dead=1, sides=4)}


def _frond(mb, base, az, elev0, droop, L, pairs, rnd, rng, sides=4, dead=False):
    nseg = 10
    heading = np.array([math.cos(az), math.sin(az), 0.0])
    lat = np.array([-math.sin(az), math.cos(az), 0.0])
    sway = rng.uniform(-0.3, 0.3)
    pts = [np.asarray(base, float)]
    p = pts[0].copy()
    for i in range(nseg):
        t = (i + 0.5) / nseg
        e = math.radians(elev0 - (elev0 + droop) * t ** 1.6)
        h = _n(heading + lat * sway * t)
        d = h * math.cos(e) + Z * math.sin(e)
        p = p + d * (L / nseg)
        pts.append(p.copy())
    P = np.array(pts)
    r0 = 0.0022 + 0.0042 * L
    tube(mb, P, np.linspace(r0, r0 * 0.22, len(P)), sides, part=0.5, rnd=rnd)
    for k in range(pairs):
        for s in (-1, 1):
            t = 0.10 + 0.86 * (k + (0.5 if s > 0 else 0.0)) / pairs
            Pp, T = _polyline_at(P, t)
            right = np.cross(T, Z)
            right = _n(right) if np.linalg.norm(right) > 1e-4 else lat
            Nf = _n(np.cross(right, T))
            ang = math.radians(rng.uniform(50, 64))
            dirp = _n(T * math.cos(ang) + right * s * math.sin(ang) - Nf * 0.10)
            shape = max(0.12, math.sin(math.pi * (t ** 0.85))) ** 0.8
            lp = L * 0.20 * shape * rng.uniform(0.9, 1.1)
            leaf(mb, Pp, dirp, Nf, lp, lp * 0.21, rows=3, cols=3, prof=0.9, fold=0.25,
                 curl=-0.45 if dead else -0.3, serr=0.32, part=0.0, rnd=rnd)
    Pt, T = _polyline_at(P, 1.0)
    right = np.cross(T, Z)
    right = _n(right) if np.linalg.norm(right) > 1e-4 else lat
    leaf(mb, Pt - T * L * 0.02, T, _n(np.cross(right, T)), L * 0.07, L * 0.02, rows=3, cols=3, prof=0.9,
         fold=0.2, curl=-0.2, part=0.0, rnd=rnd)


def _crozier(mb, base, h, rnd, rng):
    pts = []
    lean = _n(np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0.0])) * 0.15
    for i in range(7):
        t = i / 6
        pts.append(np.asarray(base, float) + Z * h * 0.7 * t + lean * h * t * t)
    top = pts[-1]
    d = _n(lean + Z * 0.01)
    if np.linalg.norm(d) < 1e-6:
        d = np.array([1.0, 0, 0])
    rr = h * 0.13
    centre = top + d * rr
    for i in range(1, 12):
        a = math.pi * 1.7 * i / 11
        r = rr * (1 - 0.6 * i / 11)
        pts.append(centre - d * r * math.cos(a) + Z * r * math.sin(a))
    P = np.array(pts)
    tube(mb, P, np.linspace(0.0045, 0.0018, len(P)), 4, part=0.5, rnd=rnd)


def build_fern(var="B", seed=0):
    cfg = FERN_V[var]
    rng = np.random.default_rng(1000 + seed * 17 + ord(var))
    mb = MB()
    n = cfg["n"]
    for f in range(n + cfg["dead"]):
        dead = f >= n
        az = 2 * math.pi * f / n + rng.uniform(-0.3, 0.3) if not dead else rng.uniform(0, 2 * math.pi)
        L = rng.uniform(*cfg["L"]) * (0.8 if dead else 1.0)
        if dead:
            elev0, droop, rnd = rng.uniform(10, 25), rng.uniform(25, 45), _dead_rand(rng)
        elif rng.random() < 0.35:
            elev0, droop, rnd = rng.uniform(68, 82), rng.uniform(25, 50), _live_rand(rng)
        else:
            elev0, droop, rnd = rng.uniform(48, 68), rng.uniform(45, 80), _live_rand(rng)
        cr = cfg["crown"] * rng.uniform(0.3, 1.0)
        base = np.array([math.cos(az) * cr, math.sin(az) * cr, 0.01])
        _frond(mb, base, az, elev0, droop, L, cfg["pairs"], rnd, rng, cfg["sides"], dead)
    for i in range(cfg["fiddle"]):
        a = rng.uniform(0, 2 * math.pi)
        _crozier(mb, np.array([math.cos(a) * 0.01, math.sin(a) * 0.01, 0.0]), cfg["L"][0] * 0.35, _live_rand(rng), rng)
    # crown: old frond stubs radiating from the rootstock (contact with the ground)
    for i in range(7):
        a = 2 * math.pi * i / 7 + rng.uniform(-0.2, 0.2)
        dirs = _n(np.array([math.cos(a), math.sin(a), 0.0]) * 0.8 + Z * 0.6)
        b = np.array([math.cos(a) * cfg["crown"] * 0.3, math.sin(a) * cfg["crown"] * 0.3, -0.02])
        P = np.array([b, b + dirs * cfg["crown"] * 0.8, b + dirs * cfg["crown"] * 1.3])
        tube(mb, P, [cfg["crown"] * 0.22, cfg["crown"] * 0.16, 0.0], 4, part=0.5, rnd=_dead_rand(rng))
    return mb


# ============================================================== CRIMSON UNDERGROWTH
CRIMSON_V = {"A": dict(h=0.24, stems=7, leaf=0.040, nodes=6, lpc=(3, 5), flowers=0, branch=0.3, rows=3),
             "B": dict(h=0.50, stems=10, leaf=0.055, nodes=7, lpc=(5, 5), flowers=2, branch=0.35, rows=3),
             "C": dict(h=0.85, stems=11, leaf=0.075, nodes=6, lpc=(5, 5), flowers=3, branch=0.4, rows=3)}


def _compound_leaf(mb, P, pd, ln, nlf, rnd, rng, rows=4):
    up_l = _n(Z * 0.85 + pd * 0.15 + rng.normal(0, 0.15, 3))
    pet = ln * 0.40
    npairs = (nlf - 1) // 2
    rach = ln * 0.32 * max(npairs, 1)
    a = np.asarray(P, float)
    b = a + pd * pet
    d2 = _n(pd - Z * 0.25)
    c = b + d2 * rach
    path = np.array([a, b, (b + c) / 2 - Z * rach * 0.05, c])
    r = 0.0010 + 0.0016 * (ln / 0.06)
    tube(mb, path, [r, r * 0.8, r * 0.6, r * 0.3], 3, part=0.5, rnd=rnd)
    for k in range(npairs):
        t = (k + 0.5) / (npairs + 0.5)
        Q, T = _polyline_at(path[1:], t)
        side = np.cross(T, up_l)
        side = _n(side) if np.linalg.norm(side) > 1e-6 else _perp(T)
        for s in (-1, 1):
            dl = _n(T * math.cos(math.radians(58)) + side * s * math.sin(math.radians(58)))
            size = ln * (0.72 + 0.28 * (k + 1) / (npairs + 1)) * rng.uniform(0.88, 1.1)
            leaf(mb, Q, dl, up_l, size, size * rng.uniform(0.38, 0.5), rows=rows, cols=3, prof=rng.uniform(0.7, 0.95),
                 fold=0.32, curl=rng.uniform(-0.55, -0.15), serr=0.16, part=0.0, rnd=rnd)
    Q, T = _polyline_at(path, 1.0)
    leaf(mb, Q, T, up_l, ln * rng.uniform(0.95, 1.12), ln * 0.46, rows=rows, cols=3, prof=0.85, fold=0.32,
         curl=rng.uniform(-0.45, -0.15), serr=0.14, part=0.0, rnd=rnd)


def _stem_path(base, heading, lean, bend, length, rng, nseg=8):
    pts = [np.asarray(base, float)]
    p = pts[0].copy()
    lat = np.array([-heading[1], heading[0], 0.0])
    wig = rng.uniform(-0.15, 0.15)
    for i in range(nseg):
        t = (i + 0.5) / nseg
        le = lean + bend * t
        h = _n(heading + lat * wig * math.sin(t * 3))
        d = h * math.sin(le) + Z * math.cos(le)
        p = p + d * (length / nseg)
        pts.append(p.copy())
    return np.array(pts)


def build_crimson(var="B", seed=0):
    cfg = CRIMSON_V[var]
    rng = np.random.default_rng(2000 + seed * 31 + ord(var))
    mb = MB()
    h = cfg["h"]
    for s in range(cfg["stems"]):
        az = 2 * math.pi * s / cfg["stems"] + rng.uniform(-0.35, 0.35)
        heading = np.array([math.cos(az), math.sin(az), 0.0])
        lean = math.radians(rng.uniform(6, 36))
        length = h * rng.uniform(0.72, 1.0)
        base = heading * h * 0.04 * rng.random() + np.array([0, 0, -0.01])
        P = _stem_path(base, heading, lean, 0.3, length, rng)
        r = 0.0015 + 0.0032 * h
        tube(mb, P, np.linspace(r, r * 0.3, len(P)), 4, part=0.5, rnd=_live_rand(rng))
        nodes = cfg["nodes"]
        for j in range(nodes):
            t = 0.22 + 0.78 * j / (nodes - 1)
            Q, T = _polyline_at(P, t)
            phy = j * 2.4 + s * 0.9
            out = np.array([math.cos(phy), math.sin(phy), 0.0])
            out = out - T * np.dot(out, T)
            out = _n(out) if np.linalg.norm(out) > 1e-6 else _perp(T)
            pd = _n(out * 0.8 + T * 0.45 + Z * 0.25)
            ln = cfg["leaf"] * rng.uniform(0.82, 1.12) * (1 - 0.25 * j / (nodes - 1))
            lo, hi = cfg["lpc"]
            nlf = int(rng.choice([k for k in range(lo, hi + 1) if k % 2 == 1]))
            _compound_leaf(mb, Q, pd, ln, nlf, _live_rand(rng), rng, cfg["rows"])
        if rng.random() < cfg["branch"]:
            Q, T = _polyline_at(P, 0.45)
            az2 = az + rng.uniform(-0.8, 0.8)
            P2 = _stem_path(Q, np.array([math.cos(az2), math.sin(az2), 0.0]), lean + 0.35, 0.3, length * 0.5, rng, 5)
            tube(mb, P2, np.linspace(r * 0.6, r * 0.25, len(P2)), 3, part=0.5, rnd=_live_rand(rng))
            for j in range(3):
                Q2, T2 = _polyline_at(P2, 0.45 + 0.27 * j)
                out = _n(np.cross(T2, Z) * (1 if j % 2 else -1) + Z * 0.1)
                _compound_leaf(mb, Q2, _n(out + T2 * 0.4), cfg["leaf"] * 0.8, 3, _live_rand(rng), rng, cfg["rows"])
        if s < cfg["flowers"]:
            top, T = _polyline_at(P, 1.0)
            sl = h * rng.uniform(0.22, 0.32)
            sp = np.array([top + _n(T + Z) * sl * i / 6 for i in range(7)])
            tube(mb, sp, np.linspace(r * 0.35, r * 0.15, len(sp)), 3, part=0.5, rnd=_live_rand(rng))
            nb_ = int(10 + 6 * h)
            frnd = _live_rand(rng)
            for k in range(nb_):
                t = 0.25 + 0.75 * k / nb_
                Q, T = _polyline_at(sp, t)
                a = k * 2.4
                o = _n(np.cross(T, _perp(T)) * math.cos(a) + _perp(T) * math.sin(a))
                bs = (0.010 + 0.012 * h) * (1 - 0.45 * t)
                bud(mb, Q + o * bs * 0.35, _n(T + o * 0.7), bs * 1.6, bs * 0.45, part=1.0, rnd=frnd, spin=a)
    return mb


# ============================================================== VINES + DRIPS
def _strand_path(anchor, L, out, rng, arc=0.09, step=0.07, sway=1.0):
    side = _n(np.cross(Z, out))
    pts = [np.asarray(anchor, float) - out * 0.015 + Z * 0.008]
    for i in range(1, 6):
        th = math.pi / 2 * i / 5
        pts.append(np.asarray(anchor, float) + out * arc * math.sin(th) - Z * arc * (1 - math.cos(th)))
    end = pts[-1]
    ph1, ph2 = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
    lam1, lam2 = rng.uniform(0.6, 1.4), rng.uniform(0.9, 2.0)
    s = step
    rest = max(L - arc * 1.57, step)
    while s <= rest + 1e-6:
        A = (0.012 + 0.025 * s / max(L, 0.1)) * sway
        pts.append(end - Z * s + side * A * math.sin(2 * math.pi * s / lam1 + ph1)
                   + out * A * 0.6 * math.sin(2 * math.pi * s / lam2 + ph2))
        s += step
    return np.array(pts)


def _vine_strand(mb, anchor, L, out, rng, leaf_size=0.068, spacing=0.075, r0=0.0055):
    P = _strand_path(anchor, L, out, rng)
    rnd = _live_rand(rng)
    tube(mb, P, np.linspace(r0, r0 * 0.3, len(P)), 4, part=0.5, rnd=rnd)
    side = _n(np.cross(Z, out))
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    Ltot = float(seg.sum())
    s = 0.06
    alt = 1
    while s < Ltot - 0.03:
        Q, T = _polyline_at(P, s / Ltot)
        for pair in range(1 if rng.random() < 0.5 else 2):
            alt = -alt
            d = _n(-Z * 0.55 + out * 0.6 + side * alt * 0.65 + rng.normal(0, 0.15, 3))
            up = _n(out + Z * 0.3 + side * alt * 0.2)
            size = leaf_size * rng.uniform(0.7, 1.15) * (1 - 0.35 * s / Ltot)
            lr = _live_rand(rng) if rng.random() > 0.06 else _dead_rand(rng)
            leaf(mb, Q + d * 0.004, d, up, size, size * rng.uniform(0.55, 0.72), rows=4, cols=3, prof=0.55,
                 fold=0.22, curl=rng.uniform(-0.55, -0.2), serr=0.06, part=0.0, rnd=lr)
        s += spacing * rng.uniform(0.75, 1.25)
    return Ltot


VINE_V = {"A": dict(kind="curtain"), "B": dict(kind="long"), "C": dict(kind="festoon")}


def build_vine(var="A", seed=0):
    rng = np.random.default_rng(3000 + seed * 13 + ord(var))
    mb = MB()
    out = np.array([0.0, 1.0, 0.0])
    Lmax = 0.0
    if var == "A":
        for i in range(7):
            x = -0.45 + 0.9 * i / 6 + rng.uniform(-0.05, 0.05)
            L = rng.uniform(0.7, 2.2)
            _vine_strand(mb, np.array([x, 0.0, 0.0]), L, out, rng)
            Lmax = max(Lmax, L)
    elif var == "B":
        for x, L in ((-0.08, rng.uniform(4.3, 5.4)), (0.1, rng.uniform(3.2, 4.0)), (0.0, rng.uniform(1.0, 1.4))):
            _vine_strand(mb, np.array([x, 0.0, 0.0]), L, out, rng, leaf_size=0.075, spacing=0.09, r0=0.007)
            Lmax = max(Lmax, L)
    else:
        span, sag = 1.6, 0.45
        c = 0.5
        for _ in range(60):  # solve catenary parameter for the sag
            f = c * math.cosh(span / (2 * c)) - c - sag
            c = c * 1.05 if f > 0 else c * 0.97
        xs = np.linspace(-span / 2, span / 2, 24)
        P = np.array([[x, 0.03 * math.sin(x * 2), c * math.cosh(x / c) - c * math.cosh(span / (2 * c))] for x in xs])
        P = np.vstack([[-span / 2 - 0.01, -0.015, 0.01], P, [span / 2 + 0.01, -0.015, 0.01]])
        rnd = _live_rand(rng)
        tube(mb, P, np.full(len(P), 0.006), 4, part=0.5, rnd=rnd)
        Ltot = float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())
        s = 0.08
        alt = 1
        while s < Ltot - 0.05:
            Q, T = _polyline_at(P, s / Ltot)
            alt = -alt
            d = _n(-Z * 0.6 + out * 0.5 + T * alt * 0.5)
            size = 0.068 * rng.uniform(0.75, 1.15)
            leaf(mb, Q, d, _n(out + Z * 0.3), size, size * 0.62, rows=4, cols=3, prof=0.55, fold=0.22, curl=-0.35,
                 rnd=_live_rand(rng))
            s += 0.07 * rng.uniform(0.75, 1.25)
        Lmax = sag
        for i in range(3):
            Q, _ = _polyline_at(P, rng.uniform(0.25, 0.75))
            L = rng.uniform(0.4, 1.1)
            _vine_strand(mb, Q, L, out, rng)
            Lmax = max(Lmax, -Q[2] + L)
    return mb, Lmax


def _drip_strand(mb, anchor, L, rng, r0, lumpy=True, part=0.5):
    n = max(4, int(L / 0.025))
    out = _n(np.array([rng.uniform(-0.3, 0.3), 1.0, 0.0]))
    pts, rad = [], []
    kink = rng.uniform(-0.03, 0.03, 2)
    for i in range(n + 1):
        t = i / n
        p = np.asarray(anchor, float) + out * 0.02 * math.sin(t * 1.5) - Z * L * t
        p[0] += kink[0] * math.sin(t * 7 + kink[1] * 50)
        pts.append(p)
        r = r0 * (1 - 0.75 * t) * (1 + (0.35 * math.sin(t * 23 + kink[0] * 99) if lumpy else 0.0))
        rad.append(max(r, 0.0006))
    pts[0] = pts[0] + out * -0.012 + Z * 0.006
    rad[-1] = 0.0
    tube(mb, np.array(pts), rad, 4, part=part, rnd=_live_rand(rng))


def build_drip(var="A", seed=0):
    """A: hanging moss strands (Moss); B: thin hanging root hairs (Root). Origin = anchor line centre."""
    rng = np.random.default_rng(3500 + seed * 7 + ord(var))
    mb = MB()
    if var == "A":
        for i in range(14):
            x = rng.normal(0.0, 0.05)
            _drip_strand(mb, np.array([x, rng.uniform(-0.01, 0.01), 0.0]), rng.uniform(0.04, 0.20) * rng.uniform(0.6, 1.0),
                         rng, rng.uniform(0.003, 0.006), True)
        return mb, 0.20
    for i in range(12):
        x = rng.normal(0.0, 0.06)
        _drip_strand(mb, np.array([x, rng.uniform(-0.01, 0.01), 0.0]), rng.uniform(0.05, 0.22), rng,
                     rng.uniform(0.002, 0.0045), False)
    return mb, 0.22


# ============================================================== ROOTS (surface-walking)
def _nearest(bvh, p):
    loc, nrm, idx, dist = bvh.find_nearest(Vector(p))
    if loc is None:
        return None, None
    return np.array(loc), _n(np.array(nrm))


def grow_root(bvh, start, direction, length, r0, rng, r_tip=0.003, gravity=0.9, wander=0.35, step=None,
              exclude_fn=None, seed=0):
    """Walk along a surface (BVH) from `start`, following `direction`, pulled downhill by gravity, wrapping
    over convex edges.  Returns (surface_pts, normals, radii) or None."""
    step = step or float(np.clip(r0 * 1.1, 0.016, 0.05))
    nsteps = max(4, int(length / step))
    p, n = _nearest(bvh, start)
    if p is None:
        return None
    d = np.asarray(direction, float)
    d = _n(d - n * np.dot(d, n))
    pts, nrms = [p], [n]
    ph = rng.uniform(0, 100)
    import mathutils.noise as mn
    for i in range(nsteps):
        g = np.array([0, 0, -1.0])
        gt = g - n * np.dot(g, n)
        w = wander * mn.noise(Vector((ph + i * step * 2.5, seed * 1.7, 0.3)))
        d = _n(_rot(d, n, w * 0.5))
        d = _n(d + gt * gravity * 0.35)
        q = p + d * step
        loc, nn = _nearest(bvh, q)
        if loc is None:
            break
        mv = loc - p
        if np.linalg.norm(mv) < step * 0.35:   # stuck at a convex edge: dive around it
            loc, nn = _nearest(bvh, p + d * step - n * step * 0.9)
            if loc is None:
                break
            mv = loc - p
            if np.linalg.norm(mv) < step * 0.2:
                break
        if exclude_fn is not None and exclude_fn(tuple(loc)):
            break
        d = _n(mv)
        p, n = loc, nn
        pts.append(p)
        nrms.append(n)
    if len(pts) < 4:
        return None
    P = np.array(pts)
    N = np.array(nrms)
    Ns = N.copy()
    for k in range(3):  # smooth normals
        Ns[1:-1] = (Ns[:-2] + Ns[1:-1] * 2 + Ns[2:]) / 4
    Ns = np.array([_n(v) for v in Ns])
    t = np.linspace(0, 1, len(P))
    radii = r_tip + (r0 - r_tip) * (1 - t) ** 0.8
    ph2 = rng.uniform(0, 6.28)
    radii *= (1.0 + 0.16 * np.sin(t * length * 9.0 + ph2) * np.sin(t * length * 3.1 + ph2 * 2)
              + 0.08 * np.sin(t * length * 23.0 + ph2 * 3))
    return P, Ns, radii


def root_mesh(mb, bvh, start, direction, length, r0, rng, depth=2, nbranch=3, exclude_fn=None, seed=0,
              embed=0.5, flatten=0.75):
    """Branching root system grown on the surface.  Returns list of centreline arrays (for contact test)."""
    res = grow_root(bvh, start, direction, length, r0, rng, exclude_fn=exclude_fn, seed=seed)
    if res is None:
        return []
    P, N, radii = res
    off = radii * embed
    off[:3] *= np.array([0.2, 0.5, 0.8])[: min(3, len(off))]   # emerging, more buried at the start
    C = P + N * off[:, None]
    C = np.vstack([P[0] - N[0] * radii[0] * 1.2, C])
    N = np.vstack([N[0], N])
    radii = np.concatenate([[radii[0] * 0.95], radii])
    radii[-1] = 0.0
    sides = 8 if r0 > 0.045 else (6 if r0 > 0.025 else 4)
    tube(mb, C, radii, sides, part=0.5, rnd=_live_rand(rng), nref=N, flatten=flatten)
    out = [C]
    if depth > 0:
        for b in range(nbranch):
            t = rng.uniform(0.15, 0.6)
            i = int(t * (len(P) - 1))
            if i < 1:
                continue
            dloc = _n(P[min(i + 1, len(P) - 1)] - P[i - 1])
            bd = _rot(dloc, N[i], math.radians(rng.uniform(35, 70)) * (1 if rng.random() < 0.5 else -1))
            out += root_mesh(mb, bvh, P[i], bd, length * (1 - t) * rng.uniform(0.35, 0.65),
                             max(radii[i] * rng.uniform(0.45, 0.6), 0.004), rng, depth - 1, max(nbranch - 1, 1),
                             exclude_fn, seed + b + 1, embed, flatten)
    return out


def _root_proxy():
    """Rounded 90-degree edge block: top z=0 for y<0, front face y=0 for z<0 (slightly wavy)."""
    import cf_sdf as S

    def f(P):
        Q = S.warp(P, 0.03, 1.5, seed=5)
        return S.box(Q, (0.0, -0.9, -0.9), (1.4, 0.9, 0.9), round_r=0.07)
    v, q = S.mesh_sdf(f, (-1.5, -1.9, -1.9), (1.5, 0.15, 0.15), 0.03, verbose=False)
    tri = np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]])
    bvh = BVHTree.FromPolygons(v.tolist(), tri.tolist(), all_triangles=True)
    return bvh, (v, q)


ROOT_V = {"A": [((0.05, -1.1, 0.0), (0.0, 1.0, 0.0), 2.4, 0.07, 3)],
          "B": [((-0.2, -0.95, 0.0), (0.12, 1.0, 0.0), 2.0, 0.045, 2), ((0.18, -0.8, 0.0), (-0.1, 1.0, 0.0), 1.6, 0.038, 2)],
          "C": [((0.0, -0.75, 0.0), (math.sin(a), math.cos(a), 0.0), L, r, 1)
                for a, L, r in ((-0.7, 1.3, 0.024), (-0.35, 1.6, 0.03), (0.0, 1.2, 0.022), (0.35, 1.5, 0.027),
                                (0.7, 1.05, 0.02))]}


def build_root(var="A", seed=0, proxy=None):
    rng = np.random.default_rng(4000 + seed * 11 + ord(var))
    bvh = proxy[0] if proxy else _root_proxy()[0]
    mb = MB()
    for k, (st, dr, L, r0, nb_) in enumerate(ROOT_V[var]):
        root_mesh(mb, bvh, np.array(st, float), np.array(dr, float), L, r0, rng, 2, nb_, seed=seed * 10 + k)
    return mb


# ============================================================== MOSS CUSHIONS
CUSHION_V = {"A": dict(R=(0.09, 0.09), H=0.045, k=3, budget=900, fuzz=250),
             "B": dict(R=(0.18, 0.16), H=0.075, k=5, budget=1500, fuzz=550),
             "C": dict(R=(0.32, 0.22), H=0.10, k=7, budget=2200, fuzz=900)}


def build_cushion(var="B", seed=0):
    import cf_sdf as S
    cfg = CUSHION_V[var]
    rng = np.random.default_rng(5000 + seed * 3 + ord(var))
    Rx, Ry = cfg["R"]
    H = cfg["H"]
    blobs = []
    for i in range(cfg["k"]):
        a = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(0, 0.5)
        c = (math.cos(a) * Rx * rr, math.sin(a) * Ry * rr, -0.01)
        rad = (Rx * rng.uniform(0.45, 0.7), Ry * rng.uniform(0.45, 0.7), H * rng.uniform(0.75, 1.1))
        blobs.append((c, rad))

    def f(P):
        d = None
        for c, rad in blobs:
            e = S.ellipsoid(P, c, rad)
            d = e if d is None else S.smin(d, e, min(Rx, Ry) * 0.25)
        d = d + H * 0.16 * S.fbm(P, 5.0 / min(Rx, Ry), 3, seed=seed + 3) \
            - H * 0.10 * S.ridged(P, 22.0 / min(Rx, Ry), 2, seed=9) + H * 0.05
        return np.maximum(d, -(P[:, 2] + 0.012))
    vox = min(Rx, Ry) / 22.0
    v, q = S.mesh_sdf(f, (-Rx * 1.3, -Ry * 1.3, -0.02), (Rx * 1.3, Ry * 1.3, H * 1.4), vox, verbose=False)
    return (v, q), cfg["budget"]


# ============================================================== SEDGE TUFTS
TUFT_V = {"A": dict(n=48, L=(0.08, 0.17), w=0.0028, elev=(40, 84), curl=(-1.4, -0.4), seeds=0),
          "B": dict(n=70, L=(0.20, 0.42), w=0.0036, elev=(32, 82), curl=(-2.4, -0.9), seeds=0),
          "C": dict(n=44, L=(0.15, 0.30), w=0.0032, elev=(40, 85), curl=(-1.8, -0.6), seeds=6)}


def build_tuft(var="B", seed=0):
    cfg = TUFT_V[var]
    rng = np.random.default_rng(6000 + seed * 5 + ord(var))
    mb = MB()
    for i in range(cfg["n"]):
        az = rng.uniform(0, 2 * math.pi)
        rb = rng.uniform(0.0, 0.02)
        base = np.array([math.cos(az) * rb, math.sin(az) * rb, -0.008])
        el = math.radians(rng.uniform(*cfg["elev"]))
        h = np.array([math.cos(az), math.sin(az), 0.0])
        d = h * math.cos(el) + Z * math.sin(el)
        up = _n(np.cross(np.array([-h[1], h[0], 0.0]), d))
        L = rng.uniform(*cfg["L"])
        leaf(mb, base, d, up, L, cfg["w"] * rng.uniform(0.8, 1.2) * 2, rows=5, cols=3, fold=0.55,
             curl=rng.uniform(*cfg["curl"]) * (L / cfg["L"][1]), twist=rng.uniform(-0.6, 0.6), part=0.0,
             rnd=_live_rand(rng) if rng.random() > 0.1 else _dead_rand(rng), wfun=lambda t: (1 - t ** 2.4))
    for i in range(cfg["seeds"]):
        az = rng.uniform(0, 2 * math.pi)
        h = np.array([math.cos(az), math.sin(az), 0.0])
        L = rng.uniform(0.30, 0.42)
        P = np.array([[0, 0, -0.005]] + [h * 0.05 * (k / 6) ** 1.5 * L / 0.3 + Z * L * k / 6 for k in range(1, 7)])
        tube(mb, P, np.linspace(0.0016, 0.0009, len(P)), 3, part=0.5, rnd=_live_rand(rng))
        top, T = _polyline_at(P, 0.97)
        for k in range(3):
            bud(mb, top - T * 0.012 * k + _perp(T) * 0.003 * (k - 1), _n(T + _perp(T) * 0.3 * (k - 1)), 0.022,
                0.0035, part=1.0, rnd=_live_rand(rng), spin=k)
    return mb


# ============================================================== SHELF FUNGI
FUNGUS_V = {"A": dict(n=3, R=(0.035, 0.065), dz=0.028), "B": dict(n=5, R=(0.06, 0.11), dz=0.04),
            "C": dict(n=7, R=(0.07, 0.15), dz=0.05)}


def _bracket(mb, c, R, rng, tilt=0.12, span=1.35, rings=5, segs=10):
    """Half-disc shelf on the wall (XZ plane), protruding +Y.  UV x = radial 0..1."""
    rnd = _live_rand(rng)
    th0 = R * 0.45
    top, und = [], []
    for i in range(rings + 1):
        r = R * (i / rings)
        rowt, rowu = [], []
        for j in range(segs + 1):
            a = -span + 2 * span * j / segs
            x = math.sin(a) * r * 1.15
            y = math.cos(a) * r * 0.72 - 0.008
            wob = 1 + 0.08 * math.sin(a * 5 + rnd * 20)
            ztop = c[2] + th0 * (1 - (i / rings) ** 1.6) * wob + r * tilt
            zb = c[2] + r * tilt * 0.8 - th0 * 0.15 * (1 - i / rings)
            if i == rings:
                zb = ztop = (ztop + zb) / 2
            rowt.append(mb.v((c[0] + x, c[1] + y, ztop), (i / rings, j / segs), 0.0, rnd))
            rowu.append(mb.v((c[0] + x, c[1] + y, zb), (i / rings, j / segs), 0.5, rnd) if i < rings else rowt[-1])
        top.append(rowt)
        und.append(rowu)
    for i in range(rings):
        for j in range(segs):
            mb.f((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
            if i + 1 < rings:
                mb.f((und[i][j + 1], und[i][j], und[i + 1][j], und[i + 1][j + 1]))
            else:
                mb.f((und[i][j + 1], und[i][j], top[i + 1][j]))
                mb.f((und[i][j + 1], top[i + 1][j], top[i + 1][j + 1]))


def build_fungus(var="B", seed=0):
    cfg = FUNGUS_V[var]
    rng = np.random.default_rng(7000 + seed * 3 + ord(var))
    mb = MB()
    z = 0.0
    for i in range(cfg["n"]):
        R = rng.uniform(*cfg["R"]) * (1.0 - 0.35 * i / max(cfg["n"] - 1, 1))
        x = rng.uniform(-0.45, 0.45) * cfg["R"][1] + 0.35 * cfg["R"][1] * math.sin(i * 1.9)
        _bracket(mb, np.array([x, 0.0, z]), R, rng, tilt=rng.uniform(0.04, 0.14))
        z += cfg["dz"] * rng.uniform(0.7, 1.15)
    return mb


# ============================================================== KIT BUILD / LOAD
def _decimated_sdf_obj(name, vq, budget, materials, collection):
    import cf_sdf as S
    v, q = vq
    ob = S.to_blender_mesh(name, v, q, collection)
    ntri = len(q) * 2
    if ntri > budget:
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.ratio = budget / ntri
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.clear()
        old = ob.data
        ob.data = me
        bpy.data.meshes.remove(old)
        me.name = name
    me = ob.data
    uvl = me.uv_layers.new(name="UVMap")
    for nm in ("cf_part", "cf_rand"):
        if me.attributes.get(nm) is None:
            me.attributes.new(nm, "FLOAT", "POINT")
    for m in materials:
        me.materials.append(m)
    me.shade_smooth()
    return ob


def _add_fuzz(ob, n, length, seed):
    """Tiny attached moss sporophyte spikes (1 tri each) for silhouette fuzz on cushions."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    rng = np.random.default_rng(seed)
    faces = [f for f in bm.faces if f.normal.z > -0.15]
    if not faces:
        bm.free()
        return
    areas = np.array([f.calc_area() for f in faces])
    idx = rng.choice(len(faces), n, p=areas / areas.sum())
    for i in idx:
        f = faces[int(i)]
        c = f.calc_center_median()
        v = f.verts[int(rng.integers(len(f.verts)))].co
        base = c.lerp(v, float(rng.uniform(0, 0.8)))
        nrm = f.normal
        d = (nrm + Vector(rng.normal(0, 0.8, 3))).normalized()
        if d.z < 0.15:
            d.z += 0.35
            d.normalize()
        L = length * float(rng.uniform(0.5, 1.25))
        side = d.orthogonal().normalized() * 0.0007
        a = bm.verts.new(base - nrm * 0.0015 - side)
        b = bm.verts.new(base - nrm * 0.0015 + side)
        t = bm.verts.new(base + d * L)
        bm.faces.new((a, b, t))
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()


def _tag(ob, family, variant, **kw):
    ob["cf_family"] = family
    ob["cf_variant"] = variant
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mn, mx = co.min(0), co.max(0)
    ob["cf_dims"] = [float(x) for x in (mx - mn)]
    ob["cf_zmin"] = float(mn[2])
    low = co[co[:, 2] < mn[2] + max(0.02, 0.08 * (mx[2] - mn[2]))]
    ob["cf_footprint"] = float(np.max(np.linalg.norm(low[:, :2], axis=1))) if len(low) else 0.05
    for k, v in kw.items():
        ob[k] = v


def build_kit(seed=0, collection=None):
    """Build every kit object (at origin) into per-family collections.  Returns {family: [objects]}."""
    root = collection or bpy.context.scene.collection
    cols = {}
    for fam, cname in FAMILY_COLL.items():
        c = bpy.data.collections.new(cname)
        root.children.link(c)
        cols[fam] = c
    out = {f: [] for f in FAMILY_COLL}
    for var in "ABC":
        ob = build_fern(var, seed).to_object(f"CFCL_Veg_Fern_{var}", [_mat("Fern")], cols["ferns"])
        _tag(ob, "ferns", var)
        out["ferns"].append(ob)
        ob = build_crimson(var, seed).to_object(f"CFCL_Veg_Crimson_{var}", [_mat("CrimsonLeaf")], cols["crimson"])
        _tag(ob, "crimson", var)
        out["crimson"].append(ob)
        mb, L = build_vine(var, seed)
        ob = mb.to_object(f"CFCL_Veg_Vine_{var}", [_mat("Vine")], cols["vines"])
        _tag(ob, "vines", var, cf_length=float(L))
        out["vines"].append(ob)
        ob = build_tuft(var, seed).to_object(f"CFCL_Veg_Tuft_{var}", [_mat("Sedge")], cols["tufts"])
        _tag(ob, "tufts", var)
        out["tufts"].append(ob)
        ob = build_fungus(var, seed).to_object(f"CFCL_Veg_Fungus_{var}", [_mat("Fungus")], cols["fungi"])
        _tag(ob, "fungi", var)
        out["fungi"].append(ob)
        vq, budget = build_cushion(var, seed)
        ob = _decimated_sdf_obj(f"CFCL_Veg_MossCushion_{var}", vq, budget, [_mat("Moss")], cols["cushions"])
        _add_fuzz(ob, int(CUSHION_V[var]["fuzz"] * 1.4), 0.0045 + 0.003 * CUSHION_V[var]["H"] / 0.1, 77 + ord(var))
        _tag(ob, "cushions", var)
        out["cushions"].append(ob)
    for var, mname in (("A", "Vine"), ("B", "Root")):
        mb, L = build_drip(var, seed)
        ob = mb.to_object(f"CFCL_Veg_Drip_{var}", [_mat(mname)], cols["drips"])
        _tag(ob, "drips", var, cf_length=float(L))
        out["drips"].append(ob)
    proxy = _root_proxy()
    for var in "ABC":
        ob = build_root(var, seed, proxy).to_object(f"CFCL_Veg_Root_{var}", [_mat("Root")], cols["roots"])
        _tag(ob, "roots", var)
        out["roots"].append(ob)
    return out, proxy


def latest_kit(kit_dir=KIT_DIR):
    files = sorted(glob.glob(os.path.join(kit_dir, "CFCL_Veg_Kit_v[0-9][0-9][0-9].blend")))
    return files[-1] if files else None


def _layer_coll(lc, name):
    if lc.collection.name == name:
        return lc
    for ch in lc.children:
        r = _layer_coll(ch, name)
        if r:
            return r
    return None


_KIT = {}


def load_kit(path=None, link=False, remap_materials=True):
    """Append (or link) the kit's CFCL_Veg_* objects once into a hidden prototype collection.
    Returns {family: [objects sorted by size]}."""
    path = path or latest_kit()
    if not path or not os.path.exists(path):
        raise FileNotFoundError("cf_vegetation: kit blend not found: %r" % path)
    key = os.path.normcase(os.path.abspath(path))
    cached = _KIT.get(key)
    if cached and all(o.name in bpy.data.objects for objs in cached.values() for o in objs):
        return cached
    mats_before = set(bpy.data.materials.keys())
    with bpy.data.libraries.load(path, link=link) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith("CFCL_Veg_")]
    if remap_materials and not link:
        # the kit carries a snapshot of the materials from its build time; rename every newly appended CFCL_
        # material so M.get() below always resolves to (or builds) the LIVE library recipe, never the snapshot
        for mname in set(bpy.data.materials.keys()) - mats_before:
            m = bpy.data.materials.get(mname)
            if m is not None and m.library is None and mname.startswith("CFCL_"):
                m.name = "KITSNAP_" + mname
    coll = bpy.data.collections.get("CFCL_Veg_KitProtos")
    if coll is None:
        coll = bpy.data.collections.new("CFCL_Veg_KitProtos")
        bpy.context.scene.collection.children.link(coll)
    lc = _layer_coll(bpy.context.view_layer.layer_collection, coll.name)
    if lc:
        lc.exclude = True
    protos = {f: [] for f in FAMILY_COLL}
    for ob in dst.objects:
        if ob is None:
            continue
        if ob.name not in coll.objects:
            coll.objects.link(ob)
        fam = ob.get("cf_family")
        if fam in protos:
            protos[fam].append(ob)
        if remap_materials and not link and M is not None and ob.type == "MESH":
            me = ob.data
            for i, m in enumerate(me.materials):
                if m is None:
                    continue
                nm = m.name[len("KITSNAP_"):] if m.name.startswith("KITSNAP_") else m.name
                if not nm.startswith(M.PREFIX):
                    continue
                base = nm[len(M.PREFIX):].split(".")[0]
                if "__" in base or base not in M.RECIPES:
                    continue
                new = M.get(base)
                if new is not m:
                    me.materials[i] = new
                    if m.users == 0:
                        bpy.data.materials.remove(m)
    for f in protos:
        protos[f].sort(key=lambda o: o.get("cf_variant", "Z"))
    _KIT[key] = protos
    return protos


# ============================================================== EXCLUSION HELPERS
def make_board_exclude(half=0.38, margin=0.03, r_clear=0.5, z_min=-0.10, corridor=True, corridor_halfwidth=0.5,
                       corridor_y=(-2.2, 0.0), corridor_z=(-1.2, 0.8)):
    """Exclusion fn for the sacred board: nothing over the board frame + margin (square) or within r_clear of
    the origin above z_min, and (optionally) nothing in the player's -Y corridor."""
    lim = half + margin

    def ex(p):
        x, y, z = p[0], p[1], p[2]
        if z > z_min and ((abs(x) < lim and abs(y) < lim) or (x * x + y * y < r_clear * r_clear)):
            return True
        if corridor and abs(x) < corridor_halfwidth and corridor_y[0] < y < min(corridor_y[1], -lim) and \
                corridor_z[0] < z < corridor_z[1]:
            return True
        return False
    return ex


board_exclude = make_board_exclude()


# ============================================================== SURFACE ANALYSIS
def _surface(obj, scale):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = np.array(obj.matrix_world)
    R3, t3 = mw[:3, :3], mw[:3, 3]
    nv = len(me.vertices)
    co = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64) @ R3.T + t3
    vn = np.empty(nv * 3, np.float32)
    try:
        me.vertex_normals.foreach_get("vector", vn)
    except Exception:
        me.vertices.foreach_get("normal", vn)
    NM = np.linalg.inv(R3).T
    vn = vn.reshape(-1, 3).astype(np.float64) @ NM.T
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3)
    ed = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", ed)
    ed = ed.reshape(-1, 2)
    ev.to_mesh_clear()
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    cr = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(cr, axis=1)
    tn = cr / np.maximum(2 * area[:, None], 1e-12)
    bvh = BVHTree.FromPolygons(co.tolist(), tri.tolist(), all_triangles=True)
    # curvature (1/m)
    n = nv
    e0, e1 = ed[:, 0], ed[:, 1]
    cnt = np.maximum(np.bincount(e0, minlength=n) + np.bincount(e1, minlength=n), 1).astype(float)
    acc = np.zeros((n, 3))
    for i in range(3):
        acc[:, i] = np.bincount(e0, weights=co[e1, i], minlength=n) + np.bincount(e1, weights=co[e0, i], minlength=n)
    lap = acc / cnt[:, None] - co
    el = np.linalg.norm(co[e0] - co[e1], axis=1)
    ml = (np.bincount(e0, weights=el, minlength=n) + np.bincount(e1, weights=el, minlength=n)) / cnt + 1e-9
    kap = -2.0 * (lap * vn).sum(1) / (ml * ml)
    for _ in range(2):
        s_ = np.bincount(e0, weights=kap[e1], minlength=n) + np.bincount(e1, weights=kap[e0], minlength=n)
        kap = 0.5 * kap + 0.5 * s_ / cnt
    # min/max face nz around each vertex, widened over k rings (~ 6-8 cm or 3 rings)
    vmin = np.full(n, 2.0)
    vmax = np.full(n, -2.0)
    for k in range(3):
        np.minimum.at(vmin, tri[:, k], tn[:, 2])
        np.maximum.at(vmax, tri[:, k], tn[:, 2])
    rings = int(np.clip(0.07 * scale / max(np.median(el), 1e-4), 1, 6))
    for _ in range(rings):
        a1 = vmin.copy()
        np.minimum.at(a1, e0, vmin[e1])
        np.minimum.at(a1, e1, vmin[e0])
        b1 = vmax.copy()
        np.maximum.at(b1, e0, vmax[e1])
        np.maximum.at(b1, e1, vmax[e0])
        vmin, vmax = a1, b1
    # crease-edge samples (for coarse low-poly targets): edges whose two triangles differ > 35 deg
    te = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
    tid = np.concatenate([np.arange(len(tri))] * 3)
    order = np.lexsort((te[:, 1], te[:, 0]))
    te, tid = te[order], tid[order]
    same = np.all(te[1:] == te[:-1], axis=1)
    i1 = np.nonzero(same)[0]
    creases = []
    for i in i1:
        ta, tb = tid[i], tid[i + 1]
        if np.dot(tn[ta], tn[tb]) < 0.82:
            p0, p1 = co[te[i, 0]], co[te[i, 1]]
            L = np.linalg.norm(p1 - p0)
            m = max(1, int(L / (0.05 * scale)))
            nz_hi, nz_lo = max(tn[ta, 2], tn[tb, 2]), min(tn[ta, 2], tn[tb, 2])
            nav = _n(tn[ta] + tn[tb])
            for j in range(m + 1):
                creases.append((p0 + (p1 - p0) * j / m, nz_hi, nz_lo, nav))
    return dict(co=co, vn=vn, tri=tri, tn=tn, area=area, bvh=bvh, kap=kap, vmin=vmin, vmax=vmax, edges=ed,
                el=float(np.median(el)), creases=creases)


def _subdivide_long(bm, max_len, max_iter=6, max_faces=250000):
    for _ in range(max_iter):
        long_e = [e for e in bm.edges if e.calc_length() > max_len]
        if not long_e or len(bm.faces) > max_faces:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])


# ============================================================== MOSS SHELL
def _moss_shell(name, surf, coll, s, cover, thick, seed, exclude_fn, res=None, kdf=None):
    co, tri, tn = surf["co"], surf["tri"], surf["tn"]
    cand = tn[:, 2] > 0.12
    if not np.any(cand):
        return None, 0, 0.0
    ctri = tri[cand]
    used = np.unique(ctri)
    remap = -np.ones(len(co), np.int64)
    remap[used] = np.arange(len(used))
    bm = bmesh.new()
    vs = [bm.verts.new(co[i]) for i in used]
    bm.verts.ensure_lookup_table()
    for t in ctri:
        try:
            bm.faces.new((vs[remap[t[0]]], vs[remap[t[1]]], vs[remap[t[2]]]))
        except ValueError:
            pass
    res = res or max(0.035 * s, surf["el"] * 0.9)
    area_c = float(surf["area"][cand].sum())
    res = max(res, math.sqrt(area_c / 120000.0))   # face budget
    _subdivide_long(bm, res * 1.5)
    bm.normal_update()
    P = np.array([v.co[:] for v in bm.verts])
    Nn = np.array([v.normal[:] for v in bm.verts])
    # curvature of nearest original vertex
    kd = KDTree(len(co))
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    kap = surf["kap"]
    kk = np.array([kap[kd.find(p)[1]] for p in P])
    conc = np.clip(-kk * s / 5.0, 0, 1)
    q = P / s
    big = _fbm(q, 0.5, 3, seed + 11)
    mid = _fbm(q, 2.0, 3, seed + 12)
    fin = _fbm(q, 9.0, 2, seed + 13)
    isl = _fbm(q, 3.5, 2, seed + 14)
    near = np.zeros(len(P))
    if kdf is not None:
        fd = np.array([kdf.find(p)[2] for p in P])
        near = np.exp(-fd / (0.35 * s))
    # crevice / edge driven, medium + fine breakup, bare-rock islands (no large flat camouflage patches)
    rag = _fbm(q, 26.0, 2, seed + 15)
    crev = np.maximum(conc * (Nn[:, 2] > 0.0), near)
    base = _ss(Nn[:, 2], 0.45, 0.80) * (0.28 + 0.9 * crev)
    score = base * (0.6 + 0.8 * np.clip(0.5 + big, 0, 1)) + 0.38 * mid + 0.25 * fin + 0.18 * rag
    score -= 0.9 * _ss(isl, 0.10, 0.28)
    thr = 0.66 - 0.45 * cover
    sel = score > thr
    if exclude_fn is not None:
        ex = np.array([bool(exclude_fn(tuple(p))) for p in P])
        sel &= ~ex
    bm.verts.ensure_lookup_table()
    for i, v in enumerate(bm.verts):
        v.tag = bool(sel[i])
    kill = [f for f in bm.faces if not all(v.tag for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # drop tiny islands
    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    seen = set()
    small = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if len(comp) < 10:
            small += comp
    if small:
        bmesh.ops.delete(bm, geom=small, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if len(bm.faces) == 0:
        bm.free()
        return None, 0, 0.0
    def _edge_dist():
        bm.normal_update()
        bm.verts.index_update()
        bm.edges.index_update()
        bm.faces.index_update()
        bm.verts.ensure_lookup_table()
        P_ = np.array([v.co[:] for v in bm.verts])
        N_ = np.array([v.normal[:] for v in bm.verts])
        E_ = np.array([(e.verts[0].index, e.verts[1].index) for e in bm.edges], np.int64)
        EL_ = np.linalg.norm(P_[E_[:, 0]] - P_[E_[:, 1]], axis=1)
        bnd = np.zeros(len(P_), bool)
        for e in bm.edges:
            if len(e.link_faces) < 2:
                bnd[e.verts[0].index] = bnd[e.verts[1].index] = True
        d_ = np.where(bnd, 0.0, 1e9)
        for _ in range(60):
            d0 = d_.copy()
            np.minimum.at(d_, E_[:, 0], d_[E_[:, 1]] + EL_)
            np.minimum.at(d_, E_[:, 1], d_[E_[:, 0]] + EL_)
            if np.allclose(d0, d_):
                break
        return P_, N_, d_

    # 1) fragment the outer band: random face dropout that increases toward the patch edge, so the outline
    #    breaks into scattered clumps instead of a clean decal edge
    P, Nn, dist = _edge_dist()
    q = P / s
    band = 0.07 * s
    fn = _fbm(q, 18.0, 2, seed + 31)
    drop = []
    for f in bm.faces:
        vi = [v.index for v in f.verts]
        dfc = float(np.mean(dist[vi]))
        # ~75 % dropout right at the rim, ~35 % mid-band, ~5 % at 7 cm -> ragged outline, interior kept
        if dfc < band and (dfc / band) < 0.35 + 1.2 * float(np.mean(fn[vi])):
            drop.append(f)
    if drop and len(drop) < len(bm.faces) * 0.9:
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.faces.index_update()
        seen2, flakes = set(), []
        for f in bm.faces:
            if f.index in seen2:
                continue
            stack, comp = [f], []
            seen2.add(f.index)
            while stack:
                g = stack.pop()
                comp.append(g)
                for e in g.edges:
                    for hf in e.link_faces:
                        if hf.index not in seen2:
                            seen2.add(hf.index)
                            stack.append(hf)
            if len(comp) < 12:
                flakes += comp
        if flakes:
            bmesh.ops.delete(bm, geom=flakes, context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if len(bm.faces) == 0:
        bm.free()
        return None, 0, 0.0
    # 2) re-measure the distance to the (new, ragged) boundary and tuck every edge under the surface
    P, Nn, dist = _edge_dist()
    nvt = len(P)
    q = P / s
    ew = 0.18 * s * (0.6 + 0.8 * np.clip(0.5 + _fbm(q, 4.0, 2, seed + 21), 0, 1))
    fall = _ss(dist, 0.0, ew)
    # small islands (scattered clumps from the dropout) keep a minimum lift instead of being fully tucked
    bm.faces.ensure_lookup_table()
    comp_size = np.zeros(nvt)
    seen = set()
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for hf in e.link_faces:
                    if hf.index not in seen:
                        seen.add(hf.index)
                        stack.append(hf)
        vids = {v.index for g in comp for v in g.verts}
        for vi in vids:
            comp_size[vi] = len(comp)
    fall = np.where(comp_size < 60, np.maximum(fall, 0.35), fall)
    t0, t1 = thick
    hb = t0 + (t1 - t0) * np.clip(0.5 + 0.9 * _fbm(q, 1.2, 2, seed + 22), 0, 1)
    lump = np.clip(0.5 + 0.9 * _fbm(q, 9.0, 3, seed + 23), 0, 1)
    h = s * (hb * (0.35 + 0.9 * lump * lump)) * fall ** 1.5 - 0.004 * s * (1 - fall)
    P2 = P + Nn * h[:, None]
    for i, v in enumerate(bm.verts):
        v.co = P2[i]
    # dry patches -> second material slot
    dryn = _fbm(q, 0.9, 2, seed + 24)
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if float(np.mean([dryn[v.index] for v in f.verts])) > 0.28 else 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    nf = len(bm.faces)
    bm.free()
    # cf_edge (1 at the patch boundary -> 0 inside): Moss material thins/darkens toward the edge (no decal outline)
    ea = me.attributes.new("cf_edge", "FLOAT", "POINT")
    ea.data.foreach_set("value", np.clip(1.0 - _ss(dist, 0.0, 2.2 * ew), 0, 1).astype(np.float32))
    me.materials.append(_mat("Moss"))
    me.materials.append(_mat("MossDry"))
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    sol = ob.modifiers.new("cf_solidify", "SOLIDIFY")
    sol.thickness = 0.008 * s
    sol.offset = -1.0
    sol.use_even_offset = False
    # contact: max distance of shell vertices to surface
    bvh = surf["bvh"]
    mx = 0.0
    step = max(1, len(P2) // 4000)
    for p in P2[::step]:
        loc, _, _, d = bvh.find_nearest(Vector(p))
        if loc is not None:
            mx = max(mx, d)
    return ob, nf, mx


# ============================================================== CLUMP SCATTER
FAM_R = {"ferns": 0.33, "crimson": 0.22, "tufts": 0.11, "cushions": 0.14}
FAM_W = {"cushions": 0.34, "crimson": 0.30, "ferns": 0.20, "tufts": 0.16}
COMPANION = {"ferns": ("tufts", "cushions"), "crimson": ("tufts", "ferns"), "tufts": ("cushions",),
             "cushions": ("tufts", "crimson")}


def _quat_to(axis):
    return Vector((0, 0, 1)).rotation_difference(Vector(axis))


def _place(proto, loc, quat, scl, coll, name):
    ob = bpy.data.objects.new(name, proto.data)
    ob.matrix_world = Matrix.Translation(Vector(loc)) @ quat.to_matrix().to_4x4() @ Matrix.Diagonal((scl, scl, scl, 1.0))
    coll.objects.link(ob)
    for k in ("cf_family", "cf_variant"):
        if k in proto:
            ob[k] = proto[k]
    return ob


_BB = {}


def _proto_box(proto):
    """8 local bbox corners computed from mesh data (bound_box is unreliable for excluded prototypes)."""
    key = proto.data.name
    if key not in _BB:
        me = proto.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        mn, mx = co.min(0), co.max(0)
        _BB[key] = [(x, y, z) for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]
    return _BB[key]


def _bbox_world(proto, loc, quat, scl):
    R3 = quat.to_matrix()
    out = []
    for c in _proto_box(proto):
        v = R3 @ (Vector(c) * scl) + Vector(loc)
        out.append(tuple(v))
    # also the mid-points of the box faces (catches large boxes straddling a small exclusion zone)
    xs = [c[0] for c in out]
    ys = [c[1] for c in out]
    zs = [c[2] for c in out]
    cx, cy, cz = sum(xs) / 8, sum(ys) / 8, sum(zs) / 8
    for c in out[:]:
        out.append(((c[0] + cx) / 2, (c[1] + cy) / 2, (c[2] + cz) / 2))
    return out


def _signed_gap(bvh, p):
    """Distance from p to the surface if p lies outside (in front of) it, else 0."""
    loc, nrm, idx, d = bvh.find_nearest(Vector(p))
    if loc is None:
        return 0.0
    return d if (Vector(p) - loc).dot(nrm) > 0 else 0.0


def dress(target_obj, kit_blend_path=None, families=ALL_FAMILIES, density=1.0, seed=0, exclude_fn=None,
          scale=1.0, moss_cover=0.35, moss_thickness=(0.006, 0.026), lean_target=None, lean_amount=0.25,
          max_clusters=None, vine_count=None, drip_count=None, root_count=None, collection=None,
          moss_res=None, max_instanced_tris=150000, attract=None, verbose=True):
    """Attach vegetation to `target_obj` (see module docstring).  Returns a report dict."""
    t_start = time.time()
    s = float(scale)
    rng = np.random.default_rng(int(seed) * 7919 + 17)
    fams = set(families)
    protos = load_kit(kit_blend_path) if (fams - {"moss_shell", "roots"}) else {}
    surf = _surface(target_obj, s)
    bvh = surf["bvh"]
    tname = target_obj.name[:40]
    parent = collection or bpy.data.collections.new("CFCL_Veg_" + tname)
    if collection is None:
        bpy.context.scene.collection.children.link(parent)
    subs = {}
    for k in ("MossShell", "Clumps", "Hanging", "Roots"):
        c = bpy.data.collections.new(f"CFCL_Veg_{tname}_{k}")
        parent.children.link(c)
        subs[k] = c
    rep = {"collection": parent.name, "target": target_obj.name, "seed": seed, "scale": s, "density": density,
           "counts": {}, "instance_count": 0, "moss_faces": 0, "max_contact_gap_m": 0.0}
    gaps = []          # per-item max contact gap (m)
    foot = []          # footprint gaps for clumps
    ex = exclude_fn or (lambda p: False)
    budget = {"used": 0, "limited": False}
    B = float(max_instanced_tris) if max_instanced_tris else 1e18

    def fits(proto, frac):
        t = int(proto.get("cf_tris", 3000))
        if budget["used"] + t > B * frac:
            budget["limited"] = True
            return False
        return True

    # ---------------- feature (edge / crack) points
    co, vn, kap = surf["co"], surf["vn"], surf["kap"]
    rim = (surf["vmax"] > 0.55) & (surf["vmin"] < 0.22)
    lip = (surf["vmin"] < -0.3) & (surf["vmax"] > -0.05)
    crack = kap < -4.0 / s
    feat_pts = [co[i] for i in np.nonzero(rim | crack)[0]] + [c[0] for c in surf["creases"]]
    kdf = None
    if feat_pts:
        kdf = KDTree(len(feat_pts))
        for i, p in enumerate(feat_pts):
            kdf.insert(p, i)
        kdf.balance()

    # ---------------- moss shell
    if "moss_shell" in fams:
        ob, nf, mxg = _moss_shell(f"CFCL_Veg_{tname}_MossShell", surf, subs["MossShell"], s, moss_cover,
                                  moss_thickness, int(seed), exclude_fn, moss_res, kdf)
        rep["moss_faces"] = nf
        rep["moss_shell_max_offset_m"] = round(mxg, 4)
        if ob is not None:
            gaps.append(("moss_shell", mxg))

    # ---------------- clumps
    clump_fams = [f for f in ("cushions", "crimson", "ferns", "tufts") if f in fams and protos.get(f)]
    placed = []
    if clump_fams:
        tri, tn, area = surf["tri"], surf["tn"], surf["area"]
        upm = tn[:, 2] > 0.45
        area_up = float(area[upm].sum())
        if area_up > 1e-6:
            ncand = int(np.clip(area_up / (0.06 * s) ** 2, 300, 8000))
            pr = area * upm
            pr = pr / pr.sum()
            ti = rng.choice(len(tri), size=ncand, p=pr)
            r1, r2 = rng.random(ncand), rng.random(ncand)
            sq = np.sqrt(r1)
            w0, w1, w2 = 1 - sq, sq * (1 - r2), sq * r2
            T = tri[ti]
            C = co[T[:, 0]] * w0[:, None] + co[T[:, 1]] * w1[:, None] + co[T[:, 2]] * w2[:, None]
            Nc = vn[T[:, 0]] * w0[:, None] + vn[T[:, 1]] * w1[:, None] + vn[T[:, 2]] * w2[:, None]
            Nc /= np.maximum(np.linalg.norm(Nc, axis=1, keepdims=True), 1e-9)
            Kc = kap[T[:, 0]] * w0 + kap[T[:, 1]] * w1 + kap[T[:, 2]] * w2
            ok = (Nc[:, 2] > 0.4) & np.array([not ex(tuple(p)) for p in C])
            C, Nc, Kc = C[ok], Nc[ok], Kc[ok]
            fd = np.array([kdf.find(p)[2] if kdf else 9.0 for p in C])
            dirs = []
            for k in range(8):
                a = 2 * math.pi * k / 8
                dirs.append((math.cos(a) * math.cos(0.35), math.sin(a) * math.cos(0.35), math.sin(0.35)))
            occl = np.zeros(len(C))
            for i, (p, nn) in enumerate(zip(C, Nc)):
                o = Vector(p + nn * 0.02 * s)
                hits = 0
                for d in dirs:
                    if bvh.ray_cast(o, Vector(d), 1.2 * s)[0] is not None:
                        hits += 1
                occl[i] = hits / len(dirs)
            near = np.exp(-fd / (0.15 * s))
            conc = np.clip(-Kc * s / 5.0, 0, 1)
            attr_w = np.ones(len(C))
            for at in (attract or ()):
                ap, ar = np.asarray(at[:3], float), float(at[3]) if len(at) > 3 else 2.0
                attr_w += 2.5 * np.exp(-np.linalg.norm(C - ap, axis=1) / ar)
            score = 0.45 * near + 0.3 * occl + 0.15 * conc + 0.25 * rng.random(len(C))
            n_cl = max_clusters or int(np.clip(round(density * area_up / (1.1 * s * s)), 1, 400))
            spacing = 0.85 * s / math.sqrt(max(density, 0.05))
            centres = []
            for i in np.argsort(-score):
                if all(np.linalg.norm(C[i] - C[j]) > spacing for j in centres):
                    centres.append(i)
                    if len(centres) >= n_cl:
                        break
            kdc = KDTree(len(C))
            for i, p in enumerate(C):
                kdc.insert(p, i)
            kdc.balance()
            lean_t = np.asarray(lean_target, float) if lean_target is not None else None
            n_inst = 0
            for ci, cidx in enumerate(centres):
                w = np.array([FAM_W[f] * ((0.02 + 2.2 * max(occl[cidx] - 0.12, 0.0)) if f == "ferns" else 1.0)
                              * ((0.6 + 1.2 * near[cidx]) * attr_w[cidx] if f == "crimson" else 1.0)
                              * ((1.0 + 1.2 * (1.0 - occl[cidx])) if f == "cushions" else 1.0) for f in clump_fams])
                fam = clump_fams[int(rng.choice(len(clump_fams), p=w / w.sum()))]
                cs = rng.uniform(0.6, 1.4)
                k = int(rng.integers(3, 10))
                members = [(fam, True)] + [(fam, False)] * (k - 1)
                comp = [c for c in COMPANION[fam] if c in clump_fams]
                if comp:
                    members += [(comp[int(rng.integers(0, len(comp)))], False) for _ in range(int(rng.integers(0, 4)))]
                Rc = FAM_R[fam] * cs * s * (1.0 + 0.35 * math.sqrt(k))
                near_idx = [j for (_, j, d) in kdc.find_range(C[cidx], Rc * 1.6)]
                near_idx.sort(key=lambda j: np.linalg.norm(C[j] - C[cidx]) * (1.0 + (1.5 if fam == "crimson" else 0.6)
                                                                              * (1 - near[j])) + rng.random() * 0.05 * s)
                taken = []
                for mf, dom in members:
                    pl = protos[mf]
                    if dom:
                        cand = [cidx]
                        vi = len(pl) - 1 if cs > 1.1 else max(len(pl) - 2, 0)
                        msc = cs * s * rng.uniform(0.95, 1.12)
                    else:
                        cand = near_idx
                        vi = int(rng.integers(0, max(len(pl) - 1, 1)))
                        msc = cs * s * rng.uniform(0.55, 0.92)
                    proto = pl[vi]
                    if mf == "ferns" and dom and occl[cidx] < 0.12:
                        continue
                    if not fits(proto, 0.7):
                        proto = pl[0]
                        msc = min(msc, cs * s * 0.8)
                        if not fits(proto, 0.7):
                            continue
                    rmin = FAM_R[mf] * msc * 0.6
                    for j in cand:
                        p = C[j]
                        if mf == "ferns" and occl[j] < 0.12:
                            continue
                        if any(np.linalg.norm(p - q) < max(rmin, rr) for q, rr in taken):
                            continue
                        nn = Nc[j]
                        axis = _n(nn) if mf == "cushions" else _n(nn * 0.5 + Z * 0.5)
                        if lean_t is not None and mf in ("crimson", "ferns"):
                            h = lean_t - p
                            h[2] = 0
                            axis = _n(axis + _n(h) * lean_amount)
                        quat = _quat_to(axis) @ Quaternion((0, 0, 1), float(rng.uniform(0, 2 * math.pi)))
                        # footprint check: rays from around the base along -axis
                        dims = proto.get("cf_dims", [0.1, 0.1, 0.1])
                        sup = {"ferns": 0.22, "crimson": 0.22, "tufts": 0.3, "cushions": 0.42}[mf]
                        fp = min(float(proto.get("cf_footprint", 0.05)), 0.12 * max(dims[0], dims[1]))
                        rf = max(fp, sup * 0.5 * max(dims[0], dims[1])) * msc
                        rf = max(rf, 0.01 * s)
                        ax = Vector(axis)
                        t1 = ax.orthogonal().normalized()
                        t2 = ax.cross(t1)
                        worst = 0.0
                        for kk in range(6):
                            a = 2 * math.pi * kk / 6
                            o = Vector(p) + ax * 0.25 * s + (t1 * math.cos(a) + t2 * math.sin(a)) * rf
                            hit = bvh.ray_cast(o, -ax, 0.6 * s)
                            gap = (hit[3] - 0.25 * s) if hit[0] is not None else 0.35 * s
                            worst = max(worst, gap)
                        if worst > 0.10 * msc + 0.02 * s:
                            continue
                        head = 0.5 * float(dims[2]) * msc
                        if bvh.ray_cast(Vector(p) + ax * 0.01 * s, ax, head)[0] is not None:
                            continue
                        sink = 0.008 * s + float(np.clip(worst * 0.7, 0, 0.05 * msc))
                        loc = p - axis * sink
                        bb = _bbox_world(proto, loc, quat, msc)
                        if any(ex(c) for c in bb) or ex(tuple(loc)):
                            continue
                        ob = _place(proto, loc, quat, msc, subs["Clumps"], f"{proto.name}_{tname}_{n_inst:04d}")
                        budget["used"] += int(proto.get("cf_tris", 3000))
                        n_inst += 1
                        taken.append((p, FAM_R[mf] * msc * 0.55))
                        placed.append((ob, proto, msc, worst))
                        rep["counts"][mf] = rep["counts"].get(mf, 0) + 1
                        break
            rep["clusters"] = len(centres)
            if placed:
                fdp = [kdf.find(o.matrix_world.translation)[2] if kdf else 9.0 for o, _, _, _ in placed]
                rep["near_edge_frac"] = round(float(np.mean(np.array(fdp) < 0.15 * s)), 3)

    # ---------------- shelf fungi on steep sheltered faces
    if "fungi" in fams and protos.get("fungi"):
        tri, tn, area = surf["tri"], surf["tn"], surf["area"]
        st = np.abs(tn[:, 2]) < 0.3
        a_st = float(area[st].sum())
        nf_ = int(np.clip(round(density * a_st / (4.0 * s * s)), 0, 60))
        if nf_ > 0:
            pr = area * st
            pr = pr / pr.sum()
            got = 0
            pts_f = []
            for _ in range(nf_ * 8):
                if got >= nf_:
                    break
                ti = int(rng.choice(len(tri), p=pr))
                r1, r2 = rng.random(), rng.random()
                sq = math.sqrt(r1)
                p = co[tri[ti, 0]] * (1 - sq) + co[tri[ti, 1]] * sq * (1 - r2) + co[tri[ti, 2]] * sq * r2
                nh = np.array([tn[ti, 0], tn[ti, 1], 0.0])
                if np.linalg.norm(nh) < 0.5 or ex(tuple(p)) or any(np.linalg.norm(p - q) < 0.8 * s for q in pts_f):
                    continue
                nh = _n(nh)
                yaw = math.atan2(nh[1], nh[0]) - math.pi / 2
                quat = Quaternion((0, 0, 1), yaw)
                pl = protos["fungi"]
                proto = pl[int(rng.integers(0, len(pl)))]
                msc = s * rng.uniform(0.7, 1.3)
                loc = p - nh * 0.01 * s
                dz = float(proto.get("cf_dims", [0.2, 0.1, 0.3])[2]) * msc
                dx = float(proto.get("cf_dims", [0.2, 0.1, 0.3])[0]) * msc * 0.5
                tang = np.array([-nh[1], nh[0], 0.0])
                okw = True
                for off in (Z * dz, Z * dz * 0.5, tang * dx, -tang * dx, Z * dz + tang * dx, Z * dz - tang * dx):
                    o = Vector(p + off + nh * 0.06 * s)
                    hit = bvh.ray_cast(o, Vector(-nh), 0.14 * s)
                    if hit[0] is None:
                        okw = False
                        break
                if not okw:
                    continue
                if any(ex(c) for c in _bbox_world(proto, loc, quat, msc)) or not fits(proto, 1.0):
                    continue
                ob = _place(proto, loc, quat, msc, subs["Clumps"], f"{proto.name}_{tname}_f{got:03d}")
                budget["used"] += int(proto.get("cf_tris", 3000))
                placed.append((ob, proto, msc, 0.0))
                pts_f.append(p)
                got += 1
            rep["counts"]["fungi"] = got

    # ---------------- hanging: vines + drips from lips / rims
    hang_fams = [f for f in ("vines", "drips") if f in fams and protos.get(f)]
    if hang_fams:
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        scene = bpy.context.scene
        anchors = []
        for i in np.nonzero(lip | rim)[0]:
            hn = np.array([vn[i, 0], vn[i, 1], 0.0])
            if np.linalg.norm(hn) < 0.2:
                continue
            anchors.append((co[i], _n(hn), 1.0 if lip[i] else 0.55, bool(lip[i])))
        for p, nz_hi, nz_lo, nav in surf["creases"]:
            hn = np.array([nav[0], nav[1], 0.0])
            if np.linalg.norm(hn) > 0.2 and ((nz_lo < -0.3 and nz_hi > -0.05) or (nz_hi > 0.55 and nz_lo < 0.22)):
                anchors.append((p, _n(hn), 1.0 if nz_lo < -0.3 else 0.55, nz_lo < -0.3))
        order = sorted(range(len(anchors)), key=lambda i: -(anchors[i][2] + 0.6 * rng.random()))

        def drop(p, out):
            o = Vector(p + out * 0.03 * s - Z * 0.02 * s)
            r = scene.ray_cast(dg, o, Vector((0, 0, -1)), distance=12.0 * s)
            return r[1].z if r[0] else None, (o.z - r[1].z) if r[0] else 12.0 * s

        for fam in hang_fams:
            pl = protos[fam]
            lens = [float(o.get("cf_length", 1.0)) for o in pl]
            want = (vine_count if fam == "vines" else drip_count)
            n_lip = sum(1 for a in anchors if a[3]) * max(surf["el"], 0.02)
            n_rim = len(anchors) * max(surf["el"], 0.02)
            if want is None:
                want = int(np.clip(round(density * (n_rim / (5.0 * s) if fam == "vines" else n_lip / (4.0 * s))),
                                   0, 40 if fam == "vines" else 12))
            spacing = (1.3 if fam == "vines" else 0.45) * s
            done = []
            for i in order:
                if len(done) >= want:
                    break
                p, out, w, is_lip = anchors[i]
                if fam == "drips" and not is_lip:
                    continue
                if is_lip:
                    # real overhang only: the lip must protrude >= 6 cm*scale beyond the wall below it
                    # (rejects shallow joint grooves / chips that otherwise sprout rows of "hair")
                    hp = bvh.ray_cast(Vector(p - Z * 0.15 * s + out * 0.02 * s), Vector(-out), 0.5 * s)
                    if hp[0] is not None and hp[3] < 0.06 * s:
                        continue
                if any(np.linalg.norm(p - q) < spacing for q in done):
                    continue
                if ex(tuple(p)):
                    continue
                _, D = drop(p, out)
                avail = D - 0.05 * s
                best = None
                for vi in sorted(range(len(pl)), key=lambda j: -lens[j]):
                    L = lens[vi]
                    sc = min(1.25 * s, avail / max(L, 1e-3))
                    if sc >= 0.7 * s:
                        best = (vi, sc * rng.uniform(0.85, 1.0))
                        break
                if best is None:
                    continue
                vi, msc = best
                if fam == "vines" and pl[vi].get("cf_variant") == "C":
                    tang = np.array([-out[1], out[0], 0.0])
                    half = 0.8 * msc
                    ends_ok = all(bvh.find_nearest(Vector(p + tang * sg * half))[3] < 0.06 * s for sg in (-1, 1))
                    if not ends_ok:
                        alt = [j for j in range(len(pl)) if pl[j].get("cf_variant") != "C" and lens[j] * 0.7 * s <= avail]
                        if not alt:
                            continue
                        vi = alt[0]
                        msc = min(1.25 * s, avail / max(lens[vi], 1e-3)) * rng.uniform(0.85, 1.0)
                if fam == "drips" and len(pl) > 1:
                    vi = 0 if rng.random() < 0.7 else 1
                    msc = min(msc, s * rng.uniform(0.5, 0.85))
                proto = pl[vi]
                yaw = math.atan2(out[1], out[0]) - math.pi / 2
                quat = Quaternion((0, 0, 1), yaw)
                loc = p - out * 0.01 * s
                L = lens[vi] * msc
                if any(ex(tuple(loc - Z * L * f)) for f in (0.0, 0.5, 1.0)) or \
                        any(ex(c) for c in _bbox_world(proto, loc, quat, msc)):
                    continue
                if not fits(proto, 1.0):
                    break
                ob = _place(proto, loc, quat, msc, subs["Hanging"], f"{proto.name}_{tname}_{len(done):03d}")
                budget["used"] += int(proto.get("cf_tris", 3000))
                placed.append((ob, proto, msc, 0.0))
                done.append(p)
                gaps.append((fam, _signed_gap(bvh, loc)))
            rep["counts"][fam] = len(done)

    # ---------------- roots grown on the surface
    if "roots" in fams:
        rimpts = [co[i] for i in np.nonzero(rim)[0]] + [c[0] for c in surf["creases"] if c[1] > 0.55 and c[2] < 0.22]
        nroot = 0
        if rimpts:
            kdr = KDTree(len(rimpts))
            for i, p in enumerate(rimpts):
                kdr.insert(p, i)
            kdr.balance()
            want = root_count if root_count is not None else int(np.clip(round(density * len(rimpts) * max(surf["el"], 0.03)
                                                                                 / (3.0 * s)), 1, 25))
            tops = np.nonzero(vn[:, 2] > 0.6)[0]
            rng.shuffle(tops)
            starts = []
            for i in tops:
                if len(starts) >= want:
                    break
                p = co[i]
                rp, ri, rd = kdr.find(p)
                if not (0.12 * s < rd < 0.6 * s) or ex(tuple(p)):
                    continue
                if any(np.linalg.norm(p - q) < 1.0 * s for q in starts):
                    continue
                starts.append(p)
            mb = MB()
            centre_lines = []
            for k, p in enumerate(starts):
                rp = np.array(kdr.find(p)[0])
                d = rp - p
                d[2] = 0
                centre_lines += root_mesh(mb, bvh, p, _n(d), rng.uniform(1.0, 2.2) * s, rng.uniform(0.025, 0.06) * s,
                                          rng, 2, int(rng.integers(2, 4)), ex, seed=int(seed) * 100 + k)
                nroot += 1
            if mb.faces:
                ob = mb.to_object(f"CFCL_Veg_{tname}_Roots", [_mat("Root")], subs["Roots"])
                rep["root_tris"] = mb.tris()
                mx = 0.0
                for Cl in centre_lines:
                    for p in Cl[::2]:
                        mx = max(mx, _signed_gap(bvh, p))
                gaps.append(("roots", mx))
        rep["counts"]["roots"] = nroot

    # ---------------- contact test for instances
    inst_gaps = []
    for ob, proto, msc, worst in placed:
        o = ob.matrix_world.translation
        inst_gaps.append(_signed_gap(bvh, o))
        me = proto.data
        if "cf_zmin" in proto and ob.get("cf_family") not in ("vines", "drips", "fungi"):
            zmin = float(proto["cf_zmin"])
            n = len(me.vertices)
            cov = np.empty(n * 3, np.float32)
            me.vertices.foreach_get("co", cov)
            cov = cov.reshape(-1, 3)
            low = cov[cov[:, 2] < zmin + 0.02]
            mwp = np.array(ob.matrix_world)
            wp = low @ mwp[:3, :3].T + mwp[:3, 3]
            fg = [_signed_gap(bvh, q) for q in wp[:: max(1, len(wp) // 24)]]
            foot.append(max(fg) if fg else 0.0)
    if inst_gaps:
        gaps.append(("instances", max(inst_gaps)))
    rep["instance_count"] = len(placed)
    # moss shell offset (0.6-2.6 cm by design, edges tucked into the surface) is reported separately
    rep["max_contact_gap_m"] = round(max([g for k, g in gaps if k != "moss_shell"], default=0.0), 4)
    rep["contact_by_kind"] = {}
    for k, g in gaps:
        rep["contact_by_kind"][k] = round(max(rep["contact_by_kind"].get(k, 0.0), g), 4)
    if foot:
        rep["footprint_gap_p95_m"] = round(float(np.percentile(foot, 95)), 4)
        rep["footprint_gap_max_m"] = round(float(np.max(foot)), 4)
    tris = 0
    for ob, proto, msc, worst in placed:
        tris += int(proto.get("cf_tris", 0))
    rep["instanced_tris"] = tris
    rep["tri_budget"] = int(B) if max_instanced_tris else None
    rep["budget_limited"] = bool(budget["limited"])
    rep["time_s"] = round(time.time() - t_start, 2)
    if verbose:
        print("[cf_vegetation] dress", target_obj.name, rep, flush=True)
    return rep
