"""CFCL_Tools_Arches - broken classical-but-ancient arches/colonnades built with the ARCH GENERATOR extension.

Arch Generator (bl_ext.blender_org.arch_generator) is driven headless through its own code:
  * bpy.ops.mesh.arch_create() is run once to obtain the add-on's default ArchProperties,
  * its geometry builders are then called stone by stone with a props namespace:
      geometry.add_base (ATTIC / SQUARE / CIRCULAR bases), geometry.add_stambha_shaft (FLUTED / TUSCAN /
      COMPOUND shafts, cut into drums), geometry.add_capital (stepped / IONIC capitals),
      builders.build_3d_square_arch_mesh (the add-on's arch-ring sweep) for every voussoir of every
      archivolt ring, styles.build_roman_arch for round arches.
    The add-on's GOTHIC/LANCET profiles are sin-power curves with no true point, so pointed rings use a
    two-centred profile fed to the same sweep builder.
  * our own code then breaks and weathers them: chamfered arrises (bmesh bevel), planar spall chips,
    sheared fracture faces, missing voussoirs, toppled drums, collapsed spans, fallen stones on the ground,
    a mossy rubble apron.  Material: cf_materials AncientStone (+ Basalt/moss apron).
Usage: python lib/run_blender.py scripts/tools_arches.py --timeout 2400 -- [render 1/0]
"""
import sys, os, json, math, time, random
from types import SimpleNamespace
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, Euler, noise
import tools_common as T
import cf_render as R
import cf_materials as M

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = (argv[0] != "0") if argv else True
ASSET = "CFCL_Tools_Arches"
VER = T.next_version(ASSET)
RDIR = os.path.join(T.CL, "renders", "tools", "arches")
os.makedirs(RDIR, exist_ok=True)
LOG = {"asset": ASSET, "version": VER, "pieces": {}, "warnings": []}
t0 = time.time()

R.reset_scene()
T.enable("arch_generator")
AGB = sys.modules["bl_ext.blender_org.arch_generator.builders"]
AGG = sys.modules["bl_ext.blender_org.arch_generator.geometry"]
AGS = sys.modules["bl_ext.blender_org.arch_generator.styles"]
sc = bpy.context.scene
col = bpy.data.collections.new(ASSET)
sc.collection.children.link(col)

# ---------------------------------------------------------------- add-on defaults through its own operator
bpy.ops.mesh.arch_create()
_tmp = bpy.context.view_layer.objects.active
DEF = {p.identifier: getattr(_tmp.arch_props, p.identifier) for p in _tmp.arch_props.bl_rna.properties
       if p.identifier not in ("rna_type", "name")}
LOG["arch_create_test"] = {"verts": len(_tmp.data.vertices), "dims": [round(v, 2) for v in _tmp.dimensions]}
bpy.data.objects.remove(_tmp)


def props(base=None, **kw):
    d = dict(DEF) if base is None else dict(vars(base))
    d.update(kw)
    return SimpleNamespace(**d)


# ---------------------------------------------------------------- bmesh stone helpers
def bm_call(fn, *a):
    bm = bmesh.new()
    fn(bm, *a)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_xform(bm, mat):
    bmesh.ops.transform(bm, matrix=mat, verts=bm.verts)
    return bm


def bm_bounds(bm):
    co = np.array([v.co[:] for v in bm.verts])
    return co.min(0), co.max(0)


def prism(poly_xz, y0, y1):
    """Our own wall-infill stone: extrude a CCW (x,z) polygon along Y."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in poly_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in poly_xz]
    n = len(a)
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def fill_holes(bm):
    bnd = [e for e in bm.edges if e.is_boundary]
    if bnd:
        bmesh.ops.holes_fill(bm, edges=bnd, sides=0)


def cut(bm, co, no, rng=None, jag=0.0):
    """Remove the part of the stone on the +no side of the plane; cap; optionally jag the fracture face."""
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True, dist=1e-5)
    nf0 = set(bm.faces)
    fill_holes(bm)
    new = [f for f in bm.faces if f not in nf0]
    if jag > 0 and new:
        res = bmesh.ops.poke(bm, faces=new)
        nv = Vector(no).normalized()
        for v in res["verts"]:
            v.co += nv * (-jag * (0.4 + 0.6 * rng.random()))
        rim = {v for f in res["faces"] for v in f.verts if v not in res["verts"]}
        for v in rim:
            v.co += nv * (jag * 0.35 * (rng.random() - 0.5))
    return bm


def weather(bm, rng, chips=1, bevel=0.03, jitter=0.006):
    mn, mx = bm_bounds(bm)
    size = float(np.min(mx - mn))
    if size <= 1e-4:
        return bm
    off = max(0.01, min(bevel * size * 2.6, 0.075))
    sharp = [e for e in bm.edges if not e.is_boundary and len(e.link_faces) == 2 and e.calc_face_angle(0) > 0.7]
    if sharp:
        try:
            bmesh.ops.bevel(bm, geom=sharp, offset=off, offset_type="OFFSET", segments=2, profile=0.62,
                            affect="EDGES", clamp_overlap=True)
        except Exception:
            pass
    c = Vector(((mn + mx) / 2).tolist())
    for _ in range(chips):
        bm.verts.ensure_lookup_table()
        v = bm.verts[rng.randrange(len(bm.verts))]
        d = (v.co - c)
        if d.length < 1e-6:
            continue
        n = (d.normalized() + Vector((rng.uniform(-.4, .4), rng.uniform(-.4, .4), rng.uniform(-.4, .4)))).normalized()
        depth = size * rng.uniform(0.10, 0.24)
        far = max((vv.co - c).dot(n) for vv in bm.verts)
        cut(bm, c + n * (far - depth), n)
    for v in bm.verts:
        v.co += Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * jitter * size
    # settled: every stone sits a little out of true (rotation +-2.5 deg, scale +-3 %)
    mn, mx = bm_bounds(bm)
    c = Vector(((mn + mx) / 2).tolist())
    rot = Euler([math.radians(rng.uniform(-2.5, 2.5)) for _ in range(3)]).to_matrix().to_4x4()
    sc_ = Matrix.Diagonal((rng.uniform(0.97, 1.0), rng.uniform(0.97, 1.0), rng.uniform(0.97, 1.0), 1.0))
    bm_xform(bm, Matrix.Translation(c) @ rot @ sc_ @ Matrix.Translation(-c))
    return bm


def fallen(bm, rng, at, lie_axis="x", sink=0.2, yaw=None, split=0.5):
    """Lay a stone on the ground at `at` (x,y): often snapped in two first, then rotated onto its side and
    settled into the ground."""
    mn, mx = bm_bounds(bm)
    if rng.random() < split:
        c0 = Vector(((mn + mx) / 2).tolist())
        ax = int(np.argmax(mx - mn))
        nrm = Vector([1.0 if i == ax else rng.uniform(-0.35, 0.35) for i in range(3)])
        cut(bm, c0 + nrm.normalized() * rng.uniform(-0.1, 0.15) * float((mx - mn)[ax]), nrm, rng, jag=0.05 * float((mx - mn).min()))
        mn, mx = bm_bounds(bm)
    c = Vector(((mn + mx) / 2).tolist())
    bm_xform(bm, Matrix.Translation(-c))
    if lie_axis == "x":
        r = Euler((0, math.radians(90 + rng.uniform(-12, 12)), 0))
    elif lie_axis == "y":
        r = Euler((math.radians(90 + rng.uniform(-12, 12)), 0, 0))
    else:
        r = Euler((math.radians(rng.uniform(-14, 14)), math.radians(rng.uniform(-14, 14)), 0))
    bm_xform(bm, r.to_matrix().to_4x4())
    bm_xform(bm, Matrix.Rotation(math.radians(yaw if yaw is not None else rng.uniform(0, 360)), 4, "Z"))
    mn, mx = bm_bounds(bm)
    bm_xform(bm, Matrix.Translation((at[0], at[1], -mn[2] - sink * (mx[2] - mn[2]))))
    return bm


# ---------------------------------------------------------------- arch profiles + voussoirs
def pointed_profile(w, sz, k=1.0, n=64):
    """True two-centred pointed arch (k = radius / span; 1.0 = equilateral)."""
    Rr = k * w
    cl = -w / 2 + Rr
    thc = math.acos((0 - cl) / Rr)
    left = [(cl + Rr * math.cos(a), sz + Rr * math.sin(a)) for a in np.linspace(math.pi, thc, n // 2 + 1)]
    right = [(-x, z) for x, z in reversed(left[:-1])]
    return left + right


def offset_profile(pts, d):
    P = np.array(pts, float)
    T_ = np.gradient(P, axis=0)
    T_ /= np.linalg.norm(T_, axis=1, keepdims=True)
    N = np.stack([-T_[:, 1], T_[:, 0]], 1)
    return [tuple(p) for p in P + N * d]


def resample(pts, s0, s1, n):
    P = np.array(pts, float)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    out = []
    for t in np.linspace(s0, s1, n):
        t = min(max(t, 0), L)
        out.append((float(np.interp(t, s, P[:, 0])), float(np.interp(t, s, P[:, 1]))))
    return out, L


def ring_voussoirs(profile, off, thick, depth, count, gap=0.025, y=0.0):
    """Archivolt ring = `count` voussoirs swept with the add-on's build_3d_square_arch_mesh."""
    base = offset_profile(profile, off) if off else profile
    _, L = resample(base, 0, 0, 2)
    out = []
    for i in range(count):
        a0, a1 = L * i / count + gap / 2, L * (i + 1) / count - gap / 2
        pts, _ = resample(base, a0, a1, 6)
        bm = bm_call(AGB.build_3d_square_arch_mesh, pts, thick, depth)
        if y:
            bm_xform(bm, Matrix.Translation((0, y, 0)))
        out.append({"bm": bm, "t": (i + 0.5) / count, "mid": pts[len(pts) // 2]})
    return out


def extrados_fn(profile, total):
    ext = offset_profile(profile, total)
    xs = np.array([p[0] for p in ext]); zs = np.array([p[1] for p in ext])
    order = np.argsort(xs)
    xs, zs = xs[order], zs[order]
    def f(x):
        x = np.asarray(x, float)
        z = np.interp(x, xs, zs, left=-1e9, right=-1e9)
        return z
    return f, xs.min(), xs.max()


def column_stones(p, cx, rng, drums=4, cy=0.0, twist=8.0):
    """Base + drums + capital from the add-on builders (pillar = base, shaft, capital)."""
    st = []
    base = bm_call(AGG.add_base, cx, p)
    st.append({"bm": base, "kind": "base", "z": 0.0})
    z0, z1 = p.base_height * 0.9, p.stambha_height - p.capital_height * 0.95
    hs = np.array([1 + rng.uniform(-0.12, 0.12) for _ in range(drums)])
    hs = hs / hs.sum() * (z1 - z0)
    z = z0
    for i, h in enumerate(hs):
        q = props(p, stambha_height=float(h) - 0.012)
        bm = bm_call(AGG.add_stambha_shaft, 0.0, q)
        bm_xform(bm, Matrix.Rotation(math.radians(rng.uniform(-twist, twist)), 4, "Z"))
        bm_xform(bm, Matrix.Translation((cx + rng.uniform(-0.01, 0.01), cy + rng.uniform(-0.01, 0.01), z + 0.006)))
        st.append({"bm": bm, "kind": "drum", "z": z, "h": float(h), "i": i})
        z += float(h)
    cap = bm_call(AGG.add_capital, cx, p)
    st.append({"bm": cap, "kind": "capital", "z": z})
    return st


def courses(x0, x1, z0, z1, ext_f, y0, y1, rng, ch=0.42, blen=(0.55, 1.05), ruin=None):
    """Ashlar wall infill above an arch extrados (each stone's bottom follows the extrados)."""
    out = []
    z = z0
    k = 0
    prev = None                                        # kept intervals of the course below
    while z < z1 - 0.05:
        cur = []
        zt = min(z + ch * rng.uniform(0.9, 1.1), z1)
        x = x0 - (rng.uniform(0.0, 0.5) if k % 2 else 0.0)
        while x < x1 - 0.05:
            xe = min(x + rng.uniform(*blen), x1)
            xa = max(x, x0)
            xs = np.linspace(xa, xe, 7)
            bot = np.maximum(z, ext_f(xs) + 0.02)
            if ruin is not None and zt > ruin((xa + xe) / 2):
                out.append({"removed": True, "x": (xa + xe) / 2, "z": z, "w": xe - xa, "h": zt - z})
                x = xe
                continue
            keep = bot < zt - 0.06
            on_arch = bool(np.any(ext_f(xs) + 0.02 >= z - 0.03))
            sup = 0.0 if prev is not None else (xe - xa)
            if prev is not None:
                for a0, a1 in prev:
                    sup += max(0.0, min(a1, xe) - max(a0, xa))
            if not on_arch and sup < 0.5 * (xe - xa):
                out.append({"removed": True, "x": (xa + xe) / 2, "z": z, "w": xe - xa, "h": zt - z})
                x = xe
                continue
            if keep.sum() >= 2:
                cur.append((xa, xe))
                idx = np.nonzero(keep)[0]
                xs2, b2 = xs[idx], bot[idx]
                poly = [(float(xs2[0]), float(zt))] + [(float(a), float(b)) for a, b in zip(xs2, b2)][::1]
                poly = [(float(xs2[0]), float(b2[0]))] + [(float(a), float(b)) for a, b in zip(xs2[1:], b2[1:])] + \
                       [(float(xs2[-1]), float(zt)), (float(xs2[0]), float(zt))]
                g = 0.012
                poly = [(px + (g if px <= xs2[0] + 1e-6 else (-g if px >= xs2[-1] - 1e-6 else 0)), pz) for px, pz in poly]
                bm = prism(poly, y0 + rng.uniform(-0.01, 0.01), y1 + rng.uniform(-0.01, 0.01))
                out.append({"bm": bm, "x": (xa + xe) / 2, "z": z})
            x = xe
        z = zt + 0.012
        k += 1
        prev = cur
    return out


def rubble_apron(rx, ry, rng, cx=0.0, cy=0.0, h=0.55, sink=0.3):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    s = rng.random() * 50
    for v in bm.verts:
        p = v.co.copy()
        n = noise.noise(p * 1.7 + Vector((s, 0, 0))) + 0.5 * noise.noise(p * 5.3 + Vector((0, s, 0)))
        v.co = Vector((p.x * rx * (1 + 0.25 * n), p.y * ry * (1 + 0.25 * n), p.z * h * (1 + 0.6 * noise.noise(p * 3.1 + Vector((0, s, 0))))))
        v.co += Vector((cx, cy, -sink * h * 2))
    return bm


def tilt_sink(stones, pivot, rx=0.0, ry=0.0, rz=0.0, sink=0.0):
    """E33-style subsidence: the standing structure leans about a ground pivot and sinks into the plaza."""
    Mx = Matrix.Translation((0, 0, -sink)) @ Matrix.Translation(pivot) @         Euler((math.radians(rx), math.radians(ry), math.radians(rz))).to_matrix().to_4x4() @ Matrix.Translation(-Vector(pivot))
    for s in stones:
        if "bm" in s and not s.get("removed") and not s.get("fall"):
            bm_xform(s["bm"], Mx)


def bury(stones, zc=-0.3):
    """Delete what the sinking pushed under the ground (saves triangles, no hidden geometry)."""
    for s in stones:
        if "bm" not in s or s.get("removed") or s.get("fall"):
            continue
        mn, mx = bm_bounds(s["bm"])
        if mx[2] < zc:
            s["removed"] = True
        elif mn[2] < zc:
            cut(s["bm"], (0, 0, zc), (0, 0, -1))


# ---------------------------------------------------------------- assembly -> object
def build_object(name, stones, apron=None, mound_mat=True):
    bm_all = bmesh.new()
    me_tmp = bpy.data.meshes.new("tmp")
    n_stone = 0
    for s in stones:
        if s.get("removed") or "bm" not in s:
            continue
        s["bm"].to_mesh(me_tmp)
        bm_all.from_mesh(me_tmp)
        n_stone += 1
    stone_faces = len(bm_all.faces)
    if apron is not None:
        apron.to_mesh(me_tmp)
        bm_all.from_mesh(me_tmp)
        bm_all.faces.ensure_lookup_table()
        for i in range(stone_faces, len(bm_all.faces)):
            bm_all.faces[i].material_index = 1
    bpy.data.meshes.remove(me_tmp)
    me = bpy.data.meshes.new(name)
    bm_all.to_mesh(me)
    bm_all.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(38))
    except Exception:
        pass
    tris = T.tri_count([ob])
    if tris > 15500:                                   # ruin-piece budget (common brief: <= 15k)
        dm = ob.modifiers.new("Budget", "DECIMATE")
        dm.decimate_type = "COLLAPSE"
        dm.ratio = 15000.0 / tris
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=dm.name)
        ob["cfcl_decimated_from"] = tris
    M.assign(ob, "AncientStone", curvature=True)
    M.assign(ob, "Basalt", slot=1, moss=0.8)
    ob["cfcl_stones"] = n_stone
    return ob


def wthr(stones, rng, chips=(1, 3)):
    for s in stones:
        if "bm" in s and not s.get("removed") and not s.get("noweather"):
            weather(s["bm"], rng, chips=rng.randint(*chips))
    return stones


# =========================================================================================== PIECE A: Gothic portal
def piece_portal(seed=11):
    """Recessed, ribbed pointed portal (E33 Sirene ribbed-tunnel-arch logic, no carving/emblems): 5 stepped
    archivolt rings, each on its own nook colonnette; right side collapsed; the whole leans and is half-sunk."""
    rng = random.Random(seed)
    W, H_P, NRING = 2.6, 3.6, 5
    BACK = 0.8
    stones, rings, Rt_all = [], [], []
    prof = pointed_profile(W, H_P, k=1.0, n=72)
    keep = [0.52, 0.47, 0.44, 0.40, 0.46]
    for k in range(NRING):
        off, th = k * 0.25, 0.23
        dep = 0.95 + 0.17 * k
        yc = BACK - dep / 2
        cp = props(stambha_width=0.22, stambha_depth=0.22, stambha_height=H_P, pillar_style="ROUNDED", trim_resolution=12,
                   base_style="CIRCULAR", base_step_count=2, base_width=0.36, base_depth=0.36, base_height=0.32,
                   capital_style="CIRCULAR", capital_step_count=2, capital_width=0.34, capital_depth=0.34, capital_height=0.22)
        for side in (-1, 1):
            cx = side * (W / 2 + off + th / 2)
            cs = column_stones(cp, 0.0, rng, drums=3, twist=0)
            for st in cs:
                bm_xform(st["bm"], Matrix.Translation((cx, yc, 0)))
                st["ring"] = k
            if side == 1:
                brk = 1 if k in (0, 2, 3) else 0
                for st in cs:
                    if st["kind"] == "drum" and st["i"] == brk:
                        cut(st["bm"], (cx, yc, st["z"] + st["h"] * rng.uniform(0.35, 0.7)), (rng.uniform(-.5, .5), 0.2, 1.0), rng, jag=0.05)
                        st["noweather"] = True
                    elif st["kind"] == "capital" or (st["kind"] == "drum" and st["i"] > brk):
                        st["fall"] = True
                Rt_all += cs
            stones += cs
        ring = ring_voussoirs(prof, off, th, dep, 13 + 2 * k, y=yc)
        for v in ring:
            if v["t"] > keep[k]:
                v["fall"] = True
            elif v["t"] > keep[k] - 0.07:
                mn, mx = bm_bounds(v["bm"])
                piv = Vector((mn[0], 0, mn[2]))
                bm_xform(v["bm"], Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-6), 4, "Y") @ Matrix.Translation(-piv))
        rings += ring
    outer = (NRING - 1) * 0.25 + 0.23
    half = W / 2 + outer + 0.35
    pp = props(stambha_width=0.75, stambha_depth=1.0, stambha_height=H_P, pillar_style="FLAT", base_style="SQUARE",
               base_step_count=2, base_width=0.95, base_depth=1.15, base_height=0.45, capital_style="SQUARE",
               capital_step_count=2, capital_width=0.9, capital_depth=1.1, capital_height=0.3)
    for side in (-1, 1):
        cs = column_stones(pp, 0.0, rng, drums=4, twist=1.5)
        for st in cs:
            bm_xform(st["bm"], Matrix.Translation((side * half, BACK - 0.6, 0)))
        if side == 1:
            for st in cs:
                if st["kind"] == "drum" and st["i"] == 3:
                    cut(st["bm"], (half, BACK - 0.6, st["z"] + st["h"] * 0.55), (0.5, -0.2, 1.0), rng, jag=0.08)
                    st["noweather"] = True
                elif st["kind"] == "capital":
                    st["fall"] = True
            Rt_all += cs
        stones += cs
    ext, ex0, ex1 = extrados_fn(prof, outer + 0.02)
    ruin = lambda x: 7.0 - 1.25 * max(0.0, x + 0.5) - 0.35 * math.sin(x * 3.1) if x < -0.25 else -1.0
    wall = courses(-half - 0.37, half + 0.37, H_P, 7.0, ext, BACK - 1.0, BACK, rng, ruin=ruin)
    stones += rings + [w for w in wall if not w.get("removed")]
    wthr(stones, rng)
    tilt_sink(stones, (half, 0, 0), rx=-4.5, ry=8.0, sink=1.05)     # leans toward its collapsed side, half-sunk
    bury(stones)
    for st in Rt_all:
        if st.get("fall"):
            fallen(st["bm"], rng, (half + 0.6 + rng.uniform(0, 2.6), rng.uniform(-1.8, 1.0)), lie_axis="x")
            st["fall"] = False
    falls = [v for v in rings if v.get("fall")]
    rng.shuffle(falls)
    for v in falls[:12]:
        fallen(v["bm"], rng, (rng.uniform(-0.2, 3.6), rng.uniform(-2.4, 1.6)), lie_axis="flat")
        v["fall"] = False
    for v in falls[12:]:
        v["removed"] = True
    for w in [w for w in wall if w.get("removed")][:6]:
        bm = prism([(-w["w"] / 2, 0), (w["w"] / 2, 0), (w["w"] / 2, w["h"]), (-w["w"] / 2, w["h"])], -0.45, 0.45)
        weather(bm, rng, chips=2)
        fallen(bm, rng, (rng.uniform(0.3, 3.6), rng.uniform(-2.2, 1.4)), lie_axis="flat")
        stones.append({"bm": bm})
    stones = [s for s in stones if not s.get("fall")]
    apron = rubble_apron(3.8, 2.1, rng, cx=0.9, cy=-0.1)
    return build_object("CFCL_ToolArch_GothicPortal", stones, apron)


# =========================================================================================== PIECE B: Roman arcade
def piece_arcade(seed=23):
    rng = random.Random(seed)
    W, H_C, BAYS = 2.3, 3.6, 3
    p = props(stambha_width=0.62, stambha_depth=0.62, stambha_height=H_C, pillar_style="ROUNDED",
              pillar_entasis_bulge=0.0, trim_resolution=16, base_style="PADMA", padma_petals=10, padma_depth=0.18,
              base_width=0.86, base_depth=0.86, base_height=0.5, capital_style="AMALAKA", capital_width=0.78,
              capital_depth=0.78, capital_height=0.42, width=W, depth=0.8, arch_segments=48)
    pitch = W + 0.62
    xs = [(-BAYS / 2 + i) * pitch for i in range(BAYS + 1)]
    stones = []
    cols = []
    for i, x in enumerate(xs):
        cs = column_stones(p, x, rng, drums=3, twist=4)
        cols.append(cs)
    # rightmost column toppled entirely (base stays), drums roll out to +x/front
    for s in cols[-1]:
        if s["kind"] != "base":
            s["fall"] = True
    # column 3 (index 2) snapped on its top drum
    for s in cols[2]:
        if s["kind"] == "drum" and s["i"] == 2:
            cut(s["bm"], (xs[2], 0, s["z"] + s["h"] * 0.5), (-0.5, 0.25, 1.0), rng, jag=0.06)
            s["noweather"] = True
        if s["kind"] == "capital":
            s["fall"] = True
    for cs in cols:
        stones += cs
    allring = []
    for b in range(BAYS):
        cx = (xs[b] + xs[b + 1]) / 2
        prof = [(x + cx, z) for x, z in AGS.build_roman_arch(W - 0.5 + 0.5, W / 2, H_C, 48)]
        prof = [(x, z) for x, z in AGS.build_roman_arch(W, W / 2, H_C, 48)]
        prof = [(x + cx, z) for x, z in prof]
        r1 = ring_voussoirs(prof, 0.0, 0.26, 0.86, 11)
        r2 = ring_voussoirs(prof, 0.27, 0.16, 0.72, 13, y=0.05)
        r1 += ring_voussoirs(prof, 0.44, 0.10, 0.98, 11)
        for v in r1 + r2:
            v["bay"] = b
            if b == 2:
                v["fall"] = True                       # third bay collapsed with its column
            if b == 1 and v["t"] > 0.36:
                v["fall"] = True                       # crown + the half over the snapped column fell
        # neighbours of the gap slipped
        for v in r1:
            if b == 1 and (0.27 < v["t"] <= 0.36 or 0.66 <= v["t"] < 0.75):
                bm_xform(v["bm"], Matrix.Translation((0, 0, -0.07)))
        allring += r1 + r2
    stones += allring
    # attic course above bays 1-2 only, broken top
    ext_fs = []
    for b in range(BAYS):
        cx = (xs[b] + xs[b + 1]) / 2
        prof = [(x + cx, z) for x, z in AGS.build_roman_arch(W, W / 2, H_C, 48)]
        ext_fs.append(extrados_fn(prof, 0.53)[0])
    ext = lambda x: np.max([f(x) for f in ext_fs], axis=0)
    ruin = lambda x: 5.25 - 0.55 * max(0.0, x - xs[0]) + 0.25 * math.sin(x * 2.3) if x < xs[1] + 0.35 else -1.0
    wall = courses(xs[0] - 0.42, xs[2] + 0.2, H_C, 5.3, ext, -0.3, 0.3, rng, ch=0.4, ruin=ruin)
    stones += [w for w in wall if not w.get("removed")]
    wthr(stones, rng)
    tilt_sink(stones, (xs[0], 0, 0), rx=6.5, ry=-4.0, sink=0.85)
    bury(stones)
    k = 0
    for s in cols[-1] + cols[2]:
        if s.get("fall"):
            fallen(s["bm"], rng, (xs[-1] - 0.4 + 0.85 * k + rng.uniform(-0.2, 0.2), -1.0 - 0.45 * k + rng.uniform(-0.3, 0.3)),
                   lie_axis="x", yaw=rng.uniform(-35, -10))
            s["fall"] = False
            k += 1
    falls = [v for v in allring if v.get("fall")]
    rng.shuffle(falls)
    for v in falls[:12]:
        fallen(v["bm"], rng, (rng.uniform(xs[1], xs[-1] + 1.5), rng.uniform(-2.4, 1.6)), lie_axis="flat")
        v["fall"] = False
    for v in falls[12:]:
        v["removed"] = True
    stones = [s for s in stones if not s.get("fall")]
    apron = rubble_apron(5.6, 2.2, rng, cx=0.6, cy=-0.3)
    return build_object("CFCL_ToolArch_RomanArcade", stones, apron)


# =========================================================================================== PIECE C: half arch / springer pier
def piece_halfarch(seed=37):
    rng = random.Random(seed)
    W, H_P = 3.6, 4.4
    p = props(stambha_width=1.25, stambha_depth=1.2, stambha_height=H_P, pillar_style="FLAT",
              trim_resolution=8, base_style="SQUARE", base_step_count=2, base_width=1.7, base_depth=1.6,
              base_height=0.7, capital_style="SQUARE", capital_step_count=2, capital_width=1.65, capital_depth=1.5,
              capital_height=0.5, width=W, depth=1.2)
    stones = []
    px = -W / 2 - 0.62
    stones += column_stones(p, px, rng, drums=3, twist=2)
    prof = pointed_profile(W, H_P, k=1.15, n=80)
    r1 = ring_voussoirs(prof, 0.0, 0.62, 1.2, 12)
    r2 = ring_voussoirs(prof, 0.63, 0.34, 0.98, 14, y=0.06)
    r3 = ring_voussoirs(prof, 0.98, 0.16, 1.34, 11)
    for ring, keep in ((r1, 0.40), (r2, 0.36), (r3, 0.30)):
        for v in ring:
            if v["t"] > keep:
                v["fall"] = True
        stones += ring
    ext, _, _ = extrados_fn(prof, 1.15)
    # tall buttress wall over the pier, ragged stepped top falling off toward the broken span
    ruin = lambda x: 7.7 - 1.9 * max(0.0, x - px - 0.3) + 0.3 * math.sin(x * 4.0)
    wall = courses(px - 0.65, px + 2.1, H_P, 7.9, ext, -0.5, 0.5, rng, ch=0.62, blen=(0.8, 1.4), ruin=ruin)
    stones += [w for w in wall if not w.get("removed")]
    wthr(stones, rng)
    tilt_sink(stones, (px, 0, 0), rx=-5.0, ry=-12.0, sink=1.25)      # the orphaned pier leans away from its lost span
    bury(stones)
    falls = [s for s in stones if s.get("fall")]
    for i, v in enumerate(falls[:14]):
        fallen(v["bm"], rng, (rng.uniform(-0.6, 3.6), rng.uniform(-2.4, 2.0)), lie_axis="flat")
        v["fall"] = False
    for v in falls[14:]:
        v["removed"] = True
    stones = [s for s in stones if not s.get("fall")]
    apron = rubble_apron(3.3, 2.3, rng, cx=0.3, cy=-0.2)
    return build_object("CFCL_ToolArch_HalfArch", stones, apron)


# =========================================================================================== PIECE D: fluted colonnade
def piece_colonnade(seed=51):
    rng = random.Random(seed)
    H_C, SP = 5.0, 2.2
    p = props(stambha_width=0.78, stambha_depth=0.78, stambha_height=H_C, pillar_style="SOLOMONIC", flute_count=6,
              flute_depth=0.16, pillar_solomonic_twists=0.55, trim_resolution=14, base_style="PADMA", padma_petals=10,
              padma_depth=0.2, base_width=1.05, base_depth=1.05, base_height=0.6, capital_style="AMALAKA",
              capital_width=0.95, capital_depth=0.95, capital_height=0.5, width=SP, depth=0.8)
    xs = [(-1.5 + i) * SP for i in range(4)]
    cols = [column_stones(p, x, rng, drums=3, twist=25) for x in xs]
    stones = []
    for s in cols[2]:                                   # third column sheared at its 2nd drum
        if s["kind"] == "drum" and s["i"] == 1:
            cut(s["bm"], (xs[2], 0, s["z"] + s["h"] * 0.6), (0.3, -0.5, 1.0), rng, jag=0.07)
            s["noweather"] = True
        if (s["kind"] == "drum" and s["i"] >= 2) or s["kind"] == "capital":
            s["fall"] = True
    for s in cols[3]:                                   # fourth column toppled (base remains)
        if s["kind"] != "base":
            s["fall"] = True
    for cs in cols:
        stones += cs
    # architrave: one block still spans columns 1-2, the second lies broken against column 3's base
    zt = H_C
    a1 = bm_call(AGG.add_box, xs[0] - 0.55, xs[1] + 0.55, -0.45, 0.45, zt, zt + 0.62)
    cut(a1, (xs[1] + 0.2, 0, zt + 0.62), (0.7, 0.0, 0.7), rng, jag=0.1)       # broken end of the lintel
    stones.append({"bm": a1})
    a2 = bm_call(AGG.add_box, -1.1, 1.1, -0.38, 0.38, 0.0, 0.52)
    cut(a2, (0.25, 0, 0.0), (1.0, 0.1, 0.25), rng, jag=0.08)
    stones.append({"bm": a2, "fallen_arch": True})
    wthr(stones, rng)
    grp12 = cols[0] + cols[1] + [st for st in stones if st.get("bm") is a1]
    tilt_sink(grp12, (xs[0], 0, 0), rx=4.0, ry=-7.0, sink=0.75)      # columns 1-2 + lintel lean together
    tilt_sink(cols[2], (xs[2], 0, 0), rx=-9.0, ry=6.0, sink=0.9)     # the snapped column leans the other way
    tilt_sink(cols[3], (xs[3], 0, 0), sink=0.35)
    bury(stones)
    for s in stones:
        if s.get("fallen_arch"):
            mn, mx = bm_bounds(s["bm"])
            bm_xform(s["bm"], Matrix.Translation(Vector((-(mn[0] + mx[0]) / 2, 0, 0))))
            bm_xform(s["bm"], Matrix.Rotation(math.radians(16), 4, "Y"))
            bm_xform(s["bm"], Matrix.Rotation(math.radians(24), 4, "Z"))
            mn, mx = bm_bounds(s["bm"])
            bm_xform(s["bm"], Matrix.Translation((xs[2] - 1.0, -0.9, -mn[2] - 0.05)))
    k = 0
    for s in cols[3] + cols[2]:
        if s.get("fall"):
            fallen(s["bm"], rng, (xs[3] + 0.4 + 0.75 * k, 0.6 + 0.55 * k + rng.uniform(-0.2, 0.2)), lie_axis="x",
                   yaw=rng.uniform(20, 50))
            s["fall"] = False
            k += 1
    stones = [s for s in stones if not s.get("fall")]
    apron = rubble_apron(4.4, 1.8, rng, cx=0.6, cy=0.2)
    return build_object("CFCL_ToolArch_Colonnade", stones, apron)


pieces = []
for fn in (piece_portal, piece_arcade, piece_halfarch, piece_colonnade):
    t1 = time.time()
    try:
        ob = fn()
        pieces.append(ob)
        mn, mx = T.obj_bounds([ob])
        LOG["pieces"][ob.name] = {"tris": T.tri_count([ob]), "stones": ob["cfcl_stones"], "bounds_env": [mn, mx],
                                  "height_env": round(mx[2], 2), "s": round(time.time() - t1, 1)}
        print("[arch] built", ob.name, LOG["pieces"][ob.name], flush=True)
    except Exception as e:
        import traceback; traceback.print_exc()
        LOG["warnings"].append(f"{fn.__name__}: {e!r}")

# ---------------------------------------------------------------- placements (env) + ground + rules
PLACE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools_arches_layout.json")))
ground = T.load_ground()
ctx_col = bpy.data.collections.new("TOOLS_Context"); sc.collection.children.link(ctx_col)
import cf_integrate as I
for a in ("CFCL_Terrain_Ribs", "CFCL_Arch_RuinsKit", "CFCL_Hero_Skull", "CFCL_Hero_Hand"):
    try:
        I.append_asset(os.path.join(T.CL, "assets", a), ctx_col, 1.0, [])
    except Exception as e:
        LOG["warnings"].append(f"context {a}: {e}")
from mathutils.bvhtree import BVHTree


def world_bvh(o):
    """BVH in WORLD (env) space (BVHTree.FromObject is object-local)."""
    dg = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(dg)
    me = oe.to_mesh()
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    Mw = np.array(o.matrix_world); co = co @ Mw[:3, :3].T + Mw[:3, 3]
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("vertices", tri)
    oe.to_mesh_clear()
    return BVHTree.FromPolygons(co.tolist(), tri.reshape(-1, 3).tolist(), all_triangles=True)


IGNORE = ("Ruin_SkullSeat_Wall", "Ruin_LeftFlank_WallLow", "Ruin_RightFlank_ColumnStanding")
ctx_bvh = []
for o in list(ctx_col.all_objects):
    if o.type == "MESH" and not o.hide_render and o.name not in IGNORE:
        try:
            ctx_bvh.append((o.name, world_bvh(o)))
        except Exception:
            pass


def collides(ob):
    b = world_bvh(ob)
    return [n for n, cb in ctx_bvh if b.overlap(cb)]


ctx_boxes = []
for o in list(ctx_col.all_objects):
    if o.type == "MESH" and not o.hide_render:
        mn, mx = R.bounds([o])
        ctx_boxes.append((o.name, mn, mx))

placements = []
LOG["placements"] = {}
by = {o.name: o for o in pieces}
for pl in PLACE["placements"]:
    src = by.get(pl["source"])
    if src is None:
        continue
    x, y = pl["xy"]
    s = pl.get("scale", 1.0)
    mirror = pl.get("mirror", False)
    base_yaw = math.degrees(math.atan2(-x, y)) + pl.get("yaw_offset", 0.0)   # local -Y (front) faces the board
    mn, mx = R.bounds([src])
    s = pl.get("scale", 1.0)
    mirror = pl.get("mirror", False)
    best = None
    # radial search around the preferred spot (nearest first): yaw offsets x positions within 5 env
    cands = []
    for gx in np.arange(-5.0, 5.01, 0.8):
        for gy in np.arange(-5.0, 5.01, 0.8):
            if gx * gx + gy * gy <= 25.0:
                cands.append((gx * gx + gy * gy, float(gx), float(gy)))
    cands.sort()
    tried = 0
    for _, gx, gy in cands:
        for dyaw in (0, 20, -20, 40, -40, 60, -60):
            tried += 1
            px_, py_ = x + gx, y + gy
            yaw_c = math.degrees(math.atan2(-px_, py_)) + pl.get("yaw_offset", 0.0) + dyaw
            ob2 = src.copy(); col.objects.link(ob2)
            gz0 = T.ground_z(ground, px_, py_)[0]
            if gz0 is None:
                bpy.data.objects.remove(ob2)
                break
            ob2.location = (px_, py_, gz0); ob2.rotation_euler = (0, 0, math.radians(yaw_c))
            ob2.scale = (-s if mirror else s, s, s)
            bpy.context.view_layer.update()
            chk0 = T.placement_check(T.world_verts_env([ob2], 1500))
            ok = (chk0["in_band_frac"] == 0 and chk0["eclipse_screen_gap_in_radii"] > 1.5 and chk0["min_r_env"] >= T.DAIS_R)
            hit = collides(ob2) if ok else ["skip"]
            bpy.data.objects.remove(ob2)
            if ok and not hit:
                best = (1.0, dyaw, gy, gx)
                break
        if best:
            break
    pl["search_tried"] = tried
    if best is None:
        LOG["warnings"].append(f"{pl['name']}: could not clear the centre band automatically")
        best = (1.0, 0, 0.0, 0.0)
    x = x + best[3]
    y = y + best[2]
    yaw = math.degrees(math.atan2(-x, y)) + pl.get("yaw_offset", 0.0) + best[1]
    pl["auto"] = {"dx": best[3], "dy": best[2], "dyaw": best[1], "tried": pl.get("search_tried")}
    # footprint samples for ground height (lowest -> no floating)
    zs = []
    for fx in np.linspace(mn.x * 0.6, mx.x * 0.6, 4):
        for fy in (mn.y * 0.5, 0, mx.y * 0.5):
            a = math.radians(yaw)
            gx = x + s * (math.cos(a) * fx - math.sin(a) * fy)
            gy = y + s * (math.sin(a) * fx + math.cos(a) * fy)
            gz, nm, _ = T.ground_z(ground, gx, gy)
            if gz is not None:
                zs.append((gz, nm))
    if not zs:
        LOG["warnings"].append(f"{pl['name']}: no ground")
        gz = 0.0
    else:
        gz = float(np.percentile([z for z, _ in zs], 25)) - 0.05 * s
    sx = -s if mirror else s
    rec = {"source": src.name, "name": pl["name"], "location": [round(x, 3), round(y, 3), round(gz, 3)],
           "rotation_deg": [0.0, 0.0, round(yaw, 2)], "scale": [round(sx, 3), round(s, 3), round(s, 3)],
           "replaces": pl.get("replaces")}
    # rules check with the transformed piece
    ob2 = src.copy(); ob2.data = src.data; col.objects.link(ob2)
    ob2.location = rec["location"]; ob2.rotation_euler = (0, 0, math.radians(yaw)); ob2.scale = rec["scale"]
    bpy.context.view_layer.update()
    P = T.world_verts_env([ob2])
    chk = T.placement_check(P)
    pmn, pmx = R.bounds([ob2])
    hits = [n for n, a, b in ctx_boxes if a.x < pmx.x and b.x > pmn.x and a.y < pmx.y and b.y > pmn.y and a.z < pmx.z and b.z > pmn.z]
    chk["bbox_overlaps"] = hits[:12]
    chk["mesh_collisions"] = collides(ob2)
    chk["auto"] = pl.get("auto")
    chk["ground_hits"] = sorted({nm for _, nm in zs})
    chk["ground_z_spread"] = round(float(np.ptp([z for z, _ in zs])), 2) if zs else None
    bpy.data.objects.remove(ob2)
    rec["check"] = chk
    placements.append(rec)
    LOG["placements"][pl["name"]] = chk
    print("[arch] place", pl["name"], json.dumps(chk), flush=True)

# remove reference geometry before saving
for c in (bpy.data.collections.get("TOOLS_GroundRef"), ctx_col):
    if c:
        for o in list(c.all_objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
bpy.ops.outliner.orphans_purge(do_recursive=True)

# lay pieces out in a lineup inside the blend (origin = ground-contact centre stays at local 0)
blend = T.save_blend(ASSET, VER)
arr = {"asset": ASSET, "blend": os.path.basename(blend), "units": "env (main build: world = env*4.6 + (0,0,1.94))",
       "placements": [{k: v for k, v in r.items() if k in ("source", "name", "location", "rotation_deg", "scale")} for r in placements],
       "replaces": {r["name"]: r.get("replaces") for r in placements}}
T.write_json(os.path.join(T.asset_dir(ASSET), "arrangement.json"), arr)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)

# ---------------------------------------------------------------- previews (world scale)
if DO_RENDER:
    R.setup_render(sc, "EEVEE", (1100, 720), 48)
    R.setup_world(sc)
    K = T.ENV_K
    lights = R.standard_lights(30.0)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, T.ENV_DZ - 0.02))
    gnd = bpy.context.active_object; gnd.name = "PV_Ground"
    M.assign(gnd, "Basalt", moss=0.3)
    for ob in pieces:
        ob.hide_render = True
    T.to_world_scale(pieces)
    LOG["renders"] = {}
    for ob in pieces:
        ob.hide_render = False
        mn, mx = R.bounds([ob])
        c = (mn + mx) / 2
        size = (mx - mn).length
        short = ob.name.replace("CFCL_ToolArch_", "")
        for vn, az, el, dm, lens in (("front", 8, 10, 1.05, 35), ("q_left", -42, 16, 1.1, 35), ("back", 165, 14, 1.1, 35),
                                      ("close", 28, 6, 0.42, 50)):
            a_, e_ = math.radians(az), math.radians(el)
            d = size * dm * (35 / lens) * 1.15
            tgt = c if vn != "close" else Vector((c.x + (mx.x - mn.x) * 0.18, c.y, mn.z + (mx.z - mn.z) * 0.35))
            loc = tgt + Vector((math.sin(a_) * math.cos(e_), -math.cos(a_) * math.cos(e_), math.sin(e_))) * d
            cam = T.view_cam(f"CAM_{short}_{vn}", loc, tgt, lens)
            pth = os.path.join(RDIR, f"arch_v{VER:03d}_{short}_{vn}.png")
            T.render(pth, cam)
            LOG["renders"][f"{short}_{vn}"] = os.path.relpath(pth, T.CL)
        ob.hide_render = True
    T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
LOG["seconds"] = round(time.time() - t0, 1)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
print("ARCH_DONE", json.dumps({"pieces": LOG["pieces"], "warnings": LOG["warnings"]})[:3000])
