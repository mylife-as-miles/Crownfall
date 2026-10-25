"""CFCL_RitualFloor - the shattered, impossible ritual plaza around the monumental board (WORLD METRES).

Not scaled by the env transform. Origin = board centre. Player -Y, opponent +Y. Everything starts beyond the dais
ring (r >= 20.7 m); the 8x8 playfield and its border (CFCL_Board_Arena) are never touched.

Layers (see assets/CFCL_RitualFloor/README.md):
  * checker fringe  : broken checker plates r 21..33 (board lattice continued, 2.3 m -> 4.6 m tiles)
  * paving plates   : ancient carved paving + blocky stepped rock roots, tilted / uplifted / stacked (tectonic)
  * processional stairs on -Y and +Y (symmetric architecture, neutral, no heraldry)
  * stairs-to-nowhere on tilted plates
  * the rising stream: plates tear free behind +Y and arc up to the eclipse rim (paving -> masonry -> rock, a few
    loose checker tiles)
  * colossal tilted half-sunk ribbed gate (Sirene-like carved language + board lozenge frieze + bronze pyramid crown)
  * pillar field: 12 broken, tilted turned columns

python lib/run_blender.py scripts/ritual_floor.py --timeout 2400 -- --ver 1 --iter 1 [--views hero,worm,high34,god,top]
"""
import sys
import os
import math
import json
import time
import argparse

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
sys.path.insert(0, os.path.join(CL, "scripts"))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402
import cf_render as R  # noqa: E402
import cf_materials as M  # noqa: E402
import arch_lib as A  # noqa: E402
import cf_atmos as ATM  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--ver", type=int, default=1)
ap.add_argument("--iter", type=int, default=1)
ap.add_argument("--views", default="hero,worm,high34,god,top")
ap.add_argument("--samples", type=int, default=40)
ap.add_argument("--fog", type=float, default=0.0035)
ap.add_argument("--norender", action="store_true")
args = ap.parse_args(argv)

T0 = time.time()
ASSET = "CFCL_RitualFloor"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "ritual_floor")
os.makedirs(ADIR, exist_ok=True)
os.makedirs(RDIR, exist_ok=True)

# ----------------------------------------------------------------------------- layout constants (world metres)
SQ = 2.30
DAIS_R, DAIS_TOP = 20.7, -1.55
FRINGE_R = 33.0
ROOT_Z = -9.5
STAIR_HW, STAIR_RUN, STAIR_RISE, STAIR_N, STAIR_LAND = 5.0, 1.5, 0.41, 10, 2.0
# colossal gate: far skyline BENEATH the eclipse (behind its disc -> can never block it; between skull and hand)
# v006: the gate is PROMOTED to a colossal collapsed ribbed ring-arch (entablature fallen), its crown placed in the
# hero frame ~50 px beneath the eclipse limb, spanning from behind the skull to near the hand
GATE_XY, GATE_SINK, GATE_TILT, GATE_LEAN, GATE_SCALE, GATE_BASE_Z = (8.0, 215.0), 0.0, -10.0, 6.0, 3.4, -6.0
GATE_TOP_EL_DEG = 2.25
GATE_XSTRETCH = 1.6          # v007: elliptical Sirene arch - dominance through WIDTH (height is capped by the eclipse)
# tectonic fault lines (plaza coords): plates on both sides heave up toward them -> pressure ridges
FAULTS = [((-23.0, -21.0), (-64.0, -44.0)), ((25.0, -25.0), (60.0, -60.0)), ((-9.0, -43.0), (12.0, -74.0))]
# hero-camera angular exclusion boxes for floating fragments (az, el in deg from (0,-30,9))
HERO_CAM = np.array([0.0, -30.0, 9.0])
SKULL_BOX, HAND_BOX = (-17.5, -2.6, -12.0, 5.5), (9.0, 20.5, -12.0, 12.5)
ECL_DIR_R = 4.9
PILLAR_BOX = (24.0, 40.0, 4.0, 22.0)        # v006: moved back so the stumps don't loom in the hero's right third
STREAM_CTRL = np.array([(1.0, 38.0, -3.0), (2.0, 52.0, 4.0), (-3.0, 66.0, 15.0), (-2.0, 77.0, 27.5),
                        (4.0, 85.0, 36.5), (8.0, 88.5, 38.5)])     # curls over the eclipse's upper-left rim
ECLIPSE_C, ECLIPSE_R = np.array([3.9, 92.0, 30.5]), 12.4          # v006: main scene's new eclipse
HERO_W, HERO_H, HERO_F = 1920, 1080, 1280.0                          # hero 24 mm / 36 mm sensor @1920x1080
_HC, _HT = np.array([0.0, -30.0, 9.0]), np.array([0.0, 20.0, 5.5])
_HF = (_HT - _HC) / np.linalg.norm(_HT - _HC)
_HR = np.cross(_HF, (0, 0, 1.0))
_HR /= np.linalg.norm(_HR)
_HU = np.cross(_HR, _HF)


def hero_px(p):
    """world point -> (u, v, depth) in the 1920x1080 hero frame (v down)."""
    d = np.asarray(p, float) - _HC
    zc = d @ _HF
    return HERO_W / 2 + HERO_F * (d @ _HR) / zc, HERO_H / 2 - HERO_F * (d @ _HU) / zc, zc


def hero_unpx(u, v, y_world):
    """hero pixel (u, v) at world depth-plane y = y_world -> world point."""
    dr = _HF + ((u - HERO_W / 2) / HERO_F) * _HR + ((HERO_H / 2 - v) / HERO_F) * _HU
    t = (y_world - _HC[1]) / dr[1]
    return _HC + t * dr
SKULL_C, SKULL_RAD = np.array([-12.9, 43.7, 6.5]), np.array([8.0, 8.4, 7.0])
HAND_C = np.array([19.7, 46.8])
rng = np.random.default_rng(20261024 + 7)
REPORT = {"asset": ASSET, "version": args.ver, "iter": args.iter}


# ----------------------------------------------------------------------------- 2D helpers
def clip_half(P, m, n):
    out = []
    L = len(P)
    for k in range(L):
        a, b = P[k], P[(k + 1) % L]
        da, db = (a - m) @ n, (b - m) @ n
        if da <= 0:
            out.append(a)
        if da * db < 0:
            out.append(a + (b - a) * (da / (da - db)))
    return np.array(out) if out else np.zeros((0, 2))


def ngon(c, r, n=12, ph=0.0):
    t = ph + np.arange(n) * 2 * math.pi / n
    return np.stack([c[0] + r * np.cos(t), c[1] + r * np.sin(t)], 1)


def resample(P, step):
    out = []
    L = len(P)
    for k in range(L):
        a, b = P[k], P[(k + 1) % L]
        n = max(1, int(math.ceil(np.linalg.norm(b - a) / step)))
        for i in range(n):
            out.append(a + (b - a) * i / n)
    return np.array(out)


def poly_area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def centroid(P):
    return P.mean(0)


def ccw(P):
    return P if poly_area(P) > 0 else P[::-1].copy()


def rot2(P, c, deg):
    t = math.radians(deg)
    Rm = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
    return (P - c) @ Rm.T + c


def catmull(P, t):
    """Catmull-Rom through control points P (n,3); t in [0,1] -> point, tangent."""
    n = len(P)
    seg = min(int(t * (n - 1)), n - 2)
    u = t * (n - 1) - seg
    p0 = P[max(seg - 1, 0)]
    p1, p2 = P[seg], P[seg + 1]
    p3 = P[min(seg + 2, n - 1)]
    a = 2 * p1
    b = p2 - p0
    c = 2 * p0 - 5 * p1 + 4 * p2 - p3
    d = -p0 + 3 * p1 - 3 * p2 + p3
    pt = 0.5 * (a + b * u + c * u * u + d * u * u * u)
    tg = 0.5 * (b + 2 * c * u + 3 * d * u * u)
    return pt, tg / max(np.linalg.norm(tg), 1e-9)


def fillet(pts, radii, nseg=3):
    """Closed polygon with per-corner fillet radii -> dense polygon (same as board_arena.fillet)."""
    P = [np.asarray(p, float) for p in pts]
    n = len(P)
    out = []
    for i in range(n):
        p, r = P[i], radii[i]
        if r <= 0:
            out.append(p)
            continue
        a, b = P[i - 1], P[(i + 1) % n]
        da = (a - p) / np.linalg.norm(a - p)
        db = (b - p) / np.linalg.norm(b - p)
        ang = math.acos(float(np.clip(da @ db, -1, 1)))
        t = min(r / math.tan(ang / 2), 0.45 * np.linalg.norm(a - p), 0.45 * np.linalg.norm(b - p))
        re = t * math.tan(ang / 2)
        bis = (da + db) / np.linalg.norm(da + db)
        c = p + bis * math.sqrt(t * t + re * re)
        p1, p2 = p + da * t, p + db * t
        a1 = math.atan2(*(p1 - c)[::-1])
        a2 = math.atan2(*(p2 - c)[::-1])
        dl = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for k in range(nseg + 1):
            an = a1 + dl * k / nseg
            out.append(c + re * np.array([math.cos(an), math.sin(an)]))
    return np.array(out)


# ----------------------------------------------------------------------------- 3D helpers
def rot_about(V, pivot, axis, deg):
    Rm = A.rot_axis(axis, deg)
    return (V - pivot) @ Rm.T + pivot


def Rz(deg):
    return A.rot_axis((0, 0, 1), deg)


def piece_transform(pc, Rm, t):
    pc.V = pc.V @ np.asarray(Rm).T + np.asarray(t, float)
    return pc


class Bucket:
    """Pieces + per-vertex attributes -> one mesh object."""

    def __init__(self):
        self.pieces, self.attrs = [], []

    def add(self, pc, pq=None):
        if pc is None or len(pc.V) == 0:
            return
        self.pieces.append(pc)
        self.attrs.append(np.zeros((len(pc.V), 3)) if pq is None else np.asarray(pq, float))

    def build(self, name, col, mats, sharp=40.0, curvature=False):
        if not self.pieces:
            return None
        allp = A.merge_pieces(self.pieces)
        pq = np.concatenate(self.attrs)
        me = bpy.data.meshes.new(name + "_Mesh")
        me.from_pydata(allp.V.tolist(), [], allp.F)
        for m in mats:
            me.materials.append(m)
        if len(mats) > 1:
            me.polygons.foreach_set("material_index", np.clip(np.asarray(allp.fm, np.int32), 0, len(mats) - 1))
        at = me.attributes.new("cfr_pq", "FLOAT_VECTOR", "POINT")
        at.data.foreach_set("vector", pq.astype(np.float32).ravel())
        me.validate(clean_customdata=False)
        me.update()
        me.shade_smooth()
        try:
            me.set_sharp_from_angle(angle=math.radians(sharp))
        except Exception:
            pass
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        if curvature:
            try:
                M.bake_curvature(ob)
            except Exception as ex:
                print("curv", name, ex)
        return ob


# ----------------------------------------------------------------------------- materials
def nb_attach(mat):
    nb = M.NB.__new__(M.NB)
    nb.nt = mat.node_tree
    nb._k = 600
    nb._cache = {}
    return nb


def _bsdf_links(m):
    nt = m.node_tree
    bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    bump = bsdf.inputs["Normal"].links[0].from_node
    return (bsdf, bsdf.inputs["Base Color"].links[0].from_socket, bsdf.inputs["Roughness"].links[0].from_socket,
            bump, bump.inputs["Height"].links[0].from_socket)


def pq_node(nb):
    nd = nb.n("ShaderNodeAttribute")
    nd.attribute_type = "GEOMETRY"
    nd.attribute_name = "cfr_pq"
    return nd.outputs["Vector"]


def marble_col(nb, p, r1, r2):
    wn = nb.tn(p, 0.28, 2.0, 0.5).outputs["Color"]
    wp = nb.vop("ADD", p, nb.vop("SCALE", nb.vop("SUBTRACT", wn, (0.5, 0.5, 0.5)), s=1.6))
    v1 = nb.tn(nb.vop("MULTIPLY", wp, (0.22, 0.75, 0.5)), 1.0, 2.0, 0.45).outputs["Fac"]
    a1 = nb.absv(nb.sub(v1, 0.5))
    line1 = nb.ss(a1, 0.0, 0.0065, 1.0, 0.0)
    halo1 = nb.ss(a1, 0.0, 0.07, 1.0, 0.0)
    g1 = nb.ss(nb.tn(p, 0.30, 2.0).outputs["Fac"], 0.38, 0.58)
    cloud = nb.tn(wp, 0.55, 3.0, 0.5).outputs["Fac"]
    base = nb.rampc(cloud, [(0.28, (0.50, 0.455, 0.37)), (0.55, (0.585, 0.54, 0.45)), (0.80, (0.635, 0.59, 0.50))])
    c = nb.hsv(base, h=nb.mad(r2, 0.016, 0.492), v=nb.mad(r1, 0.12, 0.94))
    c = nb.cmix(nb.mul(halo1, nb.mul(g1, 0.38)), c, (0.44, 0.425, 0.39))
    c = nb.cmix(nb.mul(line1, nb.mul(g1, 0.42)), c, (0.36, 0.35, 0.335))
    return c


def basalt_col(nb, p, r1, r2):
    cloud = nb.tn(p, 0.9, 4.0, 0.5).outputs["Fac"]
    mott = nb.tn(p, 3.5, 4.0, 0.6).outputs["Fac"]
    grain = nb.tn(p, 120.0, 3.0, 0.6).outputs["Fac"]
    base = nb.rampc(cloud, [(0.3, (0.046, 0.049, 0.054)), (0.7, (0.068, 0.070, 0.075))])
    c = nb.hsv(base, h=nb.mad(r2, 0.02, 0.49), v=nb.mul(nb.mul(nb.mad(r1, 0.22, 0.89), nb.lin(grain, 0.3, 0.7, 0.80, 1.22)),
                                                        nb.lin(mott, 0.3, 0.7, 0.86, 1.14)))
    vor = nb.tv(p, 140.0, "F1")
    cry = nb.mul(nb.ss(vor.outputs["Distance"], 0.0, 0.12, 1.0, 0.0), nb.ss(nb.tn(p, 9.0, 2.0).outputs["Fac"], 0.42, 0.60))
    return nb.cmix(nb.mul(cry, 0.55), c, (0.15, 0.15, 0.155))


def mat_checker_top():
    """Checker paving of the broken fringe: board lattice continued from the plaza coords stored per vertex
    (cfr_pq = original x, original y, tile size), so the pattern rides with each tilted plate. Bevel/grout by shader."""
    m = bpy.data.materials.new("CFCL_RitualFloor_CheckerTop")
    nb = M.NB(m)
    pq = pq_node(nb)
    x, y, s = nb.vsep(pq)
    u = nb.m("DIVIDE", nb.add(x, 9.2), s)
    v = nb.m("DIVIDE", nb.add(y, 9.2), s)
    ci, cj = nb.m("FLOOR", u), nb.m("FLOOR", v)
    fu, fv = nb.sub(u, ci), nb.sub(v, cj)
    par = nb.m("FLOORED_MODULO", nb.add(ci, cj), 2.0)            # 0 = dark (board parity), 1 = light
    e = nb.mul(nb.mn(nb.mn(fu, nb.sub(1.0, fu)), nb.mn(fv, nb.sub(1.0, fv))), s)
    grout = nb.ss(e, 0.045, 0.035)
    bev = nb.ss(e, 0.035, 0.13)
    wn = nb.n("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = "3D"
    nb.link(nb.vcomb(ci, cj, s), wn.inputs["Vector"])
    r1 = wn.outputs["Value"]
    r2 = nb.m("FRACT", nb.mul(r1, 7.31))
    vr = nb.n("ShaderNodeVectorRotate", rotation_type="Z_AXIS")
    nb.link(nb.vcomb(x, y, 0.0), vr.inputs["Vector"])
    nb.link(nb.mul(r1, 6.2832), vr.inputs["Angle"])
    p = nb.vop("ADD", vr.outputs["Vector"], nb.vcomb(nb.mul(r2, 37.0), nb.mul(r1, 53.0), 0.0))
    c = nb.cmix(par, basalt_col(nb, p, r1, r2), marble_col(nb, p, r1, r2))
    # the fringe must NOT compete with the pristine board: a weathering film lowers contrast, sediment drifts,
    # ~10 % of tiles are missing (dark sunken beds), moss creeps along the grout
    pos = nb.pos()
    c = nb.cmix(0.42, c, (0.13, 0.118, 0.095))
    sed = nb.ss(nb.tn(pos, 0.35, 3.0, 0.55, 0.3).outputs["Fac"], 0.48, 0.66)
    c = nb.cmix(nb.mul(sed, 0.55), c, (0.19, 0.17, 0.14))
    miss = nb.ss(r1, 0.10, 0.085)
    c = nb.cmix(miss, c, (0.018, 0.016, 0.014))
    soot = nb.ss(nb.tn(pos, 0.12, 3.0, 0.55, 0.4).outputs["Fac"], 0.52, 0.72)
    c = nb.cmix(nb.mul(soot, 0.55), c, (0.03, 0.026, 0.022))
    crk = nb.mul(nb.ss(nb.tv(nb.vop("ADD", nb.vcomb(x, y, 0.0), nb.vop("SCALE", nb.vop("SUBTRACT", nb.tn(pos, 0.9, 2.0).outputs["Color"], (0.5, 0.5, 0.5)), s=0.5)), 0.45, "DISTANCE_TO_EDGE").outputs["Distance"], 0.0, 0.012, 1.0, 0.0),
                 nb.ss(nb.tn(pos, 0.5, 2.0).outputs["Fac"], 0.48, 0.58))
    c = nb.cmix(nb.mul(crk, 0.7), c, (0.05, 0.045, 0.04))
    c = nb.hsv(c, v=nb.lin(bev, 0.0, 1.0, 0.55, 1.0))
    c = nb.cmix(grout, c, (0.028, 0.025, 0.022))
    mossm = nb.mul(nb.mx(grout, nb.mul(miss, 0.8)), nb.ss(nb.tn(pos, 0.8, 3.0).outputs["Fac"], 0.42, 0.58))
    c = nb.cmix(nb.mul(mossm, 0.85), c, (0.045, 0.062, 0.025))
    rough = nb.mad(par, -0.12, 0.55)
    rough = nb.mad(nb.sub(0.92, rough), nb.mx(nb.mx(grout, miss), nb.mul(nb.mx(soot, sed), 0.6)), rough)
    h = nb.sub(nb.mad(bev, 0.8, nb.mul(crk, -0.3)), nb.mul(miss, 1.2))
    nrm = nb.bump(h, 0.6, 0.06)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.5})
    return m


def ancient_warm(nb, col_in, rough_in, h_in, lit=False, moss=0.3, pos=None):
    """LOCKED PALETTE 'Ancient stone': warm grey #5d574e mid / #8a8377 lit, heavily weathered: sediment dust on
    up-facing, dark run-off stains, erosion pitting, moss (secondary green) in hollows - applied AFTER the recolour so
    moss keeps its own green."""
    pos = pos or nb.pos()
    c = nb.hsv(col_in, h=0.458, s=1.55, v=(0.90 if lit else 0.72))          # v006: darker (hero luma <= ~0.3)
    up = nb.ss(nb.nz(), 0.55, 0.92)
    sed = nb.mul(up, nb.ss(nb.tn(pos, 0.7, 3.0, 0.55, 0.3).outputs["Fac"], 0.48, 0.66))
    c = nb.cmix(nb.mul(sed, 0.40), c, (0.19, 0.172, 0.145))
    side = nb.ss(nb.absv(nb.nz()), 0.55, 0.2)
    st = nb.tn(nb.vop("MULTIPLY", pos, (3.2, 3.2, 0.22)), 1.0, 3.0, 0.5).outputs["Fac"]
    stain = nb.mul(nb.mul(nb.ss(st, 0.54, 0.70), side), nb.ss(nb.tn(pos, 0.4, 2.0).outputs["Fac"], 0.42, 0.6))
    c = nb.cmix(nb.mul(stain, 0.6), c, (0.035, 0.032, 0.026))
    pit = nb.mul(nb.ss(nb.tv(pos, 9.0, "F1").outputs["Distance"], 0.0, 0.25, 1.0, 0.0),
                 nb.ss(nb.tn(pos, 1.3, 2.0).outputs["Fac"], 0.5, 0.64))
    c = nb.cmix(nb.mul(pit, 0.45), c, (0.05, 0.045, 0.038))
    h = nb.sub(h_in, nb.mad(pit, 0.6, nb.mul(stain, 0.1)))
    rough = nb.mad(sed, 0.08, rough_in)
    if moss > 0:
        c, rough, h, _ = M._apply_moss(nb, c, rough, h, pos, moss, 0.5, 0.85, nb.cavity(0.4), open_w=0.12)
    return c, rough, h


def mat_obsidian():
    """LOCKED PALETTE 'Obsidian': near-black basalt/obsidian undersides and roots (rendered ~0.04-0.10), with glassy
    conchoidal fracture facets (low roughness patches) and sparse moss on ledges."""
    m = M.make_basalt(moss=0.18, lichen=0.3, _name="RitualFloor_Obsidian")
    bsdf, col_in, rough_in, bump, h_in = _bsdf_links(m)
    nb = nb_attach(m)
    pos = nb.pos()
    vf = nb.tv(pos, 1.6, "F1")
    glass = nb.mul(nb.ss(nb.seprgb(vf.outputs["Color"])[0], 0.62, 0.70), nb.ss(nb.absv(nb.nz()), 0.9, 0.5))
    nb.link(nb.hsv(col_in, v=nb.lin(glass, 0.0, 1.0, 0.85, 0.6)), bsdf.inputs["Base Color"])
    nb.link(nb.mad(nb.sub(0.14, rough_in), glass, rough_in), bsdf.inputs["Roughness"])
    return m


def mat_paving():
    """Ancient carved paving (locked palette warm grey, heavily weathered) + ashlar coursing from the plaza coords."""
    m = M.make_ancient_stone(moss=0.0, cracks=0.8, _name="RitualFloor_Paving")
    bsdf, col_in, rough_in, bump, h_in = _bsdf_links(m)
    nb = nb_attach(m)
    col_in, rough_in, h_in = ancient_warm(nb, col_in, rough_in, h_in, lit=False, moss=0.42)
    pq = pq_node(nb)
    br = nb.n("ShaderNodeTexBrick")
    nb.link(pq, br.inputs["Vector"])
    for k, v in (("Scale", 1.0), ("Mortar Size", 0.045), ("Mortar Smooth", 0.2), ("Bias", 0.0),
                 ("Brick Width", 3.1), ("Row Height", 1.55)):
        if br.inputs.get(k):
            br.inputs[k].default_value = v
    br.inputs["Color1"].default_value = (1, 1, 1, 1)
    br.inputs["Color2"].default_value = (0.85, 0.85, 0.85, 1)
    br.inputs["Mortar"].default_value = (0, 0, 0, 1)
    br.offset = 0.5
    jl = nb.seprgb(br.outputs["Color"])[0]
    joint = nb.ss(jl, 0.5, 0.05)
    slab = nb.lin(jl, 0.8, 1.0, 0.92, 1.06)
    c = nb.hsv(col_in, v=slab)
    c = nb.cmix(nb.mul(joint, 0.8), c, (0.03, 0.03, 0.025))
    nb.link(c, bsdf.inputs["Base Color"])
    nb.link(nb.mad(joint, 0.15, rough_in), bsdf.inputs["Roughness"])
    nb.link(nb.sub(h_in, nb.mul(joint, 0.9)), bump.inputs["Height"])
    return m


def mat_carved(dark=False):
    """Carved ceremonial masonry (Sirene vocabulary, locked-palette warm grey 'lit' tone, weathered).  dark=True:
    the colossal gate - a darker silhouette that reads against the luminous haze beneath the eclipse."""
    m = M.make_ancient_stone(moss=0.0, lichen=0.6, cracks=0.5, _name="RitualFloor_CarvedDark" if dark else "RitualFloor_Carved")
    bsdf, col_in, rough_in, bump, h_in = _bsdf_links(m)
    nb = nb_attach(m)
    c, rough, h = ancient_warm(nb, col_in, rough_in, h_in, lit=not dark, moss=0.18)
    if dark:
        c = nb.hsv(c, s=0.9, v=0.55)
    nb.link(c, bsdf.inputs["Base Color"])
    nb.link(rough, bsdf.inputs["Roughness"])
    nb.link(h, bump.inputs["Height"])
    return m


def mat_bronze():
    m = bpy.data.materials.new("CFCL_RitualFloor_Bronze")
    nb = M.NB(m)
    pos = nb.pos()
    n1a = nb.tn(pos, 9.0, 5.0, 0.62, 0.3).outputs["Fac"]
    run = nb.tn(nb.vop("MULTIPLY", pos, (7.0, 7.0, 0.9)), 1.0, 4.0, 0.6).outputs["Fac"]
    n1 = nb.mad(n1a, 0.6, nb.mul(run, 0.4))
    n2 = nb.tn(pos, 0.9, 3.0, 0.5).outputs["Fac"]
    n3 = nb.tn(pos, 22.0, 4.0, 0.6).outputs["Fac"]
    cvx = nb.attr("cf_convex")
    cav = nb.c01(nb.mad(nb.cavity(0.10), 1.3, nb.attr("cf_concave")))
    pol = nb.c01(nb.mad(cvx, 1.6, nb.mul(nb.ss(n2, 0.55, 0.75), 0.30)))
    pat = nb.mul(nb.c01(nb.mad(nb.ss(n1, 0.30, 0.60), 0.85, 0.12)), nb.sub(1.0, pol))
    verd = nb.c01(nb.mul(nb.mul(cav, nb.ss(n1, 0.40, 0.62)), 1.2))
    metal = nb.rampc(n3, [(0.3, (0.46, 0.29, 0.10)), (0.7, (0.58, 0.38, 0.14))])
    patc = nb.rampc(n2, [(0.35, (0.10, 0.068, 0.034)), (0.7, (0.075, 0.07, 0.04))])
    c = nb.cmix(pat, metal, patc)
    c = nb.cmix(verd, c, nb.rampc(n3, [(0.35, (0.055, 0.14, 0.10)), (0.7, (0.10, 0.20, 0.15))]))
    metallic = nb.mul(nb.sub(1.0, verd), nb.sub(0.95, nb.mul(pat, 0.45)))
    rough = nb.mad(nb.sub(0.85, nb.mad(pat, 0.30, 0.22)), verd, nb.mad(pat, 0.30, 0.22))
    nrm = nb.bump(nb.mad(verd, 0.5, nb.mul(n1, 0.15)), 0.35, 0.003)
    nb.principled(c, rough, nrm, metallic=metallic)
    return m


def mat_shard_haze(level):
    """v010 (F8): aerial-perspective variant for the UPPER stream shards - dark stone with a faint emission in the
    haze colour so they sit at ~0.20-0.30 luma against the corona instead of crushing to black.  level 0..1."""
    m = bpy.data.materials.new(f"CFCL_RitualFloor_ShardHaze{int(level * 100):02d}")
    nb = M.NB(m)
    pos = nb.pos()
    n = nb.tn(pos, 2.0, 3.0, 0.55).outputs["Fac"]
    c = nb.rampc(n, [(0.3, (0.05, 0.047, 0.044)), (0.7, (0.085, 0.078, 0.07))])
    nb.principled(c, 0.88, nb.bump(n, 0.3, 0.02),
                  extra={"Emission Color": (0.62, 0.53, 0.45, 1.0), "Emission Strength": 0.085 * level,
                         "Specular IOR Level": 0.3})
    return m


def mat_loose_tile(light):
    m = bpy.data.materials.new("CFCL_RitualFloor_LooseTile" + ("Marble" if light else "Basalt"))
    nb = M.NB(m)
    tc = nb.n("ShaderNodeTexCoord")
    rnd = nb.objrand()
    r2 = nb.m("FRACT", nb.mul(rnd, 7.31))
    vr = nb.n("ShaderNodeVectorRotate", rotation_type="Z_AXIS")
    nb.link(tc.outputs["Object"], vr.inputs["Vector"])
    nb.link(nb.mul(rnd, 6.2832), vr.inputs["Angle"])
    p = nb.vop("ADD", vr.outputs["Vector"], nb.vcomb(nb.mul(r2, 37.0), nb.mul(rnd, 53.0), 0.0))
    c = marble_col(nb, p, rnd, r2) if light else basalt_col(nb, p, rnd, r2)
    side = nb.ss(nb.absv(nb.nz()), 0.6, 0.3)                       # broken/raw faces darker & rougher
    c = nb.cmix(nb.mul(side, 0.35), c, (0.08, 0.075, 0.07) if light else (0.035, 0.035, 0.035))
    soot = nb.ss(nb.tn(nb.pos(), 0.4, 3.0).outputs["Fac"], 0.5, 0.7)
    c = nb.cmix(nb.mul(soot, 0.5), c, (0.03, 0.026, 0.022))
    nb.principled(c, nb.mad(side, 0.3, 0.45 if light else 0.55), None, extra={"Specular IOR Level": 0.5})
    return m


# ----------------------------------------------------------------------------- plates (tectonic plaza)
def z_base(r):
    return DAIS_TOP + 0.05 - 0.07 * max(0.0, r - 22.0)


def allowed(x, y):
    r = math.hypot(x, y)
    if r < 22.5 or r > 76:
        return False
    if abs(x) < 7.2 and -39.5 < y < -19.0:
        return False                                   # -Y processional stair corridor
    if abs(x) < 7.2 and 19.0 < y < 39.5:
        return False                                   # +Y processional stair corridor
    if y > 31.0:
        return False                                   # v006: no stream root there any more (luminous gap)
    if y > 3.0 and abs(x) > 21.0:
        return False                                   # CC0 banks
    if PILLAR_BOX[0] - 1 < x < PILLAR_BOX[1] + 1 and PILLAR_BOX[2] - 1 < y < PILLAR_BOX[3] + 1:
        return False                                   # pillar field has its own pedestals
    return True


def spacing(x, y):
    """plate size: fringe ~6 m, outer grows with r, with smooth regional variation (big slabs vs shattered zones)."""
    r = math.hypot(x, y)
    var = 0.78 + 0.6 * (0.5 + 0.5 * math.sin(0.21 * x + 0.13 * y) * math.cos(0.17 * y - 0.11 * x))
    if r < FRINGE_R:
        return 6.2 * (0.85 + 0.3 * (var - 0.78) / 0.6)
    return (6.8 + (r - FRINGE_R) * 0.13) * var


def hero_angles(p):
    d = np.asarray(p, float) - HERO_CAM
    return math.degrees(math.atan2(d[0], d[1])), math.degrees(math.atan2(d[2], math.hypot(d[0], d[1])))


def blocks_hero_targets(p, pad=0.0):
    """True if point p (in front of the target) projects onto the skull, hand or eclipse disc from the hero cam."""
    az, el = hero_angles(p)
    for (a0, a1, e0, e1), ty in ((SKULL_BOX, 44.0), (HAND_BOX, 46.0)):
        if a0 - pad < az < a1 + pad and e0 < el < e1 + pad and p[1] < ty + 6:
            return True
    ea, ee = hero_angles(ECLIPSE_C)
    return math.hypot(az - ea, el - ee) < ECL_DIR_R + pad and p[1] < ECLIPSE_C[1]


def fault_dir(c):
    """nearest fault: (distance, unit vector from c toward the fault)."""
    best = (1e9, None)
    for a, b in FAULTS:
        a, b = np.array(a), np.array(b)
        t = np.clip((c - a) @ (b - a) / ((b - a) @ (b - a)), 0, 1)
        q = a + t * (b - a)
        d = np.linalg.norm(q - c)
        if d < best[0]:
            best = (d, (q - c) / max(d, 1e-6))
    return best


def make_seeds():
    S = []
    cand = rng.uniform((-78, -78), (78, 50), (9000, 2))
    for x, y in cand:
        if not allowed(x, y):
            continue
        h = spacing(x, y)
        if S and np.min(np.hypot(*(np.array(S) - (x, y)).T)) < 0.82 * h:
            continue
        S.append((x, y))
    return np.array(S)


def cell_polys(S, hf=None):
    cells = []
    for i, s in enumerate(S):
        h = (hf or spacing)(*s)
        P = ngon(s, rng.uniform(0.85, 1.05) * h, 6, rng.uniform(0, 1))      # angular bound -> tectonic shards
        d = np.hypot(*(S - s).T)
        for j in np.argsort(d)[1:22]:
            if d[j] > 2.2 * h:
                break
            P = clip_half(P, 0.5 * (s + S[j]), S[j] - s)
            if len(P) < 3:
                break
        if len(P) >= 3:
            cells.append(P)
        else:
            cells.append(None)
    return cells


def tidy_cell(P, s):
    """resample, keep out of dais / stair corridors, jag the broken edges, shrink for the lava gap."""
    per = float(np.sum(np.linalg.norm(np.roll(P, -1, 0) - P, axis=1)))
    P = resample(ccw(P), max(0.85, per / 26.0))
    r = np.hypot(P[:, 0], P[:, 1])
    m = r < 21.2
    P[m] *= (21.2 / np.maximum(r[m], 1e-6))[:, None]
    for sgn in (-1, 1):
        m = (np.abs(P[:, 0]) < 6.4) & (sgn * P[:, 1] > 19.0) & (sgn * P[:, 1] < 39.5)
        P[m, 0] = np.where(s[0] >= 0, 6.4, -6.4)
    c = centroid(P)
    nrm = P - c
    rad = np.linalg.norm(nrm, axis=1).mean()
    jag = A.fbm3(np.c_[P * 0.9, np.zeros(len(P))], 1.0, 2, seed=int(rng.integers(999)))
    P = P + nrm / np.maximum(np.linalg.norm(nrm, axis=1), 1e-6)[:, None] * (jag * 0.35)[:, None]
    rr = math.hypot(*s)
    gap = float(np.clip(0.28 + 0.035 * (rr - 21.0), 0.28, 1.7)) * rng.uniform(0.7, 1.45)
    P = c + (P - c) * max(0.55, 1.0 - gap / max(rad, 1e-3))
    return P


def plate_piece(P, z_top, tsize, kind_top, thin=False, root_z=ROOT_Z):
    """Slab: chamfered top (mat 0), paving edge (mat 1), blocky stepped rock root (mat 2).  Pre-transform coords;
    returns Piece + pq attribute (original x, y, tile size)."""
    P = ccw(np.asarray(P, float))
    n = len(P)
    c = centroid(P)
    rad = np.linalg.norm(P - c, axis=1).mean()
    rings = [(1.0 - 0.07 / max(rad, 0.5), 0.0, 0.0), (1.0, -0.07, 0.0), (1.0, -0.75, 0.0)]
    if thin:
        rings += [(0.95, -0.75, 0.12), (0.78, -1.7, 0.25)]
        zb = z_top - 1.7
    else:
        depth = z_top - root_z
        lv = [0.97, 0.83, 0.66, 0.5]
        hs = rng.uniform(0.25, 0.45, 3)
        hs = hs / hs.sum() * (depth - 0.75)
        z = -0.75
        rings.append((lv[0], z, 0.15))
        for k in range(3):
            z -= hs[k]
            rings.append((lv[k], z, 0.35))
            rings.append((lv[k + 1], z, 0.35))
        zb = z_top + z
    V, F, fm = [], [], []
    sh = rng.normal(0, 0.25, (len(rings), 2))
    for k, (sc, dz, na) in enumerate(rings):
        Q = c + (P - c) * sc
        if na > 0:
            nz = A.fbm3(np.c_[Q * 0.45, np.full(n, k * 1.7 + z_top)], 1.0, 2, seed=k + 3)
            Q = Q + (Q - c) / max(rad, 1e-3) * (nz * na * 1.6)[:, None] + sh[k] * (na > 0.2)
        for q in Q:
            V.append((q[0], q[1], z_top + dz))
    for k in range(len(rings) - 1):
        mat = 0 if k == 0 else (1 if k == 1 else 2)
        for i in range(n):
            j = (i + 1) % n
            F.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
            fm.append(mat)
    F.append(list(range(n)))
    fm.append(0)
    F.append([(len(rings) - 1) * n + i for i in range(n)][::-1])
    fm.append(2)
    pc = A.Piece(np.array(V), F, fm)
    pc.fix_orientation()
    pq = np.c_[np.tile(P, (len(rings), 1)), np.full(len(V), tsize)]
    return pc, pq, zb


def lift_transform(V, c2, d, ang, z_pivot, dz, P2):
    """Rotate so the d-side of the plate lifts by ang deg about the opposite edge, then raise dz."""
    d = np.asarray(d, float) / max(np.linalg.norm(d), 1e-9)
    proj = (P2 - c2) @ d
    piv = np.array([c2[0] + d[0] * proj.min(), c2[1] + d[1] * proj.min(), z_pivot])
    axis = np.array([d[1], -d[0], 0.0])
    V = rot_about(V, piv, axis, ang)
    V[:, 2] += dz
    return V, piv, axis


def build_plates(B_fringe, B_paving, report):
    S = make_seeds()
    cells = cell_polys(S)
    hosts = []
    n_ch, n_pv = 0, 0
    for s, Pc in zip(S, cells):
        if Pc is None or abs(poly_area(Pc)) < 4.0:
            continue
        P = tidy_cell(Pc, s)
        if abs(poly_area(P)) < 3.0:
            continue
        r = math.hypot(*s)
        checker = r < FRINGE_R
        tsize = (SQ if r < 27.5 else 2 * SQ) if checker else 0.0
        zt = z_base(r)
        radial = s / max(r, 1e-6)
        fd, fdir = fault_dir(s)
        if s[1] > 31.0:                                        # stream root: peeling up toward +Y
            d = np.array([rng.normal(0, 0.3), 1.0])
            ang, dz = rng.uniform(24, 52), rng.uniform(0.5, 3.0)
        elif fd < 7.5 and r > 30.0:                            # pressure ridge along a fault
            d = fdir
            ang, dz = rng.uniform(22, 44), rng.uniform(0.8, 3.2)
        elif s[1] > 15.0:                                      # behind the board: low, so the skull/hand bases
            d = rng.normal(0, 1, 2)                            # and the board stay clear from hero/god
            ang, dz = rng.uniform(0.0, 4.0), rng.uniform(-0.4, 0.2)
        elif r < 27.5:
            d = rng.normal(0, 1, 2)
            ang, dz = rng.uniform(0.0, 3.5), rng.uniform(-0.25, 0.12)
        elif r < 40.0:
            d = radial if rng.uniform() < 0.6 else rng.normal(0, 1, 2)
            ang, dz = rng.uniform(3, 16), rng.uniform(-1.0, 1.8)
        else:
            d = radial if rng.uniform() < 0.55 else rng.normal(0, 1, 2)
            ang, dz = rng.uniform(8, 34), rng.uniform(-2.5, 4.5)
        pc, pq, _zb = plate_piece(P, zt, tsize, "checker" if checker else "paving")
        c2 = centroid(P)
        pc.V, piv, axis = lift_transform(pc.V, c2, d, ang, zt, dz, P)
        (B_fringe if checker else B_paving).add(pc, pq)
        if checker:
            n_ch += 1
        else:
            n_pv += 1
            hosts.append((P, zt, d, ang, dz, c2))
    # stacked plates: a smaller slab lying tilted on top of a host and moving with it
    n_st = 0
    order = rng.permutation(len(hosts))
    for hi in order[:14]:
        P, zt, d, ang, dz, c2 = hosts[hi]
        if math.hypot(*c2) < 36:
            continue
        Q = rot2((P - c2) * rng.uniform(0.5, 0.78) + c2 + rng.normal(0, 0.8, 2), c2, rng.uniform(15, 50))
        pc, pq, _ = plate_piece(Q, zt + 0.75, 0.0, "paving", thin=True)
        d2 = rng.normal(0, 1, 2)
        pc.V, _, _ = lift_transform(pc.V, centroid(Q), d2, rng.uniform(14, 38), zt + 0.75, 0.0, Q)
        pc.V, _, _ = lift_transform(pc.V, c2, d, ang, zt, dz, P)
        B_paving.add(pc, pq)
        n_st += 1
    report["plates"] = {"seeds": int(len(S)), "checker_fringe": n_ch, "paving": n_pv, "stacked": n_st}


def build_gate_cluster(B, report):
    """Big carved-paving plates heaving up around the half-sunk far gate (they 'swallow' its base)."""
    # v006: a tight LOW ring of dark plates heaving against the gate's ground line - their raised edges stay below
    # about Z 0, so the colossal ribbed arch rises clear above them (v006 iter06 had 30 m plates walling the skyline)
    g = np.array(GATE_XY)
    S = []
    for p in rng.uniform(g - 75, g + 75, (4000, 2)):
        dd = np.linalg.norm((p - g) / (GATE_XSTRETCH, 1.0))
        if dd < 15.0 or dd > 44.0:
            continue
        if S and np.min(np.linalg.norm(np.array(S) - p, axis=1)) < 11.0:
            continue
        S.append(p)
    S = np.array(S)
    cells = cell_polys(S, hf=lambda x, y: 12.5)
    n = 0
    for s, Pc in zip(S, cells):
        if Pc is None or abs(poly_area(Pc)) < 8.0:
            continue
        P = tidy_cell(Pc, s)
        zt = GATE_BASE_Z + rng.uniform(-0.8, 0.4)
        pc, pq, _ = plate_piece(P, zt, 0.0, "paving", root_z=GATE_BASE_Z - 10.0)
        rad = float(np.linalg.norm(P - centroid(P), axis=1).max())
        ang = min(rng.uniform(8, 24), math.degrees(math.asin(min(1.0, 5.0 / max(2 * rad, 1e-3)))))
        pc.V, _, _ = lift_transform(pc.V, centroid(P), g - s, ang, zt, rng.uniform(0.0, 1.2), P)
        B.add(pc, pq)
        n += 1
    report["gate_cluster_plates"] = n


# ----------------------------------------------------------------------------- Sirene-like turned column
def column_piece(height, r0, style, seed, break_at=None, nseg=36):
    """Turned ceremonial column: plinth, gadrooned bulb, ring stack, fluted/twisted shaft, ring band, gadrooned bell
    capital, abacus.  style: 'twist' | 'rings' | 'flute'. break_at (0..1) -> jagged broken top."""
    rr = np.random.default_rng(seed)
    H = height
    prof = [(0.0, 0.0), (1.30 * r0, 0.0), (1.30 * r0, 0.40), (1.18 * r0, 0.48), (1.24 * r0, 0.62),
            (1.10 * r0, 0.75), (1.32 * r0, 1.10), (1.38 * r0, 1.45), (1.25 * r0, 1.85), (0.98 * r0, 2.15),
            (1.08 * r0, 2.28), (0.95 * r0, 2.40)]
    z0 = 2.40
    zc = H - 2.2
    nsh = 14
    for k in range(1, nsh + 1):
        z = z0 + (zc - z0) * k / nsh
        rk = r0 * (0.92 - 0.06 * k / nsh)
        if style == "rings" and k in (4, 8, 11):
            prof += [(rk, z - 0.18), (rk * 1.16, z - 0.10), (rk * 1.16, z + 0.08), (rk, z + 0.16)]
        elif abs(k - nsh * 0.55) < 0.6:
            prof += [(rk, z - 0.22), (rk * 1.14, z - 0.12), (rk * 1.20, z), (rk * 1.14, z + 0.12), (rk, z + 0.22)]
        else:
            prof.append((rk, z))
    prof += [(0.90 * r0, zc + 0.12), (1.02 * r0, zc + 0.22), (0.92 * r0, zc + 0.32), (1.05 * r0, zc + 0.55),
             (1.30 * r0, zc + 1.05), (1.48 * r0, zc + 1.45), (1.50 * r0, zc + 1.55), (1.55 * r0, zc + 1.62),
             (1.55 * r0, H), (0.0, H)]
    sh0, sh1 = z0 + 0.05, zc + 0.1
    ph = rr.uniform(0, 6.28)

    def deform(Rr, th, Z, k):
        zz = float(Z[0])
        if sh0 < zz < sh1:
            if style == "twist":
                tw = 2.4 * math.pi * (zz - sh0) / (sh1 - sh0)
                Rr = Rr * (1 + 0.085 * np.cos(9 * th + 2.5 * tw + ph))
            elif style == "flute":                   # v006: 12 deep concave flutes (no more "pipe" read)
                Rr = Rr * (1 - 0.075 * np.abs(np.cos(6 * th + ph)) ** 0.6)
        elif 0.6 < zz < 2.2 or zc + 0.5 < zz < zc + 1.5:
            Rr = Rr * (1 + 0.065 * np.cos(12 * th + 1.6 * math.sin(zz * 5.0) + ph))
        return Rr, Z
    pc = A.lathe(prof, nseg, deform)
    if break_at is not None:
        zb = H * break_at
        top = pc.V[:, 2] > zb
        nz = A.fbm3(pc.V[top] * 0.8, 1.0, 2, seed=seed) * 0.7 * r0
        tilt = (pc.V[top, 0] * rr.normal(0, 0.35) + pc.V[top, 1] * rr.normal(0, 0.35))
        pc.V[top, 2] = zb + nz + tilt
        # v006: collapsed capital rings must not flare out ("mushroom cap") - clamp them inside the shaft
        rt = np.hypot(pc.V[top, 0], pc.V[top, 1])
        lim = 0.86 * r0 * rr.uniform(0.85, 1.0, int(top.sum()))
        k_ = np.where(rt > lim, lim / np.maximum(rt, 1e-6), 1.0)
        pc.V[top, 0] *= k_
        pc.V[top, 1] *= k_
        rad = np.hypot(pc.V[:, 0], pc.V[:, 1])
        shrink = np.clip((pc.V[:, 2] - (zb - 0.4 * r0)) / (0.8 * r0), 0, 1)
        f = 1.0 - 0.25 * shrink * (rad > 0.05)
        pc.V[:, 0] *= f
        pc.V[:, 1] *= f
    return pc


# ----------------------------------------------------------------------------- processional stairs
def build_stair(sign, Bc, Br, Bb, report):
    """Symmetric neutral processional stair rising from the outer plaza to the dais edge.  Built for +Y, rotated
    180 deg for -Y (proper rotation).  Damage differs: -Y settled flight + snapped newel; +Y lower flight heaves up
    into the stream."""
    loc = []           # (piece, bucket)
    land = A.make_block((STAIR_HW, STAIR_LAND / 2 + 0.05, 0.6), rb=0.04, step=1.2, chips=4, chip_scale=4.0, rng=rng,
                        center=(0, DAIS_R + STAIR_LAND / 2, DAIS_TOP - 0.6), noise_amp=0.01, seed=11)
    loc.append((land, "c"))
    n_st = STAIR_N if sign < 0 else 2            # v006: +Y trimmed (hand mound / skull seat start at y 26 / 31.5)
    for k in range(1, n_st + 1):
        u0 = DAIS_R + STAIR_LAND + (k - 1) * STAIR_RUN
        zt = DAIS_TOP - k * STAIR_RISE
        st = A.make_block((STAIR_HW - 0.05, STAIR_RUN / 2 + 0.06, 0.35), rb=0.035, step=1.0, chips=3,
                          chip_scale=4.0, rng=rng, center=(0, u0 + STAIR_RUN / 2, zt - 0.35), noise_amp=0.008,
                          seed=20 + k, chip_opts=dict(prefer=(0, (0, 1, 1)), prefer_p=0.7))
        if sign < 0 and k in (5, 6, 7):                              # settled block of the -Y flight
            st.V = rot_about(st.V, np.array([0, u0, zt]), (1, 0, 0.15), 3.0)
            st.V[:, 2] -= 0.35
        if sign > 0 and k == n_st:                                   # +Y: the flight breaks off into the chasm
            far = st.V[:, 1] > u0 + 0.3
            st.V[far, 1] = u0 + 0.3 + A.fbm3(st.V[far] * 1.4, 1.0, 2, seed=31) * 0.5 + 0.4
        loc.append((st, "c"))
    u_end = DAIS_R + STAIR_LAND + n_st * STAIR_RUN
    z_end = DAIS_TOP - n_st * STAIR_RISE
    # stair mass under the flight (raw rock root)
    prof = [(DAIS_R - 0.2, DAIS_TOP - 1.0), (u_end + 0.5, z_end - 0.9), (u_end + 1.5, ROOT_Z), (DAIS_R - 0.5, ROOT_Z)]
    mass = _extrude_x(prof, -STAIR_HW - 1.4, STAIR_HW + 1.4)
    mass.V += A.fbm3(mass.V * 0.35, 1.0, 2, seed=5)[:, None] * 0.25
    loc.append((mass, "b"))
    # parapets with lozenge relief on their outer faces + Sirene newel posts
    for sx in (-1, 1):
        x0, x1 = sx * STAIR_HW, sx * (STAIR_HW + 1.2)
        pp = [(DAIS_R, DAIS_TOP + 0.9), (u_end, z_end + 0.9), (u_end, z_end - 1.2), (DAIS_R, DAIS_TOP - 1.2)]
        par = _extrude_x(pp, min(x0, x1), max(x0, x1))
        if sign > 0:                                                 # +Y parapets end broken with the flight
            cut = par.V[:, 1] > u_end - 0.5
            par.V[cut, 1] = u_end - 0.9 + A.fbm3(par.V[cut] * 1.3, 1.0, 2, seed=8) * 0.5
        loc.append((par, "c"))
        slope = (z_end - DAIS_TOP) / (u_end - DAIS_R)
        U = np.array([0.0, 1.0, slope]) / math.sqrt(1 + slope * slope)
        O = np.array([x1, DAIS_R, DAIS_TOP + 0.15])
        mp = A.map_plane(O, U, (0, 0, 1), (sx, 0, 0))
        Ltot = (u_end - DAIS_R - (1.2 if sign > 0 else 0.6)) * math.sqrt(1 + slope * slope)
        nu = int(Ltot / 1.2)
        for p in A.lozenge_frieze(0.4, 0.4 + nu * 1.2, -0.42, 0.22, nu, mp, h=0.07, wb=0.07, wt=0.04, nail_h=0.09,
                                  nail_scale=0.5, small_nails=False, embed=0.03):
            loc.append((p, "c"))
        for (u, zz, broken) in ((DAIS_R + 0.6, DAIS_TOP + 0.9, False), (u_end - 0.6, z_end + 0.9, sign < 0 and sx < 0)):
            if sign > 0:            # v010 (F5): no +Y newels/caps - they read as extra posts on the board's far rail
                continue
            col = column_piece(3.4, 0.42, "flute", 300 + int(u) + sx, break_at=0.48 if broken else None, nseg=36)
            col.translate((sx * (STAIR_HW + 0.6), u, zz - 0.1))
            loc.append((col, "c"))
            if not broken:
                cap = _pyramid((sx * (STAIR_HW + 0.6), u), 0.55, zz - 0.1 + 3.4, 0.75)
                loc.append((cap, "z"))
            else:                                                     # snapped newel top lying beside it
                fall = column_piece(3.4, 0.42, "flute", 301, nseg=36)
                fall.V = fall.V[:, [2, 1, 0]] * np.array([1, 1, 1])
                fall.fix_orientation()
                fall.V = fall.V @ Rz(25).T
                fall.translate((sx * (STAIR_HW + 3.2), u - 1.5, z_end - 0.5))
                loc.append((fall, "c"))
    Rm = np.eye(3) if sign > 0 else Rz(180)
    for pc, b in loc:
        pc.V = pc.V @ Rm.T
        {"c": Bc, "b": Br, "z": Bb}[b].add(pc)
    report.setdefault("stairs", []).append({"side": "+Y" if sign > 0 else "-Y", "steps": n_st, "rise_m": STAIR_RISE,
                                            "run_m": STAIR_RUN, "width_m": 2 * STAIR_HW, "top_z": DAIS_TOP,
                                            "bottom_z": round(z_end, 2), "length_m": round(u_end - DAIS_R, 2)})


def _extrude_x(prof_yz, x0, x1):
    """Closed (y,z) polygon extruded along x."""
    P = np.asarray(prof_yz, float)
    n = len(P)
    V = [(x0, y, z) for y, z in P] + [(x1, y, z) for y, z in P]
    F = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)] + [list(range(n))[::-1], [n + i for i in range(n)]]
    pc = A.Piece(np.array(V), F)
    pc.fix_orientation()
    return pc


def _pyramid(cxy, b, z0, h, chamfer=0.06):
    oc = lambda bb, c: np.array([(bb, bb - c), (bb - c, bb), (-(bb - c), bb), (-bb, bb - c), (-bb, -(bb - c)),
                                 (-(bb - c), -bb), (bb - c, -bb), (bb, -(bb - c))])
    r0, r1 = oc(b, chamfer * b), oc(0.06 * b, 0.02 * b)
    V = np.concatenate([np.c_[r0, np.full(8, z0)], np.c_[r0, np.full(8, z0 + 0.08 * h)], np.c_[r1, np.full(8, z0 + h)]])
    V[:, 0] += cxy[0]
    V[:, 1] += cxy[1]
    F = []
    for j in range(2):
        for i in range(8):
            F.append([j * 8 + i, j * 8 + (i + 1) % 8, (j + 1) * 8 + (i + 1) % 8, (j + 1) * 8 + i])
    F += [list(range(8))[::-1], [16 + i for i in range(8)]]
    pc = A.Piece(V, F)
    pc.fix_orientation()
    return pc


# ----------------------------------------------------------------------------- stairs to nowhere
def stair_fragment(nsteps, w, rise, run, seed):
    rr = np.random.default_rng(seed)
    out = []
    slab = A.make_block((w / 2 + 0.6, (nsteps * run) / 2 + 1.0, 0.8), rb=0.05, step=1.0, chips=4, chip_scale=4, rng=rr,
                        center=(0, (nsteps * run) / 2, -0.8), noise_amp=0.01, seed=seed)
    out.append(slab)
    for k in range(nsteps):
        if rr.uniform() < 0.12:
            continue
        out.append(A.make_block((w / 2, run / 2 + 0.05, (k + 1) * rise / 2), rb=0.03, step=0.9, chips=2,
                                chip_scale=3, rng=rr, center=(0, k * run + run / 2, (k + 1) * rise / 2),
                                noise_amp=0.006, seed=seed + k))
    return out


# ----------------------------------------------------------------------------- colossal gate (local, base z=0)
def gate_pieces(collapsed=False):
    out_c, out_z = [], []
    rr = np.random.default_rng(77)
    W_IN, W_OUT, DEP, H_P = 5.0, 12.0, 3.5, 21.0
    # piers in ashlar courses (the +x pier loses its top two courses = ruin)
    for sx in (-1, 1):
        cx = sx * 0.5 * (W_IN + W_OUT)
        ex = 0.5 * (W_OUT - W_IN)
        out_c.append(A.make_block((ex + 0.45, DEP + 0.45, 0.9), rb=0.08, step=1.4, chips=4, chip_scale=7, rng=rr,
                                  center=(cx, 0, 0.9), noise_amp=0.02, seed=1))
        ncour = 11 if sx < 0 else 10
        for k in range(ncour):
            z0 = 1.8 + k * (H_P - 1.8) / 11
            hh = (H_P - 1.8) / 11
            off = 0.0 if sx < 0 else (0.0 if k < 7 else rr.uniform(0.2, 0.7))
            out_c.append(A.make_block((ex - 0.01, DEP - 0.01, hh / 2 - 0.02), rb=0.07, step=1.4, chips=3,
                                      chip_scale=7, rng=rr, center=(cx + off, off * 0.5, z0 + hh / 2),
                                      noise_amp=0.015, seed=10 + k + (sx > 0) * 40,
                                      fracture_top=(lambda x, y: 0.4 * np.sin(x * 1.3) - 0.3) if (sx > 0 and k == ncour - 1) else None, frac_step=0.5))
        # engaged twisted columns, front and back
        for sy in (-1, 1):
            col = column_piece(15.0, 1.0, "twist", 500 + sx * 3 + sy, nseg=30)
            col.translate((sx * (W_IN + 1.3), sy * (DEP + 0.55), 1.8))
            out_c.append(col)
    # spandrel above the arch (arch: centre z 13, radius W_IN)
    arc = [(W_IN * math.cos(a), 13.0 + W_IN * math.sin(a)) for a in np.linspace(math.pi, 0.0, 25)]
    spand = [(-W_IN, H_P)] + arc + [(W_IN, H_P)]
    sp = _extrude_y(spand, -DEP, DEP)
    out_c.append(sp)
    # ribbed tunnel (Sirene) inside the opening
    rib = fillet([(W_IN - 0.55, -0.32), (W_IN + 0.05, -0.32), (W_IN + 0.05, 0.32), (W_IN - 0.55, 0.32)],
                   [0.12, 0, 0, 0.12], 2)
    for d in np.linspace(-DEP + 0.6, DEP - 0.6, 6):
        pc = A.sweep_sector([(r, z) for r, z in rib], 0.0, math.pi, 26)
        pc.V = np.stack([pc.V[:, 0], pc.V[:, 2] + d, 13.0 + pc.V[:, 1]], 1)
        pc.fix_orientation()
        out_c.append(pc)
    # front archivolt: 4 stepped bands (splayed portal); outermost broken on the +x side
    bands = [(W_IN, W_IN + 0.75, 0.30), (W_IN + 0.75, W_IN + 1.5, 0.55), (W_IN + 1.5, W_IN + 2.3, 0.80),
             (W_IN + 2.3, W_IN + 3.1, 1.05)]
    for sy in (-1, 1):
        for bi, (r0, r1, pr) in enumerate(bands if sy < 0 else bands[1::2]):
            prof = fillet([(r0, 0.0), (r1, 0.0), (r1, pr), (r0, pr)], [0, 0.15, 0.15, 0], 2)
            a0 = 0.0 if not (sy < 0 and bi == 3) else math.radians(38)
            pc = A.sweep_sector([(r, z) for r, z in prof], a0, math.pi, 30)
            pc.V = np.stack([pc.V[:, 0], sy * (DEP - 0.1 + pc.V[:, 2]), 13.0 + pc.V[:, 1]], 1)
            pc.fix_orientation()
            out_c.append(pc)
        # nailheads on the outer band (board language)
        rm = W_IN + 2.7
        for a in np.linspace(0.12, math.pi - 0.12, 13):
            if sy < 0 and a < math.radians(40):
                continue
            O = np.array([rm * math.cos(a), sy * (DEP - 0.1 + 1.05), 13.0 + rm * math.sin(a)])
            Uv = np.array([-math.sin(a), 0, math.cos(a)])
            Vv = np.array([math.cos(a), 0, math.sin(a)])
            out_c.append(A.nailhead(0, 0, 0.28, 0.28, 0.3, A.map_plane(O, Uv, Vv, (0, sy, 0)), embed=0.05, flat=0.15))
    if collapsed:
        # v006: the entablature, frieze, attic and crown have FALLEN - the ribbed ring-arch is the crown now.
        # Big fallen entablature blocks (with the lozenge frieze) lie half-buried at the foot, among the plates.
        fallen = []
        for k in range(7):
            ex_, ey_, ez_ = rr.uniform(2.2, 3.6), rr.uniform(1.6, 2.4), rr.uniform(1.0, 1.5)
            b = A.make_block((ex_, ey_, ez_), rb=0.08, step=1.2, chips=4, chip_scale=7, rng=rr, center=(0, 0, 0),
                             noise_amp=0.02, seed=200 + k)
            mp = A.map_plane((0, -ey_, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
            parts = [b] + A.lozenge_frieze(-ex_ + 0.2, ex_ - 0.2, -0.75 * ez_, 0.75 * ez_, 2, mp, h=0.14, wb=0.14,
                                           wt=0.08, nail_h=0.2, nail_scale=0.5, small_nails=False, embed=0.05)
            b = A.merge_pieces(parts)
            b.V = b.V @ A.rot_euler(rr.uniform(-35, 35), rr.uniform(-35, 35), rr.uniform(0, 360)).T
            fallen.append((b, (rr.choice([-1.0, 1.0]) * rr.uniform(10, 16), rr.uniform(-8, 4))))   # beside, not in front
        return out_c, out_z, fallen
    # entablature (left part intact, right end fractured), lozenge frieze both faces, cornice, attic, bronze crown
    xr = 4.0                       # entablature broken off above the arch crown (right pier lost its top course)
    jag = lambda a, b: 0.6 * np.sin(a * 2.1 + b * 1.7) + 0.4 * np.sin(b * 3.3)
    for (ex0, ey, z0, z1) in ((12.6, DEP + 0.4, H_P, H_P + 1.6), (12.2, DEP + 0.1, H_P + 1.6, H_P + 4.0),
                              (13.0, DEP + 0.8, H_P + 4.0, H_P + 5.0)):
        xl = -ex0
        cx = 0.5 * (xl + xr)
        out_c.append(A.make_block((0.5 * (xr - xl), ey, 0.5 * (z1 - z0)), rb=0.08, step=1.2, chips=3, chip_scale=6,
                                  rng=rr, center=(cx, 0, 0.5 * (z0 + z1)), noise_amp=0.015, seed=int(z0 * 10),
                                  face_noise=[(0, 1, jag)]))
    for sy in (-1, 1):
        mp = A.map_plane((0, sy * (DEP + 0.1), H_P + 2.8), (1, 0, 0), (0, 0, 1), (0, sy, 0))
        for p in A.lozenge_frieze(-11.8, -11.8 + 9 * 1.6, -0.85, 0.85, 9, mp, h=0.16, wb=0.16, wt=0.09,
                                  nail_h=0.22, nail_scale=0.5, small_nails=True, embed=0.05):
            out_c.append(p)
    out_c.append(A.make_block((5.0, 2.6, 0.8), rb=0.06, step=1.2, chips=2, chip_scale=5, rng=rr,
                              center=(-1.5, 0, H_P + 5.8), noise_amp=0.01, seed=99))
    out_z.append(_pyramid((-1.5, 0.0), 2.6, H_P + 6.6, 4.6))
    # fallen blocks (from the broken +x top) lie on the ground in front, tilted
    fallen = []
    for k in range(6):
        b = A.make_block((rr.uniform(1.2, 2.2), rr.uniform(1.0, 1.8), rr.uniform(0.7, 1.0)), rb=0.07, step=1.0,
                         chips=4, chip_scale=6, rng=rr, center=(0, 0, 0), noise_amp=0.02, seed=200 + k)
        b.V = b.V @ A.rot_euler(rr.uniform(-30, 30), rr.uniform(-30, 30), rr.uniform(0, 360)).T
        fallen.append((b, (rr.uniform(9, 17), rr.uniform(-11, -4))))
    return out_c, out_z, fallen


def _extrude_y(prof_xz, y0, y1):
    P = np.asarray(prof_xz, float)
    n = len(P)
    V = [(x, y0, z) for x, z in P] + [(x, y1, z) for x, z in P]
    F = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)] + [list(range(n))[::-1], [n + i for i in range(n)]]
    pc = A.Piece(np.array(V), F)
    pc.fix_orientation()
    return pc


# ----------------------------------------------------------------------------- stream fragments library
def tile_piece_lo(half=False):
    e, h, rb = 1.115, 0.41, 0.08
    a = e - rb
    xs = np.array([-e, -a - 0.04, -a, 0.0, a, a + 0.04, e])
    zs = np.array([-h, -rb, -0.03, 0.0])
    V, Q = A.box_surface(xs, xs, zs)
    q = V.copy()
    q[:, 0] = np.clip(V[:, 0], -a, a)
    q[:, 1] = np.clip(V[:, 1], -a, a)
    q[:, 2] = np.minimum(V[:, 2], -rb)
    d = V - q
    L = np.power(np.sum(np.power(np.abs(d), 1.35), 1), 1 / 1.35)
    m = L > 1e-9
    V[m] = q[m] + d[m] / L[m, None] * rb
    pc = A.Piece(V, Q)
    pc.fix_orientation()
    if half:                                   # snapped tile: jagged cut across
        cut = pc.V[:, 0] > 0.0
        pc.V[cut, 0] = 0.05 + 0.18 * np.sin(pc.V[cut, 1] * 4.0) + 0.08 * np.sin(pc.V[cut, 2] * 9.0)
    pc.V[:, 2] += h / 2
    return pc


def rock_chunk(seed, size=(1.0, 0.8, 0.6), flat=False):
    rr = np.random.default_rng(seed)
    pc = A.rubble_chunk((0, 0, 0), size, rr, seed)
    if flat:
        top = pc.V[:, 2] > 0.25 * size[2]
        pc.V[top, 2] = 0.55 * size[2]
    return pc


def shard_piece(seed, cls):
    """v006 stream shard: a Voronoi-like broken piece of ancient paving WITH real thickness - irregular star-convex
    outline, chamfered and chipped top arrises (mat 0 = weathered paving top), jagged fracture walls and a rough
    tapering obsidian underside (mat 1).  Unit size ~1 m across.  cls: 'L' thin slab, 'M' thick, 'S' chunky."""
    rr = np.random.default_rng(seed)
    n = int(rr.integers(5, 8))
    ang = np.sort(rr.uniform(0, 2 * math.pi, n))
    rad = rr.uniform(0.33, 0.6, n)
    P = ccw(np.stack([rad * np.cos(ang), rad * np.sin(ang)], 1))
    P = resample(P, 0.09)
    m = len(P)
    t = {"L": 0.26, "M": 0.42, "S": 0.62}[cls] * rr.uniform(0.85, 1.2)
    rings = [(0.965, 0.0, 0.0), (1.0, -0.035, 0.0), (1.0 + 0.0, -0.45 * t, 0.05), (0.96, -t, 0.07),
             (0.72, -1.25 * t, 0.09), (0.40, -1.55 * t, 0.08)]
    c = P.mean(0)
    V, F, fm = [], [], []
    for k, (sc, z, na) in enumerate(rings):
        Q = c + (P - c) * sc
        if na > 0:
            nz = A.fbm3(np.c_[Q * 3.0, np.full(m, k * 1.3 + seed % 7)], 1.0, 2, seed=k + seed % 50)
            Q = Q + (Q - c) * (nz * na * 2.0)[:, None]
        zz = np.full(m, z) + (A.fbm3(np.c_[Q * 4.0, np.full(m, k)], 1.0, 2, seed=seed % 31) * 0.06 * t if k >= 2 else 0.0)
        for q, zv in zip(Q, zz):
            V.append((q[0], q[1], zv))
    for k in range(len(rings) - 1):
        for i in range(m):
            j = (i + 1) % m
            F.append([k * m + i, k * m + j, (k + 1) * m + j, (k + 1) * m + i])
            fm.append(0 if k == 0 else 1)
    F.append(list(range(m)))
    fm.append(0)
    F.append([(len(rings) - 1) * m + i for i in range(m)][::-1])
    fm.append(1)
    pc = A.Piece(np.array(V), F, fm)
    pc.fix_orientation()
    for _ in range(int(rr.integers(2, 5))):                         # chipped arrises on the top edge
        i = int(rr.integers(m))
        p0 = np.array([P[i, 0], P[i, 1], -0.01])
        nv = A.normalize(np.array([P[i, 0] - c[0], P[i, 1] - c[1], 0.0]) + np.array([0, 0, 0.9]) + rr.normal(0, 0.2, 3))
        dep = rr.uniform(0.03, 0.07)
        A.chip(pc.V, p0, nv, dep, dep * 3.2)
    pc.V[:, 2] += 0.6 * t                                          # roughly centred
    return pc


def drum_piece(seed):
    prof = [(0, 0), (0.62, 0), (0.62, 0.12), (0.7, 0.2), (0.7, 0.32), (0.6, 0.4), (0.58, 1.2), (0.68, 1.3),
            (0.68, 1.42), (0.58, 1.5), (0, 1.5)]
    pc = A.lathe(prof, 20, lambda Rr, th, Z, k: (Rr * (1 + 0.05 * np.cos(14 * th)), Z))
    pc.V[:, 2] -= 0.75
    top = pc.V[:, 2] > 0.6
    pc.V[top, 2] = 0.6 + A.fbm3(pc.V[top] * 2.0, 1.0, 2, seed=seed) * 0.25
    return pc


def frieze_block(seed):
    rr = np.random.default_rng(seed)
    out = [A.make_block((1.2, 0.5, 0.6), rb=0.04, step=0.6, chips=3, chip_scale=3, rng=rr, center=(0, 0, 0),
                        noise_amp=0.006, seed=seed)]
    mp = A.map_plane((0, -0.5, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    out += A.lozenge_frieze(-1.1, 1.1, -0.38, 0.38, 2, mp, h=0.06, wb=0.06, wt=0.035, nail_h=0.08, nail_scale=0.5,
                            small_nails=False, embed=0.02)
    return A.merge_pieces(out)


# ----------------------------------------------------------------------------- build
R.reset_scene()
sc = bpy.context.scene
root = bpy.data.collections.new(ASSET)
sc.collection.children.link(root)
cols = {}
for k in ("Fringe", "Plates", "Stairs", "Stream", "Monument", "PillarField"):
    c = bpy.data.collections.new(f"{ASSET}_{k}")
    root.children.link(c)
    cols[k] = c

m_check = mat_checker_top()
m_pave = mat_paving()
m_carv = mat_carved()
m_carv_dark = mat_carved(dark=True)
m_bas = mat_obsidian()            # locked palette: obsidian-dark plate undersides, roots, raw rock fragments
m_bron = mat_bronze()
m_tl, m_td = mat_loose_tile(True), mat_loose_tile(False)

# plates
B_fr, B_pv = Bucket(), Bucket()
build_plates(B_fr, B_pv, REPORT)
ob_fr = B_fr.build(f"{ASSET}_Fringe_CheckerPlates", cols["Fringe"], [m_check, m_pave, m_bas])

# processional stairs (+Y, -Y) and stairs-to-nowhere
B_sc, B_sr, B_sz = Bucket(), Bucket(), Bucket()
build_stair(+1, B_sc, B_sr, B_sz, REPORT)
build_stair(-1, B_sc, B_sr, B_sz, REPORT)
NOWHERE = [((-36.0, -14.0), -2.6, 62.0, 24.0, 9, 1001), ((26.0, -14.5), -0.8, 200.0, -16.0, 8, 1002),
           ((-24.0, -31.0), -2.4, 35.0, 31.0, 7, 1003)]
REPORT["stairs_to_nowhere"] = []
for (xy, zb, yaw, tilt, nst, sd) in NOWHERE:
    parts = stair_fragment(nst, 4.4, 0.45, 0.9, sd)
    Rm = Rz(yaw) @ A.rot_axis((1, 0, 0), tilt)
    for p in parts:
        piece_transform(p, Rm, (xy[0], xy[1], zb))
        B_sc.add(p)
    base, pq, _ = plate_piece(ngon((0, 0), 4.2, 9, 0.3), 0.0, 0.0, "paving")
    piece_transform(base, Rz(yaw) @ A.rot_axis((1, 0, 0), tilt * 0.6), (xy[0], xy[1], zb - 1.3))
    B_pv.add(base, pq)
    REPORT["stairs_to_nowhere"].append({"xy": xy, "tilt_deg": tilt, "steps": nst})
ob_sc = B_sc.build(f"{ASSET}_Stairs_Carved", cols["Stairs"], [m_carv], curvature=True)
ob_sr = B_sr.build(f"{ASSET}_Stairs_RockMass", cols["Stairs"], [m_bas])
ob_sz = B_sz.build(f"{ASSET}_Stairs_BronzeCaps", cols["Stairs"], [m_bron], curvature=True)

# colossal gate: far skyline beneath the eclipse, tilted, half-sunk into heaving plates
gc, gz, gfall = gate_pieces(collapsed=True)
B_gc, B_gz = Bucket(), Bucket()
fwd = np.array([0 - GATE_XY[0], -30.0 - GATE_XY[1]])          # local -Y (front) faces the hero camera
fwd /= np.linalg.norm(fwd)
yaw = math.degrees(math.atan2(fwd[0], -fwd[1]))
RG = Rz(yaw) @ A.rot_axis((0, 1, 0), GATE_TILT) @ A.rot_axis((1, 0, 0), -GATE_LEAN) @ \
    np.diag([GATE_SCALE * GATE_XSTRETCH, GATE_SCALE, GATE_SCALE])
TG = np.array([GATE_XY[0], GATE_XY[1], 0.0])
for p in gc + gz:
    piece_transform(p, RG, TG)
# v006: solve the sink so the ring-arch crown sits GATE_TOP_EL_DEG above the hero camera's horizontal
# (~50 px beneath the eclipse's lower limb in the 1920x1080 hero frame)
top_now = max(float(p.V[:, 2].max()) for p in gc + gz)
d_h = math.hypot(GATE_XY[0], GATE_XY[1] + 30.0)
z_top = 9.0 + d_h * math.tan(math.radians(GATE_TOP_EL_DEG))
dz_gate = z_top - top_now
for p in gc:
    p.V[:, 2] += dz_gate
    B_gc.add(p)
for p in gz:
    p.V[:, 2] += dz_gate
    B_gz.add(p)
for (b, (fx, fy)) in gfall:
    off = Rz(yaw) @ np.array([fx * GATE_SCALE * GATE_XSTRETCH, fy * GATE_SCALE, 0.0])
    B_gc.add(piece_transform(b, np.eye(3) * GATE_SCALE, (GATE_XY[0] + off[0], GATE_XY[1] + off[1], GATE_BASE_Z - 2.0)))
B_gpl = Bucket()
build_gate_cluster(B_gpl, REPORT)
ob_gpl = B_gpl.build(f"{ASSET}_Monument_GateFoundation", cols["Monument"], [m_bas, m_pave, m_bas])
ob_gc = B_gc.build(f"{ASSET}_Monument_Gate", cols["Monument"], [m_carv_dark], curvature=True)
ob_gz = B_gz.build(f"{ASSET}_Monument_GateCrown", cols["Monument"], [m_bron], curvature=True)
gv = np.array([v.co[:] for v in ob_gc.data.vertices])
CROWN_TOP = gv[np.argmax(gv[:, 2])]
_gp = np.array([hero_px(p)[:2] for p in gv[gv[:, 2] > GATE_BASE_Z][::7]])
GATE_PX_BBOX = [round(float(_gp[:, 0].min())), round(float(_gp[:, 1].min())), round(float(_gp[:, 0].max())), round(float(_gp[:, 1].max()))]
GATE_SINK = round(-(dz_gate - GATE_BASE_Z), 1)
REPORT["gate"] = {"xy": GATE_XY, "yaw_deg": round(yaw, 1), "tilt_deg": GATE_TILT, "lean_deg": GATE_LEAN,
                  "base_z": round(float(dz_gate), 1), "scale": GATE_SCALE, "collapsed": True,
                  "standing_height_m": round(21.1 * GATE_SCALE, 1), "width_m": round(24.8 * GATE_SCALE * GATE_XSTRETCH, 1), "x_stretch": GATE_XSTRETCH,
                  "visible_top_z": round(float(gv[:, 2].max()), 2), "px_bbox_above_ground_uvUV": GATE_PX_BBOX,
                  "crown_px": [round(float(v), 1) for v in hero_px(CROWN_TOP)[:2]],
                  "eclipse_px": [round(float(v), 1) for v in hero_px(ECLIPSE_C)[:2]] +
                                [round(HERO_F * ECLIPSE_R / float(hero_px(ECLIPSE_C)[2]), 1)]}
ob_pv = B_pv.build(f"{ASSET}_Plates_Paving", cols["Plates"], [m_pave, m_pave, m_bas])

# pillar field: 6 unique broken columns, 12 instances (linked duplicates) + carved pedestals with rock roots
uniq = []
# v006: fluted / twisted Sirene columns, all SNAPPED MID-SHAFT (no ringed "pipes", no squat "barrel" stumps)
for i, (style, h, br) in enumerate((("flute", 14.0, 0.58), ("flute", 15.0, 0.47), ("twist", 13.5, 0.62),
                                    ("flute", 13.0, 0.68), ("twist", 14.5, 0.50), ("flute", 15.5, 0.55))):
    pc = column_piece(h, 0.95, style, 900 + i, break_at=br, nseg=48)
    bk = Bucket()
    bk.add(pc)
    o = bk.build(f"{ASSET}_Pillar_U{i}", cols["PillarField"], [m_carv], curvature=True)
    uniq.append(o)


def carved_plinth(x, y, z0, rr):
    """square carved column base: moulded block with a lozenge + nailhead relief on each face."""
    e, hgt = 1.55, 1.3
    out = [A.make_block((e, e, hgt / 2), rb=0.06, step=0.6, chips=3, chip_scale=3, rng=rr,
                        center=(x, y, z0 + hgt / 2), noise_amp=0.01, seed=int(rr.integers(9999))),
           A.make_block((e + 0.12, e + 0.12, 0.14), rb=0.05, step=0.8, chips=2, chip_scale=3, rng=rr,
                        center=(x, y, z0 + 0.14), noise_amp=0.0, seed=int(rr.integers(9999)))]
    for nrm, U in (((1, 0, 0), (0, 1, 0)), ((-1, 0, 0), (0, 1, 0)), ((0, 1, 0), (1, 0, 0)), ((0, -1, 0), (1, 0, 0))):
        O = np.array([x, y, z0 + 0.72]) + np.array(nrm, float) * e
        mp = A.map_plane(O, U, (0, 0, 1), nrm)
        out.append(A.stroke([(-0.95, 0), (0, -0.34), (0.95, 0), (0, 0.34)], mp, 0.05, 0.03, 0.05, 0.01, closed=True))
        out.append(A.nailhead(0, 0, 0.26, 0.17, 0.07, mp, embed=0.01, flat=0.14))
    return out


pts = []
B_ped = Bucket()
tries = 0
while len(pts) < 9 and tries < 4000:
    tries += 1
    x, y = rng.uniform(PILLAR_BOX[0], PILLAR_BOX[1]), rng.uniform(PILLAR_BOX[2], PILLAR_BOX[3])
    if pts and min(math.hypot(x - a, y - b) for a, b in pts) < 4.6:
        continue
    pts.append((x, y))
REPORT["pillars"] = []
for k, (x, y) in enumerate(pts):
    zt = 0.2 if y > 7.0 else z_base(math.hypot(x, y)) + rng.uniform(-0.3, 0.8)
    ped, pq, _ = plate_piece(ngon((x, y), 2.0, 8, rng.uniform(0, 1)), zt, 0.0, "paving")
    tl = rng.uniform(4, 22)
    dd = rng.normal(0, 1, 2)
    tl = rng.uniform(3, 16)
    ped.V, _, _ = lift_transform(ped.V, np.array([x, y]), dd, tl * 0.3, zt, 0.0, ngon((x, y), 2.0, 8))
    B_ped.add(ped, pq)
    ax = np.array([dd[1], -dd[0], 0.0]) / max(np.linalg.norm(dd), 1e-6)
    mrot = Matrix.Rotation(math.radians(tl), 4, Vector(ax)) @ Matrix.Rotation(rng.uniform(0, 6.283), 4, "Z")
    zp = zt - 0.25
    for pc in carved_plinth(0.0, 0.0, 0.0, rng):                   # plinth tilts with its column
        pc.V = pc.V @ np.array(mrot.to_3x3()).T + np.array([x, y, zp])
        B_ped.add(pc)
    src = uniq[k % len(uniq)]
    ob = bpy.data.objects.new(f"{ASSET}_Pillar_{k:02d}", src.data)
    cols["PillarField"].objects.link(ob)
    sc_ = rng.uniform(0.85, 1.1)
    top = mrot @ Matrix.Translation((0, 0, 1.15))
    ob.matrix_world = Matrix.Translation((x, y, zp)) @ top @ Matrix.Diagonal((sc_, sc_, sc_, 1))
    REPORT["pillars"].append({"xy": [round(x, 1), round(y, 1)], "tilt_deg": round(tl, 1), "scale": round(sc_, 2),
                              "src": src.name})
for o in uniq:                                   # the sources become instances 0..5 themselves -> hide originals
    bpy.data.objects.remove(o)
ob_ped = B_ped.build(f"{ASSET}_PillarField_Pedestals", cols["PillarField"], [m_pave, m_pave, m_bas])

# the stream (v006): FRACTURED PAVING SHARDS rising BEHIND THE SKULL, then arcing around the eclipse with >= 0.35 R
# clearance. Designed in hero-frame pixels (1920x1080) and back-projected to world depth planes; shard size tapers
# from ~60-90 px low to ~5-15 px high; only 3 loose checker tiles.
lib = {}
SH = {"L": [], "M": [], "S": []}
for cls, base in (("L", 4100), ("M", 4200), ("S", 4300)):
    for vv in range(6):
        pc = shard_piece(base + vv, cls)
        me = bpy.data.meshes.new(f"{ASSET}_StreamShard_{cls}{vv}")
        me.from_pydata(pc.V.tolist(), [], pc.F)
        me.materials.append(m_pave)
        me.materials.append(m_bas)
        me.polygons.foreach_set("material_index", np.clip(np.asarray(pc.fm, np.int32), 0, 1))
        me.validate(clean_customdata=False)
        me.update()
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(32))
        SH[cls].append(me)
for name, pc, mat in (("TileD", tile_piece_lo(False), m_td), ("HalfL", tile_piece_lo(True), m_tl),
                      ("TileL", tile_piece_lo(False), m_tl)):
    me = bpy.data.meshes.new(f"{ASSET}_StreamLib_{name}")
    me.from_pydata(pc.V.tolist(), [], pc.F)
    me.materials.append(mat)
    me.validate()
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    lib[name] = me
B_sl = Bucket()
inst = []
ecu, ecv, ecz = hero_px(ECLIPSE_C)
ecR = HERO_F * ECLIPSE_R / ecz
# v010 (critic F8 on main v016): root in TORN FLOOR PLATES behind the skull's right flank (not the cranium), a
# braided 3->1 strand torrent, ~3:1 size taper, uneven spacing, many specks, upper chunks hazed, off the disc.
# Path in 1920x1080 hero pixels (u, v, world depth y), measured against the real v016 skull (px 550-920 x 291-640).
# v010b: rooted LEFT-behind the skull (the right-flank corridor is closed by the skull bbox + 0.35R disc rule),
# arcing OVER the skull's crown (never inside its px box) and up the eclipse's left side.
# v010c (coordinator: the sky agent builds the broken celestial ring fragments at ~1.4-2.6R): the stream is the
# LOWER part of that system - it arcs over the skull and ENDS / dissolves at ~1.45R off the disc's left/lower-left,
# where the lowest ring fragment sits.  No ring arcs are built here.
PATH = np.array([(500.0, 440.0, 64.0), (515.0, 352.0, 65.0), (560.0, 285.0, 67.0), (630.0, 238.0, 69.0),
                 (705.0, 216.0, 71.0), (770.0, 226.0, 74.0), (812.0, 252.0, 77.0)])
seg = np.linalg.norm(np.diff(PATH[:, :2], axis=0), axis=1)
cum = np.concatenate([[0.0], np.cumsum(seg)])


def path_at(t):
    s_ = t * cum[-1]
    i = int(np.clip(np.searchsorted(cum, s_) - 1, 0, len(seg) - 1))
    f = (s_ - cum[i]) / max(seg[i], 1e-6)
    q = PATH[i] + (PATH[i + 1] - PATH[i]) * f
    tg = (PATH[i + 1, :2] - PATH[i, :2]) / max(seg[i], 1e-6)
    return q, tg


def clear_of_targets(p, px_size):
    cu, cv, cz = hero_px(p)
    clr = (math.hypot(cu - ecu, cv - ecv) - 0.5 * px_size - ecR) / ecR
    skull = 545 < cu + 0.4 * px_size and cu - 0.4 * px_size < 925 and cv + 0.4 * px_size > 285   # keep off the cranium
    return clr, (clr >= 0.35 and not blocks_hero_targets(p, pad=0.5) and not skull)


# 1) torn root plates: thick weathered paving lifting off the ground behind the skull, tilted toward edge-on
ROOT_PX = [(468.0, 445.0, 62.0, 70, 30), (510.0, 430.0, 64.0, 62, -15), (548.0, 452.0, 63.0, 76, 55),
           (492.0, 470.0, 67.0, 56, 100)]
ROOT_PLATES = []
for k, (u_, v_, y_, tilt, yaw_) in enumerate(ROOT_PX):
    ptop = hero_unpx(u_, v_, y_)
    size = float(np.clip((ptop[2] + 0.5) / math.sin(math.radians(tilt)) * 1.2, 8.0, 15.0))
    Q = ngon((0, 0), size * 0.5, 6, 0.3 + k) * np.array([1.0, 0.62]) + rng.normal(0, 0.08 * size, (6, 2))
    pc, pq, _ = plate_piece(Q, 0.0, 0.0, "paving", thin=True)
    pq[:, :2] += ptop[:2]
    pc.V = pc.V @ (Rz(yaw_) @ A.rot_axis((1, 0, 0), tilt)).T
    pc.V += np.array([ptop[0], ptop[1], ptop[2] - pc.V[:, 2].max()])     # top edge at the designed pixel
    B_sl.add(pc, pq)
    ROOT_PLATES.append((float(ptop[0]), float(ptop[1]), round(size, 1), tilt, yaw_))
REPORT["stream_root_plates"] = ROOT_PLATES
# 2) braided chunks with a 3:1 taper, 3) specks, 4) three loose tiles
n_tiles, n_rej, minclr = 0, 0, 9e9
sz_low, sz_high, n_chunks, n_specks = [], [], 0, 0
haze_lo, haze_mid, haze_hi = mat_shard_haze(0.35), mat_shard_haze(0.65), mat_shard_haze(1.0)
plan = [("chunk", None)] * 60 + [("speck", None)] * 110 + [("tile", i) for i in range(3)]
for k, (kind, ti) in enumerate(plan):
    if kind == "tile":
        t = 0.18 + 0.14 * ti + rng.uniform(-0.03, 0.03)
    elif kind == "chunk":
        t = float(rng.uniform() ** 1.2)                           # thinning out upward
    else:
        t = float(0.25 + 0.80 * rng.uniform())
    q, tg = path_at(min(t, 1.0))
    nrm2 = np.array([-tg[1], tg[0]])
    if kind == "speck":
        px = rng.uniform(3.0, 8.0)
        lat = rng.normal(0, 26.0 * (1 - 0.5 * t) + 10.0)
    else:
        px = (46.0 - 31.0 * t) * rng.uniform(0.8, 1.2)            # ~45 px low -> ~15 px high (3:1)
        strands = 3 if t < 0.35 else (2 if t < 0.7 else 1)
        si = int(rng.integers(strands)) - (strands - 1) / 2.0
        sep = 26.0 * (1 - t) + 8.0
        lat = si * sep * math.cos(2 * math.pi * 1.4 * t + si) + rng.normal(0, 5.0)
    uv = q[:2] + nrm2 * lat + tg * rng.normal(0, 7.0)
    yd = q[2] + rng.normal(0, 2.0)
    p = hero_unpx(uv[0], uv[1], yd)
    cz = hero_px(p)[2]
    clr, ok = clear_of_targets(p, px)
    if not ok:
        n_rej += 1
        continue
    if kind == "tile":
        me, s = lib[["TileD", "HalfL", "TileL"][ti]], 1.0
        n_tiles += 1
        nm = "Tile"
    else:
        cls = "L" if (px > 34 or (kind == "chunk" and t < 0.15)) else ("M" if px > 16 else "S")
        me = SH[cls][int(rng.integers(6))]
        s = px * cz / HERO_F
        nm = ("Chunk" if kind == "chunk" else "Speck") + cls
    ob = bpy.data.objects.new(f"{ASSET}_Stream_{k:03d}_{nm}", me)
    cols["Stream"].objects.link(ob)
    ob.location = tuple(float(v) for v in p)
    if kind == "chunk" and t < 0.15:                              # lowest pieces: thin slabs lifting off, near edge-on
        ob.rotation_euler = (math.radians(rng.uniform(55, 85)) * (1 if rng.uniform() < 0.5 else -1),
                             math.radians(rng.uniform(-15, 15)), float(rng.uniform(0, 6.283)))
    else:
        ob.rotation_euler = tuple(float(v) for v in rng.uniform(0, 6.283, 3))
    ob.scale = (s, s, s)
    if kind != "tile" and (t > 0.35 or kind == "speck"):          # graded aerial haze on the upper / small pieces
        hm = haze_hi if (t > 0.75 or kind == "speck") else (haze_mid if t > 0.55 else haze_lo)
        for slot in ob.material_slots:
            slot.link = "OBJECT"
            slot.material = hm
    inst.append(ob)
    minclr = min(minclr, clr)
    if kind == "chunk":
        n_chunks += 1
        (sz_low if t < 0.2 else sz_high if t > 0.8 else []).append(px)
    elif kind == "speck":
        n_specks += 1
REPORT["stream"] = {"design": "v010 braided torrent rooted in torn plates left-behind the skull, over its crown, ending at ~1.45R lower-left of the disc (sky agent ring fragments take over there)",
                    "path_px": [[round(float(a), 1) for a in r] for r in PATH],
                    "eclipse_px_R": [round(ecu, 1), round(ecv, 1), round(ecR, 1)], "chunks": n_chunks,
                    "specks": n_specks, "loose_checker_tiles": n_tiles, "root_plates": len(ROOT_PLATES),
                    "rejected": n_rej, "min_clearance_over_R": round(minclr, 3),
                    "chunk_px_low_t<0.2": [round(min(sz_low), 1), round(float(np.mean(sz_low)), 1), round(max(sz_low), 1)] if sz_low else None,
                    "chunk_px_high_t>0.8": [round(min(sz_high), 1), round(float(np.mean(sz_high)), 1), round(max(sz_high), 1)] if sz_high else None}
ob_sl = B_sl.build(f"{ASSET}_Stream_RootPlates", cols["Stream"], [m_pave, m_pave, m_bas])
for o in (ob_fr, ob_pv, ob_ped, ob_sl):
    if o:
        try:
            M.bake_curvature(o)
        except Exception as ex:
            print("curv", o.name, ex)

# ----------------------------------------------------------------------------- verification
bpy.context.view_layer.update()
asset_objs = [o for o in root.all_objects if o.type == "MESH"]
dg = bpy.context.evaluated_depsgraph_get()
tris_r, tris_u, seen = 0, 0, set()
minr, in_board, above_ring = 1e9, 0, 0
per = {}
for o in asset_objs:
    me = o.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    o.evaluated_get(dg).to_mesh_clear()
    tris_r += nt
    if o.data.name not in seen:
        tris_u += nt
        seen.add(o.data.name)
    fam = o.users_collection[0].name.replace(ASSET + "_", "")
    per[fam] = per.get(fam, 0) + nt
    co = np.empty(len(o.data.vertices) * 3, np.float32)
    o.data.vertices.foreach_get("co", co)
    W = co.reshape(-1, 3) @ np.array(o.matrix_world)[:3, :3].T + np.array(o.matrix_world)[:3, 3]
    rr_ = np.hypot(W[:, 0], W[:, 1])
    minr = min(minr, float(rr_.min()))
    in_board += int(((np.abs(W[:, 0]) < 11.0) & (np.abs(W[:, 1]) < 11.0)).sum())
    above_ring += int(((rr_ < DAIS_R - 0.05) & (W[:, 2] > DAIS_TOP + 0.05)).sum())
mn, mx = R.bounds(asset_objs)
REPORT["verify"] = {"tris_rendered": int(tris_r), "tris_unique_meshes": int(tris_u), "tris_by_family": per,
                    "objects": len(asset_objs), "min_radius_any_vertex_m": round(minr, 3),
                    "verts_inside_board_box_11m": in_board, "verts_inside_dais_ring_above_dais_top": above_ring,
                    "bounds": [[round(v, 1) for v in mn], [round(v, 1) for v in mx]]}
print("VERIFY", json.dumps(REPORT["verify"], indent=1), flush=True)

blend = os.path.join(ADIR, f"{ASSET}_v{args.ver:03d}.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
REPORT["blend"] = blend
R.write_json(os.path.join(ADIR, "meta.json"), {
    "asset": ASSET, "version": args.ver, "blend": os.path.basename(blend), "units": "world metres (NOT env-scaled)",
    "origin": "board centre; identity transforms; append at world origin together with CFCL_Board_Arena",
    "collections": [c.name for c in root.children], "verify": REPORT["verify"],
    "layout": {k: REPORT.get(k) for k in ("plates", "stairs", "stairs_to_nowhere", "gate", "pillars", "stream")},
    "materials": sorted({m.name for o in asset_objs for m in o.data.materials if m}),
    "lod": "LOD0 only; procedural materials - bake before runtime/GLB export"})
print("SAVED", blend, flush=True)


# ----------------------------------------------------------------------------- preview context (not saved)
def clay(name, col=(0.2, 0.2, 0.2), emis=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = 0.85
    if emis:
        b.inputs["Emission Color"].default_value = (*emis, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def prev_obj(o, col):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)
    return o


if not args.norender:
    prev = bpy.data.collections.new("PREVIEW_ONLY")
    sc.collection.children.link(prev)
    # the board v006
    with bpy.data.libraries.load(os.path.join(CL, "assets", "CFCL_Board_Arena", "CFCL_Board_Arena_v008.blend"),
                                 link=False) as (src, dst):
        dst.objects = list(src.objects)
    for o in dst.objects:
        if o is not None:
            prev.objects.link(o)
    mclay = clay("PREVIEW_Clay", (0.16, 0.15, 0.14))
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=DAIS_R, depth=4.0, location=(0, 0, DAIS_TOP - 2.0))
    o = prev_obj(bpy.context.active_object, prev)
    o.name = "PREVIEW_StandIn_Dais"
    M.assign(o, "AncientStone")
    bpy.ops.mesh.primitive_plane_add(size=560, location=(0, 70, -7.0))
    o = prev_obj(bpy.context.active_object, prev)
    o.name = "PREVIEW_Lava"
    M.assign(o, "Lava")
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1.0, location=tuple(SKULL_C))
    o = prev_obj(bpy.context.active_object, prev)
    o.scale = tuple(SKULL_RAD)
    o.name = "PREVIEW_StandIn_Skull"
    o.data.materials.append(clay("PREVIEW_SkullClay", (0.32, 0.31, 0.27)))
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=4.6, radius2=2.0, depth=23.5, location=(HAND_C[0], HAND_C[1], 11.4))
    o = prev_obj(bpy.context.active_object, prev)
    o.name = "PREVIEW_StandIn_Hand"
    o.data.materials.append(clay("PREVIEW_HandClay", (0.17, 0.2, 0.14)))
    for nm_, c_, r_ in (("SkullSeat", (-13.3, 48.1), 13.4), ("HandSeat", (16.9, 51.5), 11.5)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=r_, depth=8, location=(c_[0], c_[1], -3.7))
        o = prev_obj(bpy.context.active_object, prev)
        o.name = "PREVIEW_StandIn_" + nm_
        o.data.materials.append(mclay)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * 34.3, 47.0, -10.0))
        o = prev_obj(bpy.context.active_object, prev)
        o.scale = (28.9, 84.0, 20.6)
        o.name = "PREVIEW_StandIn_Bank"
        o.data.materials.append(mclay)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=ECLIPSE_R, depth=0.5, location=tuple(ECLIPSE_C),
                                        rotation=(math.radians(90), 0, 0))
    o = prev_obj(bpy.context.active_object, prev)
    o.name = "PREVIEW_StandIn_Eclipse"
    o.data.materials.append(clay("PREVIEW_EclipseBody", (0.01, 0.01, 0.01)))
    bpy.ops.mesh.primitive_torus_add(major_radius=ECLIPSE_R + 0.5, minor_radius=0.7, location=tuple(ECLIPSE_C + (0, 0.5, 0)),
                                     rotation=(math.radians(90), 0, 0))
    o = prev_obj(bpy.context.active_object, prev)
    o.name = "PREVIEW_StandIn_Corona"
    o.data.materials.append(clay("PREVIEW_Corona", (1, 0.6, 0.3), (1.0, 0.62, 0.32), 30.0))
    # look: warm amber haze world + standard rig
    R.setup_render(sc, "EEVEE", (1280, 720), args.samples)
    R.setup_world(sc, top=(0.10, 0.09, 0.085), horizon=(0.34, 0.26, 0.19), strength=1.0, fog_density=0.0,
                  fog_color=(0.85, 0.66, 0.48), fog_anisotropy=0.45)
    if args.fog > 0:   # bounded fog box (a WORLD volume blacks out the sun + sky in EEVEE)
        ATM.build_fog_volume(prev, center=(0, 70, 20), size=(460, 460, 100), density=args.fog, z_ref=-6.0, falloff=45.0,
                             color=(0.85, 0.68, 0.50), anisotropy=0.45)
    for k_, v_ in (("volumetric_end", 320.0), ("volumetric_tile_size", "8")):
        try:
            setattr(sc.eevee, k_, v_)
        except Exception:
            pass
    lights = R.standard_lights(30.0, lava=False)
    for L_ in lights:
        if "Rim" in L_.name:
            L_.rotation_euler = (math.radians(-62), 0, math.radians(188))
            L_.data.energy = 3.6
    R.add_light("PREVIEW_LavaUp", "AREA", (0, 10, -6.5), (180, 0, 0), 60000.0, (1.0, 0.32, 0.1), 120.0)

    # occlusion of skull / hand / eclipse from the hero camera by ritual-floor geometry
    def occl(target, cam=(0, -30.0, 9.0), n=900):
        cam = Vector(cam)
        mnb, mxb = R.bounds([target])
        rr2 = np.random.default_rng(3)
        tot = blk = 0
        for _ in range(n):
            p = Vector([rr2.uniform(mnb[i], mxb[i]) for i in range(3)])
            d = (p - cam)
            dist = d.length
            d.normalize()
            hit, loc, nrm, idx, ob, mw = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), cam, d, distance=dist + 30)
            if not hit:
                continue
            if ob == target:
                tot += 1
            elif ob.name.startswith(ASSET):
                h2 = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), loc + d * 0.01, d, distance=dist + 30)
                # does the ray continue to the target behind the asset?
                q = loc + d * 0.01
                for _k in range(12):
                    h2 = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), q, d, distance=dist + 30)
                    if not h2[0]:
                        break
                    if h2[4] == target:
                        tot += 1
                        blk += 1
                        BLOCKERS[target.name][ob.name.split("_0")[0][:48]] = BLOCKERS[target.name].get(ob.name.split("_0")[0][:48], 0) + 1
                        break
                    if not h2[4].name.startswith(ASSET):
                        break
                    q = h2[1] + d * 0.01
        return round(100.0 * blk / max(tot, 1), 2), tot
    bpy.context.view_layer.update()
    occ = {}
    BLOCKERS = {}
    for nm_ in ("PREVIEW_StandIn_Skull", "PREVIEW_StandIn_Hand", "PREVIEW_StandIn_Eclipse"):
        o = bpy.data.objects.get(nm_)
        if o:
            BLOCKERS[nm_] = {}
            occ[nm_] = occl(o)
    REPORT["hero_occlusion_pct_samples"] = occ
    REPORT["hero_occlusion_blockers"] = BLOCKERS

    def board_blocked(cam):
        cam = Vector(cam)
        dg2 = bpy.context.evaluated_depsgraph_get()
        blk = tot = 0
        for x in np.linspace(-9.1, 9.1, 19):
            for y in np.linspace(-9.1, 9.1, 19):
                d = Vector((x, y, 0.005)) - cam
                dist = d.length
                d.normalize()
                hit, loc, nrm, idx, ob, mw = sc.ray_cast(dg2, cam, d, distance=dist - 0.05)
                tot += 1
                if hit and ob.name.startswith(ASSET):
                    blk += 1
        return blk, tot
    REPORT["board_blocked_samples"] = {"hero": board_blocked((0, -30.0, 9.0)), "god": board_blocked((0, -26.0, 30.0))}

    def gate_visible(cam, n=500):
        """% of sampled gate vertices that are the first hit from the camera (fog ignored)."""
        cam = Vector(cam)
        g = bpy.data.objects.get(f"{ASSET}_Monument_Gate")
        V = np.array([v.co[:] for v in g.data.vertices])
        idx = np.random.default_rng(5).choice(len(V), min(n, len(V)), replace=False)
        dg2 = bpy.context.evaluated_depsgraph_get()
        vis = 0
        for i in idx:
            p = Vector(V[i])
            d = p - cam
            dist = d.length
            d.normalize()
            hit, loc, nrm, _, ob, _ = sc.ray_cast(dg2, cam, d, distance=dist + 1.0)
            if hit and ob == g and (loc - p).length < 1.5:
                vis += 1
        return round(100.0 * vis / len(idx), 1)
    REPORT["gate_visible_pct"] = {"hero": gate_visible((0, -30.0, 9.0)), "worm": gate_visible((6.0, -14.0, 1.2))}
    print("OCCLUSION", occ, REPORT["board_blocked_samples"], flush=True)

    CAMS = {"hero": ((0, -30.0, 9.0), (0, 20.0, 5.5), 24.0), "worm": ((6.0, -14.0, 1.2), (0, 30.0, 14.0), 18.0),
            "high34": ((-45.0, -55.0, 40.0), (0, 15.0, 0.0), 30.0), "god": ((0, -26.0, 30.0), (0, 2.0, -2.0), 26.0)}
    REPORT["renders"] = []
    for v in args.views.split(","):
        if v in CAMS:
            loc, tgt, lens = CAMS[v]
            cam = R.camera("CAM_" + v, loc, tgt, lens)
            sc.render.resolution_x, sc.render.resolution_y = (1920, 1080) if v == "hero" else (1280, 720)
        elif v == "top":
            cam = R.camera("CAM_top", (0, 5, 200.0), (0, 5.0001, 0), 50.0)
            cam.rotation_euler = (0, 0, 0)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = 165.0
            sc.render.resolution_x, sc.render.resolution_y = 720, 720
        else:
            continue
        cam.data.clip_end = 3000
        p = os.path.join(RDIR, f"iter{args.iter:02d}_{v}.png")
        t1 = time.time()
        R.render_to(p, cam)
        REPORT["renders"].append({"view": v, "path": p, "s": round(time.time() - t1, 1)})
REPORT["seconds"] = round(time.time() - T0, 1)
R.write_json(os.path.join(RDIR, f"iter{args.iter:02d}_report.json"), REPORT)
print("RITUAL_DONE", REPORT["seconds"], flush=True)
