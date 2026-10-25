"""CFCL_Board_Arena - the MONUMENTAL arena chessboard (world metres), Claude track.

Square = 2.30 m (a 1.8 m soldier stands on one), playing area 18.40 m, overall 21.85 m.
64 separate bevelled tiles (top Z=0 exactly, origin = square centre), carved stone border with recessed
lozenge/chevron channel, bronze trim beads, four corner piers with monumental bronze pyramid caps, two BLANK
bronze plaques on the player (-Y) and opponent (+Y) sides, and a stepped carved base down to Z=-1.55.
Everything stays inside |x|,|y| <= 10.925 m (the dais v006 BoardSkirt contract box).

Usage (from work/claude_environment):
    python lib/run_blender.py scripts/board_arena.py --timeout 1800 -- --ver 1 --iter 1 [--views a,b,c,d]
Deterministic (explicit seeds).  Saves assets/CFCL_Board_Arena/CFCL_Board_Arena_v###.blend BEFORE the preview
context (dais disc, lava plane, lights, cameras, 1.8 m scale proxies) is added, so the .blend holds only the asset.
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
from mathutils import Vector  # noqa: E402
import cf_render as R  # noqa: E402
import cf_materials as M  # noqa: E402
import arch_lib as A  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--ver", type=int, default=1)
ap.add_argument("--iter", type=int, default=1)
ap.add_argument("--views", default="a,b,c,d")
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--norender", action="store_true")
args = ap.parse_args(argv)

T0 = time.time()
ASSET = "CFCL_Board_Arena"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "board_arena")
os.makedirs(ADIR, exist_ok=True)
os.makedirs(RDIR, exist_ok=True)

# ----------------------------------------------------------------------------- dimensions (metres)
SQ = 2.30
HALF = 4 * SQ                      # 9.20 playfield half
TILE_E = 2.23 / 2                  # tile half width (7 cm grout)
TILE_H = 0.41
TILE_RB = 0.08
BEAD_U = 9.27                      # inner bronze bead centre line (v007: wider shadow reveal to the tiles)
RAIL_IN = 9.28                     # border stone starts (under the bead edge)
CH_IN_TOP, CH_IN_BOT = 9.55, 9.58  # channel walls (slight draft)
CH_OUT_BOT, CH_OUT_TOP = 10.13, 10.16
C1_OUT, C2_OUT, C3_OUT = 10.42, 10.67, 10.925
Z_TOP, Z_CH, Z_C1, Z_C2, Z_BOT = 0.0, -0.16, -0.48, -1.00, -1.55     # v007: deeper carved channel
INLAY_U = (9.44, 10.215)           # v007: thin ember inlay grooves (inner rail, outer rail)
INLAY_W, INLAY_D = 0.045, 0.022
TRENCH_IN = 9.08                   # v007: deep shadow trench between outer tiles and border (core top drops)
PIER_IN, PIER_OUT, PIER_DIE_OUT = 9.28, 10.925, 10.885
Z_DIE_TOP, Z_CAP_TOP = 0.36, 0.52
PYR_H = 0.90
OUTER_BEAD_U = 10.29
CH_MID = 0.5 * (CH_IN_BOT + CH_OUT_BOT)
FILES = "abcdefgh"

# side frames: local (s, u, z), u = outward distance from the centre; proper rotations only
SIDES = {"N": 0.0, "E": -90.0, "S": 180.0, "W": 90.0}

# story: scorch centres (x, y, radius) - battle fire on the border, none on the tiles
SCORCH = [(-4.3, -9.95, 1.55), (9.95, 3.2, 1.35), (2.8, 9.95, 1.75), (-9.95, -6.3, 1.15),
          (10.1, -10.1, 0.95), (-6.6, 9.95, 1.05), (-10.05, 5.2, 0.8)]
CHIPPED = {"c2": [(1, 1)], "f3": [(-1, 1), (1, -1)], "d5": [(1, -1)], "h4": [(-1, -1)], "b7": [(1, 1)],
           "e8": [(-1, -1), (1, -1)], "a6": [(1, -1)], "g1": [(-1, 1)]}
CRACKED = {"b3", "e2", "g6", "c7", "f5", "d8", "h2"}


def to_world(V, th_deg):
    th = math.radians(th_deg)
    c, s = round(math.cos(th), 12), round(math.sin(th), 12)
    V = np.asarray(V, float)
    return np.stack([c * V[:, 0] - s * V[:, 1], s * V[:, 0] + c * V[:, 1], V[:, 2]], 1)


def fillet(pts, radii, nseg=3):
    """Closed polygon (u,z) with per-corner fillet radii -> dense polygon."""
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


def extrude(prof, s0, s1, ds=0.2, d0=None, d1=None, end_dense=True):
    """Extrude closed profile (u,z) along local s from s0 to s1. d0/d1: per-profile-vertex s offsets of the
    first/last ring (slanted or jagged breaks).  Returns closed Piece in local (s,u,z)."""
    prof = np.asarray(prof, float)
    P = len(prof)
    n = max(2, int(math.ceil((s1 - s0) / ds)))
    ss = list(np.linspace(s0, s1, n + 1))
    if end_dense and s1 - s0 > 0.6:
        ss += [s0 + 0.08, s1 - 0.08]
    ss = np.unique(np.round(np.asarray(ss), 6))
    t = (ss - s0) / (s1 - s0)
    d0 = np.zeros(P) if d0 is None else np.asarray(d0, float)
    d1 = np.zeros(P) if d1 is None else np.asarray(d1, float)
    S = ss[:, None] + (1 - t)[:, None] * d0[None, :] + t[:, None] * d1[None, :]
    V = np.stack([S.ravel(), np.tile(prof[:, 0], len(ss)), np.tile(prof[:, 1], len(ss))], 1)
    F = []
    for j in range(len(ss) - 1):
        for i in range(P):
            i2 = (i + 1) % P
            F.append([j * P + i, j * P + i2, (j + 1) * P + i2, (j + 1) * P + i])
    F.append(list(range(P))[::-1])
    F.append([(len(ss) - 1) * P + i for i in range(P)])
    pc = A.Piece(V, F)
    pc.fix_orientation()
    return pc


def arris_chips(V, s0, s1, arrises, n, rng, dmin, dmax, ends=True):
    """Spall chips along given arrises [(u, z, (nu, nz))] of a local block, plus vertical end-arris chips."""
    for _ in range(n):
        u, z, (nu, nz) = arrises[int(rng.integers(len(arrises)))]
        s = rng.uniform(s0 + 0.15, s1 - 0.15)
        nv = A.normalize(np.array([rng.normal(0, 0.35), nu, nz]) + rng.normal(0, 0.15, 3))
        depth = rng.uniform(dmin, dmax)
        A.chip(V, np.array([s, u, z]), nv, depth, depth * rng.uniform(2.6, 4.2))
    if ends:
        for s_end, sg in ((s0, -1.0), (s1, 1.0)):
            if rng.uniform() < 0.55:
                u, z, (nu, nz) = arrises[0]
                depth = rng.uniform(dmin, dmax)
                nv = A.normalize(np.array([sg, nu * 0.9, nz * 0.9]) + rng.normal(0, 0.15, 3))
                A.chip(V, np.array([s_end, u, z]), nv, depth, depth * 3.5)


# ----------------------------------------------------------------------------- profiles
def _outer_face():
    """v007 layered outer moulding of the top band (bottom -> top): fascia, fillet step, flat fret band, projecting
    torus bead, cyma, rounded top arris."""
    return [((C1_OUT, Z_C1), 0.012), ((C1_OUT, -0.34), 0.0), ((10.40, -0.32), 0.006), ((10.40, -0.15), 0.006),
            ((10.455, -0.125), 0.02), ((10.47, -0.085), 0.02), ((10.45, -0.055), 0.012), ((10.44, -0.035), 0.0),
            ((10.44, Z_TOP), 0.03)]


def _groove(u):
    a, b = u + INLAY_W / 2, u - INLAY_W / 2
    return [((a, Z_TOP), 0.0), ((a, -INLAY_D), 0.0), ((b, -INLAY_D), 0.0), ((b, Z_TOP), 0.0)]


def prof_c1_channel():
    pts = [((RAIL_IN, Z_C1), 0.0)] + _outer_face() + _groove(INLAY_U[1]) + [
        ((CH_OUT_TOP, Z_TOP), 0.012), ((CH_OUT_TOP - 0.012, -0.03), 0.0), ((CH_OUT_TOP - 0.012, -0.065), 0.0),
        ((CH_OUT_BOT, -0.085), 0.0), ((CH_OUT_BOT, Z_CH), 0.012), ((CH_IN_BOT, Z_CH), 0.012), ((CH_IN_BOT, -0.085), 0.0),
        ((CH_IN_TOP + 0.012, -0.065), 0.0), ((CH_IN_TOP + 0.012, -0.03), 0.0), ((CH_IN_TOP, Z_TOP), 0.012)] + \
        _groove(INLAY_U[0]) + [((RAIL_IN, Z_TOP), 0.0)]
    return fillet([p for p, _ in pts], [r for _, r in pts])


def prof_c1_flat():
    pts = [((RAIL_IN, Z_C1), 0.0)] + _outer_face() + _groove(INLAY_U[1]) + _groove(INLAY_U[0]) + [((RAIL_IN, Z_TOP), 0.0)]
    return fillet([p for p, _ in pts], [r for _, r in pts])


def prof_c2():
    return fillet([(9.25, Z_C2), (C2_OUT, Z_C2), (C2_OUT, Z_C1), (9.25, Z_C1)], [0, 0.012, 0.05, 0])


def prof_c3():
    return fillet([(9.25, Z_BOT), (C3_OUT, Z_BOT), (C3_OUT, -1.42), (10.885, -1.395), (10.885, -1.165),
                   (C3_OUT, -1.14), (C3_OUT, Z_C2), (9.25, Z_C2)], [0, 0.0, 0.0, 0.01, 0.01, 0.0, 0.05, 0])


# ----------------------------------------------------------------------------- materials
def nb_attach(mat):
    nb = M.NB.__new__(M.NB)
    nb.nt = mat.node_tree
    nb._k = 600
    nb._cache = {}
    return nb


def tile_frame(nb, ang_scale=6.2832):
    tc = nb.n("ShaderNodeTexCoord")
    rnd = nb.objrand()
    r2 = nb.m("FRACT", nb.mul(rnd, 7.31))
    r3 = nb.m("FRACT", nb.mul(rnd, 13.17))
    vr = nb.n("ShaderNodeVectorRotate", rotation_type="Z_AXIS")
    nb.link(tc.outputs["Object"], vr.inputs["Vector"])
    nb.link(nb.mul(rnd, ang_scale), vr.inputs["Angle"])
    p = nb.vop("ADD", vr.outputs["Vector"], nb.vcomb(nb.mul(r2, 37.0), nb.mul(r3, 53.0), nb.mul(rnd, 11.0)))
    return tc, rnd, r2, r3, p


def crack_mask(nb, tc, r2, r3):
    on = nb.attr("cfb_crack")
    vr = nb.n("ShaderNodeVectorRotate", rotation_type="Z_AXIS")
    nb.link(tc.outputs["Object"], vr.inputs["Vector"])
    nb.link(nb.mul(r2, 6.2832), vr.inputs["Angle"])
    lp = vr.outputs["Vector"]
    x, y, _ = nb.vsep(lp)
    w1 = nb.tn(lp, 1.1, 3.0, 0.55).outputs["Fac"]
    w2 = nb.tn(lp, 6.5, 3.0, 0.6).outputs["Fac"]
    f = nb.add(x, nb.mad(nb.sub(w1, 0.5), 0.35, nb.mad(nb.sub(w2, 0.5), 0.07, nb.mad(r3, 0.8, -0.4))))
    line = nb.ss(nb.absv(f), 0.0, 0.0075, 1.0, 0.0)
    halo = nb.ss(nb.absv(f), 0.0, 0.03, 1.0, 0.0)
    gate = nb.ss(y, nb.mad(r3, 0.5, -0.6), nb.mad(r3, 0.5, -0.1))
    return nb.mul(nb.mul(line, gate), on), nb.mul(nb.mul(halo, gate), on)


def tile_wear(nb, c, rnd, r3, p, light):
    """v007 satin surface (user review): per-tile roughness 0.58-0.80 (clamped 0.55-0.88), faint worn polish lanes
    along the files, micro-scratches, faint stains, softened/chipped bevel edges.  Restrained - nothing that competes
    with figures standing on the squares.  -> (colour, roughness, extra height)"""
    pos = nb.pos()
    base_r = nb.mad(nb.m("FRACT", nb.mul(rnd, 3.71)), 0.22, 0.58)
    var = nb.lin(nb.tn(p, 0.6, 3.0).outputs["Fac"], 0.3, 0.7, -0.04, 0.04)
    rough = nb.add(base_r, var)
    lane = nb.ss(nb.tn(nb.vop("MULTIPLY", pos, (0.32, 0.05, 1.0)), 1.0, 2.0, 0.5).outputs["Fac"], 0.56, 0.70)
    lane = nb.mul(lane, nb.ss(nb.tn(pos, 0.25, 2.0).outputs["Fac"], 0.4, 0.6))
    rough = nb.sub(rough, nb.mul(lane, 0.09))
    c = nb.hsv(c, v=nb.mad(lane, 0.04 if light else 0.10, 1.0))
    sp = nb.vop("MULTIPLY", p, (55.0, 1.6, 1.0))
    scr = nb.mul(nb.ss(nb.absv(nb.sub(nb.tn(sp, 1.0, 2.0, 0.5).outputs["Fac"], 0.5)), 0.0, 0.012, 1.0, 0.0),
                 nb.ss(nb.tn(p, 2.2, 2.0).outputs["Fac"], 0.52, 0.66))
    rough = nb.mad(scr, 0.07, rough)
    c = nb.hsv(c, v=nb.mad(scr, -0.035 if light else 0.06, 1.0))
    stn = nb.mul(nb.ss(nb.tn(p, 0.85, 3.0, 0.55, 0.3).outputs["Fac"], 0.60, 0.72), nb.ss(r3, 0.3, 0.6))
    c = nb.cmix(nb.mul(stn, 0.22 if light else 0.18), c, (0.42, 0.36, 0.27) if light else (0.10, 0.095, 0.09))
    rough = nb.mad(stn, 0.05, rough)
    arr, chips = M._arris(nb, pos, 1.0, 0.04)
    edge = nb.c01(nb.mx(nb.mul(arr, 0.55), chips))
    c = nb.cmix(nb.mul(edge, 0.30 if light else 0.42), c, (0.70, 0.67, 0.60) if light else (0.115, 0.115, 0.115))
    rough = nb.mad(edge, 0.12, rough)
    rough = nb.lin(rough, 0.55, 0.88, 0.55, 0.88)
    h = nb.mad(scr, -0.04, nb.mul(chips, -0.3))
    return c, rough, h


def mat_marble():
    m = bpy.data.materials.new("CFCL_BoardArena_Marble")
    nb = M.NB(m)
    tc, rnd, r2, r3, p = tile_frame(nb)
    # flowing veins: low-detail contour of a strongly warped, stretched field (not scribbles)
    wn = nb.tn(p, 0.28, 2.0, 0.5).outputs["Color"]
    wp = nb.vop("ADD", p, nb.vop("SCALE", nb.vop("SUBTRACT", wn, (0.5, 0.5, 0.5)), s=1.6))
    wn2 = nb.tn(wp, 1.2, 2.0, 0.5).outputs["Color"]
    wp2 = nb.vop("ADD", wp, nb.vop("SCALE", nb.vop("SUBTRACT", wn2, (0.5, 0.5, 0.5)), s=0.18))
    v1 = nb.tn(nb.vop("MULTIPLY", wp2, (0.22, 0.75, 0.5)), 1.0, 2.0, 0.45).outputs["Fac"]
    a1 = nb.absv(nb.sub(v1, 0.5))
    line1 = nb.ss(a1, 0.0, 0.0065, 1.0, 0.0)
    halo1 = nb.ss(a1, 0.0, 0.07, 1.0, 0.0)
    g1 = nb.ss(nb.tn(p, 0.30, 2.0).outputs["Fac"], 0.38, 0.58)
    v2 = nb.tn(nb.vop("MULTIPLY", wp2, (0.6, 1.3, 1.0)), 1.1, 2.5, 0.5, 0.2).outputs["Fac"]
    a2 = nb.absv(nb.sub(v2, 0.5))
    line2 = nb.ss(a2, 0.0, 0.004, 1.0, 0.0)
    halo2 = nb.ss(a2, 0.0, 0.03, 1.0, 0.0)
    g2 = nb.ss(nb.tn(p, 0.7, 2.0).outputs["Fac"], 0.48, 0.66)
    cloud = nb.tn(wp, 0.55, 3.0, 0.5).outputs["Fac"]
    grain = nb.tn(p, 45.0, 4.0, 0.6).outputs["Fac"]
    base = nb.rampc(cloud, [(0.28, (0.50, 0.455, 0.37)), (0.55, (0.585, 0.54, 0.45)), (0.80, (0.635, 0.59, 0.50))])
    c = nb.hsv(base, h=nb.mad(r2, 0.016, 0.492), s=nb.mad(r3, 0.30, 0.85),
               v=nb.mul(nb.mad(rnd, 0.12, 0.94), nb.lin(grain, 0.3, 0.7, 0.975, 1.025)))
    c = nb.cmix(nb.mul(halo1, nb.mul(g1, 0.38)), c, (0.44, 0.425, 0.39))
    c = nb.cmix(nb.mul(halo2, nb.mul(g2, 0.22)), c, (0.47, 0.455, 0.42))
    c = nb.cmix(nb.mul(line1, nb.mul(g1, 0.42)), c, (0.36, 0.35, 0.335))
    c = nb.cmix(nb.mul(line2, nb.mul(g2, 0.25)), c, (0.40, 0.39, 0.37))
    st = nb.ss(nb.tn(p, 0.6, 3.0).outputs["Fac"], 0.62, 0.72)
    c = nb.cmix(nb.mul(st, 0.18), c, (0.55, 0.43, 0.28))
    crk, crh = crack_mask(nb, tc, r2, r3)
    c = nb.cmix(nb.mul(crh, 0.25), c, (0.36, 0.32, 0.26))
    c = nb.cmix(nb.mul(crk, 0.85), c, (0.17, 0.155, 0.13))
    chp = nb.attr("cfb_chip")
    c = nb.cmix(nb.mul(chp, 0.6), c, (0.70, 0.68, 0.62))
    cav = nb.cavity(0.12)
    c = nb.cmix(nb.mul(nb.ss(cav, 0.1, 0.6), 0.45), c, (0.26, 0.23, 0.19))
    c, rough, hw = tile_wear(nb, c, rnd, r3, p, True)
    rough = nb.mad(nb.sub(0.85, rough), nb.mx(crk, chp), rough)
    h = nb.mad(grain, 0.05, nb.mad(line1, -0.15, hw))
    h = nb.sub(h, crk)
    nrm = nb.bump(h, 0.2, 0.002)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.45})
    return m


def mat_tile_basalt():
    m = bpy.data.materials.new("CFCL_BoardArena_TileBasalt")
    nb = M.NB(m)
    tc, rnd, r2, r3, p = tile_frame(nb)
    wn = nb.tn(p, 0.6, 3.0, 0.55).outputs["Color"]
    wp = nb.vop("ADD", p, nb.vop("SCALE", nb.vop("SUBTRACT", wn, (0.5, 0.5, 0.5)), s=0.6))
    cloud = nb.tn(wp, 0.9, 4.0, 0.5).outputs["Fac"]
    mott = nb.tn(p, 3.5, 4.0, 0.6).outputs["Fac"]
    grain = nb.tn(p, 120.0, 3.0, 0.6).outputs["Fac"]
    base = nb.rampc(cloud, [(0.3, (0.046, 0.049, 0.054)), (0.7, (0.068, 0.070, 0.075))])
    c = nb.hsv(base, h=nb.mad(r2, 0.02, 0.49),
               v=nb.mul(nb.mul(nb.mad(rnd, 0.22, 0.89), nb.lin(grain, 0.3, 0.7, 0.80, 1.22)),
                        nb.lin(mott, 0.3, 0.7, 0.86, 1.14)))
    vor = nb.tv(p, 140.0, "F1")
    cry = nb.mul(nb.ss(vor.outputs["Distance"], 0.0, 0.12, 1.0, 0.0), nb.ss(nb.tn(p, 9.0, 2.0).outputs["Fac"], 0.42, 0.60))
    c = nb.cmix(nb.mul(cry, 0.55), c, (0.15, 0.15, 0.155))
    v2 = nb.tn(nb.vop("MULTIPLY", wp, (1.3, 0.6, 1.0)), 1.3, 6.0, 0.65, 0.3).outputs["Fac"]
    line2 = nb.ss(nb.absv(nb.sub(v2, 0.5)), 0.0, 0.005, 1.0, 0.0)
    gv = nb.mul(nb.ss(r3, 0.55, 0.8), nb.ss(nb.tn(p, 0.8, 2.0).outputs["Fac"], 0.45, 0.62))
    c = nb.cmix(nb.mul(line2, nb.mul(gv, 0.55)), c, (0.15, 0.15, 0.15))
    crk, crh = crack_mask(nb, tc, r2, r3)
    c = nb.cmix(nb.mul(crk, 0.75), c, (0.13, 0.125, 0.12))
    chp = nb.attr("cfb_chip")
    c = nb.cmix(nb.mul(chp, 0.7), c, (0.12, 0.12, 0.12))
    cav = nb.cavity(0.12)
    c = nb.cmix(nb.mul(nb.ss(cav, 0.1, 0.6), 0.4), c, (0.022, 0.021, 0.02))
    c, rough, hw = tile_wear(nb, c, rnd, r3, p, False)
    rough = nb.mad(nb.sub(grain, 0.5), 0.06, rough)
    rough = nb.mad(nb.sub(0.86, rough), nb.mx(crk, chp), rough)
    h = nb.mad(grain, 0.08, nb.mad(cry, 0.04, hw))
    h = nb.sub(h, crk)
    nrm = nb.bump(h, 0.2, 0.002)
    nb.principled(c, rough, nrm, extra={"Specular IOR Level": 0.45})
    return m


def mat_grout():
    m = bpy.data.materials.new("CFCL_BoardArena_Grout")
    nb = M.NB(m)
    pos = nb.pos()
    n1 = nb.tn(pos, 6.0, 4.0, 0.6).outputs["Fac"]
    c = nb.hsv((0.032, 0.029, 0.025), v=nb.lin(n1, 0.3, 0.7, 0.75, 1.25))
    nrm = nb.bump(n1, 0.4, 0.004)
    nb.principled(c, 0.95, nrm)
    return m


def _warp_pos(nb, pos, scale=0.8, amt=0.5):
    w = nb.tn(pos, scale, 2.0, 0.5).outputs["Color"]
    return nb.vop("ADD", pos, nb.vop("SCALE", nb.vop("SUBTRACT", w, (0.5, 0.5, 0.5)), s=amt))


def mat_bronze():
    """Aged gilt-bronze for the sacred fittings (brighter than the shared CFCL_Bronze, which rendered as dull
    brown wood at this scale): warm polished metal on arrises and worn high spots, dark oxide patina mottling,
    verdigris crust only in recesses (AO + cf_concave)."""
    m = bpy.data.materials.new("CFCL_BoardArena_Bronze")
    nb = M.NB(m)
    pos = nb.pos()
    n1a = nb.tn(pos, 9.0, 5.0, 0.62, 0.3).outputs["Fac"]
    run = nb.tn(nb.vop("MULTIPLY", pos, (7.0, 7.0, 0.9)), 1.0, 4.0, 0.6).outputs["Fac"]   # vertical run-off
    n1 = nb.mad(n1a, 0.6, nb.mul(run, 0.4))
    n2 = nb.tn(pos, 0.9, 3.0, 0.5).outputs["Fac"]
    n3 = nb.tn(pos, 22.0, 4.0, 0.6).outputs["Fac"]
    cvx = nb.attr("cf_convex")
    ccv = nb.attr("cf_concave")
    cav = nb.c01(nb.mad(nb.cavity(0.10), 1.3, ccv))
    pol = nb.c01(nb.mad(cvx, 1.6, nb.mul(nb.ss(n2, 0.55, 0.75), 0.30)))
    # v007 locked palette: EMBER GOLD (#d9932e -> #f2b04a) metal, patina only as restrained mottling + recesses
    pat = nb.mul(nb.c01(nb.mad(nb.ss(n1, 0.36, 0.64), 0.75, 0.08)), nb.sub(1.0, pol))
    verd = nb.c01(nb.mul(nb.mul(cav, nb.ss(n1, 0.45, 0.66)), 0.9))
    metal = nb.rampc(n3, [(0.3, (0.69, 0.29, 0.027)), (0.7, (0.89, 0.43, 0.069))])
    # v008: brushed / hand-burnished streaks so large flats (blank plaques) read as worked metal, not plastic
    brush = nb.tn(nb.vop("MULTIPLY", pos, (2.0, 40.0, 2.0)), 1.0, 3.0, 0.6).outputs["Fac"]
    metal = nb.hsv(metal, v=nb.lin(brush, 0.3, 0.7, 0.86, 1.08))
    patc = nb.rampc(n2, [(0.35, (0.10, 0.068, 0.034)), (0.7, (0.075, 0.07, 0.04))])
    c = nb.cmix(pat, metal, patc)
    c = nb.cmix(nb.mul(cav, 0.55), c, (0.05, 0.035, 0.02))
    vcol = nb.rampc(n3, [(0.35, (0.055, 0.14, 0.10)), (0.7, (0.10, 0.20, 0.15))])
    c = nb.cmix(verd, c, vcol)
    metallic = nb.mul(nb.sub(1.0, verd), nb.sub(0.95, nb.mul(pat, 0.45)))
    rough = nb.mad(pat, 0.30, nb.mad(n3, 0.06, nb.lin(brush, 0.3, 0.7, 0.18, 0.32)))
    rough = nb.mad(nb.sub(0.85, rough), verd, rough)
    h = nb.mad(verd, 0.5, nb.mad(n1, 0.15, nb.mul(n3, 0.05)))
    nrm = nb.bump(h, 0.35, 0.003)
    nb.principled(c, rough, nrm, metallic=metallic)
    return m


def mat_inlay():
    """CFCL_BoardInlayGlow (v007): thin ember inlay set into the border grooves.  Emission colour = ember gold, Emission
    Strength 0.0 by DEFAULT - the game drives it (check / capture / Gambit start pulses).  Unlit it reads as a dark
    glassy amber line."""
    m = bpy.data.materials.new("CFCL_BoardInlayGlow")
    nb = M.NB(m)
    pos = nb.pos()
    n = nb.tn(pos, 14.0, 3.0, 0.55).outputs["Fac"]
    c = nb.rampc(n, [(0.3, (0.075, 0.032, 0.008)), (0.7, (0.13, 0.058, 0.014))])
    b, _ = nb.principled(c, nb.lin(n, 0.3, 0.7, 0.28, 0.4), None,
                         extra={"Emission Color": (0.888, 0.434, 0.069, 1.0), "Emission Strength": 0.0,
                                "Specular IOR Level": 0.55, "Metallic": 0.25})
    m["cf_note"] = "drive Principled 'Emission Strength' 0..~6 at runtime for pulses; 0 = idle"
    return m


def mat_stone():
    """AncientStone recipe from cf_materials (moss off), then: controlled moss ONLY in the channel recess and on
    the outer step treads (world-space zones), battle scorch blotches, scorch kills moss."""
    m = M.make_ancient_stone(moss=0.0, cracks=0.45, _name="BoardArena_Stone")
    nt = m.node_tree
    bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    col_in = bsdf.inputs["Base Color"].links[0].from_socket
    rough_in = bsdf.inputs["Roughness"].links[0].from_socket
    bump = bsdf.inputs["Normal"].links[0].from_node
    h_in = bump.inputs["Height"].links[0].from_socket
    nb = nb_attach(m)
    pos = nb.pos()
    x, y, z = nb.vsep(pos)
    r = nb.mx(nb.absv(x), nb.absv(y))
    # scorch
    sc = None
    for (cx, cy, rad) in SCORCH:
        d = nb.m("DIVIDE", nb.vop("LENGTH", nb.vop("SUBTRACT", nb.vcomb(x, y, 0.0), (cx, cy, 0.0))), rad)
        w = nb.ss(d, 1.0, 0.18)
        sc = w if sc is None else nb.mx(sc, w)
    # flame-licked burn: high-contrast breakup thresholded by the radial falloff (crisp soot tongues, not smudges)
    brk = nb.tn(_warp_pos(nb, pos), 1.6, 5.0, 0.62, 0.5).outputs["Fac"]
    brk2 = nb.tn(pos, 9.0, 3.0, 0.6).outputs["Fac"]
    edge = nb.mad(brk, 0.75, nb.mad(brk2, 0.12, -0.05))
    core = nb.ss(nb.sub(sc, nb.sub(1.0, edge)), -0.06, 0.24)
    halo = nb.mul(nb.mul(sc, sc), nb.mad(brk2, 0.3, 0.22))
    ring = nb.mul(nb.ss(core, 0.0, 0.3), nb.ss(core, 0.9, 0.45))
    sc = nb.c01(nb.mx(nb.mul(core, 0.78), halo))
    # sacred board stone: AncientStone recipe darkened/cooled so the board separates from the dais
    c0 = nb.hsv(col_in, h=0.497, s=0.85, v=0.68)
    c = nb.cmix(nb.mul(ring, 0.35), c0, (0.060, 0.038, 0.024))
    c = nb.cmix(nb.mul(sc, 0.92), c, (0.011, 0.010, 0.009))
    rough = nb.mad(nb.sub(0.95, rough_in), nb.mul(sc, 0.85), rough_in)
    # moss zones
    chan = nb.mul(nb.mul(nb.ss(r, 9.53, 9.62), nb.ss(r, 10.16, 10.08)),
                  nb.mul(nb.ss(z, -0.19, -0.155), nb.ss(z, -0.02, -0.05)))
    steps = nb.mul(nb.ss(r, 10.38, 10.47), nb.ss(z, -0.40, -0.47))
    zone = nb.mx(chan, nb.mul(steps, 0.85))
    up = nb.ss(nb.nz(), 0.35, 0.8)
    cav = nb.cavity(0.25)
    big = nb.tn(pos, 0.35, 3.0, 0.5, 0.3).outputs["Fac"]
    mid = nb.tn(pos, 1.7, 4.0, 0.6, 0.4).outputs["Fac"]
    fin = nb.tn(pos, 7.0, 4.0, 0.6).outputs["Fac"]
    cov = nb.mul(nb.mul(zone, up), nb.mad(nb.ss(cav, 0.05, 0.4), 0.6, 0.55))
    cov = nb.add(cov, nb.mad(mid, 0.5, -0.25))
    cov = nb.add(cov, nb.mad(fin, 0.25, -0.125))
    cov = nb.add(cov, nb.mad(big, 0.6, -0.3))
    mm = nb.mul(nb.ss(cov, 0.40, 0.56), nb.mul(zone, nb.sub(1.0, sc)))
    mcol, mh, _t = M._moss_color(nb, pos, False, 1.0)
    c = nb.cmix(mm, c, mcol)
    rough = nb.mad(nb.sub(0.93, rough), mm, rough)
    h = nb.add(h_in, nb.mul(mm, nb.mad(mh, 0.8, 0.6)))
    nb.link(c, bsdf.inputs["Base Color"])
    nb.link(rough, bsdf.inputs["Roughness"])
    nb.link(h, bump.inputs["Height"])
    return m


# ----------------------------------------------------------------------------- tiles
def tile_piece(chips=(), seed=0):
    e, h, rb = TILE_E, TILE_H, TILE_RB
    a = e - rb
    half = [a - 0.15, a, a + 0.268 * rb, a + 0.577 * rb, e]
    xs = np.array(sorted(set([0.0] + half + [-v for v in half])))
    zs = np.array([-h, -0.25, -rb, -rb + 0.268 * rb, -rb + 0.577 * rb, 0.0])
    V, Q = A.box_surface(xs, xs, zs)
    q = V.copy()
    q[:, 0] = np.clip(V[:, 0], -a, a)
    q[:, 1] = np.clip(V[:, 1], -a, a)
    q[:, 2] = np.minimum(V[:, 2], -rb)
    d = V - q
    # p-norm (p<2) normalisation = softened chamfer instead of a round "pillow" bevel (dressed-stone arris)
    pn = 1.35
    L = np.power(np.sum(np.power(np.abs(d), pn), axis=1), 1.0 / pn)
    m = L > 1e-9
    V[m] = q[m] + d[m] / L[m, None] * rb
    chipv = np.zeros(len(V))
    rng = np.random.default_rng(seed)
    for (sx, sy) in chips:
        p0 = np.array([sx * (e - 0.015), sy * (e - 0.015), -0.012])
        nv = A.normalize(np.array([sx * (1 + rng.normal(0, 0.3)), sy * (1 + rng.normal(0, 0.3)),
                                   1.0 + rng.normal(0, 0.2)]))
        before = V.copy()
        A.chip(V, p0, nv, rng.uniform(0.12, 0.17), 0.42)
        chipv[np.linalg.norm(V - before, axis=1) > 1e-6] = 1.0
    V[:, 2] = np.minimum(V[:, 2], 0.0)
    pc = A.Piece(V, Q)
    pc.fix_orientation()
    return pc, chipv


def mesh_from_piece(name, pc, mats, attrs=None, sharp=35.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata(pc.V.tolist(), [], pc.F)
    for mm in mats:
        me.materials.append(mm)
    if len(mats) > 1:
        me.polygons.foreach_set("material_index", np.clip(np.asarray(pc.fm, np.int32), 0, len(mats) - 1))
    for k, arr in (attrs or {}).items():
        at = me.attributes.new(k, "FLOAT", "POINT")
        at.data.foreach_set("value", np.asarray(arr, np.float32))
    me.validate(clean_customdata=False)
    me.update()
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(sharp))
    except Exception as ex:
        print("sharp fail", ex)
    return me


def build_tiles(col, mlight, mdark):
    std = {}
    tiles = []
    for r in range(8):
        for f in range(8):
            sqn = FILES[f] + str(r + 1)
            dark = (f + r) % 2 == 0
            mat = mdark if dark else mlight
            chips = CHIPPED.get(sqn, [])
            cracked = sqn in CRACKED
            if chips or cracked:
                pc, chipv = tile_piece(chips, seed=1000 + 8 * r + f)
                attrs = {"cfb_crack": np.full(len(pc.V), 1.0 if cracked else 0.0)}
                if chips:
                    attrs["cfb_chip"] = chipv
                me = mesh_from_piece("CFCL_Board_TileMesh_" + sqn, pc, [mat], attrs)
            else:
                key = "Dark" if dark else "Light"
                if key not in std:
                    pc, _ = tile_piece()
                    std[key] = mesh_from_piece("CFCL_Board_TileMesh_" + key, pc, [mat])
                me = std[key]
            ob = bpy.data.objects.new("CFCL_Board_Tile_" + sqn, me)
            ob.location = ((f - 3.5) * SQ, (r - 3.5) * SQ, 0.0)
            ob["cf_square"] = sqn
            ob["cf_index_a1_0"] = 8 * r + f
            ob["cf_colour"] = "dark" if dark else "light"
            ob["cf_chipped"] = bool(chips)
            ob["cf_cracked"] = bool(cracked)
            col.objects.link(ob)
            tiles.append(ob)
    return tiles


# ----------------------------------------------------------------------------- border / base per side
def stepped_fret(s0, s1, v_lo, v_hi, unit=0.46):
    """Abstract running stepped fret (stepped chevron) polyline in (s, v)."""
    pts = []
    n = int((s1 - s0) / unit)
    vm = 0.5 * (v_lo + v_hi)
    for k in range(n):
        a = s0 + k * unit
        q = unit / 4
        pts += [(a, v_lo), (a + q, v_lo), (a + q, vm), (a + 2 * q, vm), (a + 2 * q, v_hi), (a + 3 * q, v_hi),
                (a + 3 * q, vm), (a + 4 * q - 0.0001, vm)]
    pts.append((s0 + n * unit, v_lo))
    return pts


def side_build(name, th, rng, acc_border, acc_base, acc_bronze, report, acc_inlay=None):
    plaque_side = name in ("N", "S")
    if plaque_side:
        e1 = [-9.36, -5.60, -2.00, 2.00, 5.60, 9.36]
        flat = {2}
    else:
        e1 = [-9.36, -4.65, 0.0, 4.65, 9.36]
        flat = set()
    J = 0.0075
    local_border, local_base, local_bronze = [], [], []
    deform = []    # (mask_fn(V_local)->bool, fn(V_local)->V_local)  applied to border+bronze+frieze verts
    pch, pfl = prof_c1_channel(), prof_c1_flat()
    arr_c1 = [(10.43, Z_TOP - 0.012, (1.0, 1.0)), (CH_OUT_TOP - 0.005, Z_TOP - 0.004, (-0.8, 1.0)),
              (CH_IN_TOP + 0.005, Z_TOP - 0.004, (0.8, 1.0))]
    for i in range(len(e1) - 1):
        s0 = e1[i] + (J if i > 0 else 0.0)
        s1 = e1[i + 1] - (J if i < len(e1) - 2 else 0.0)
        prof = pfl if i in flat else pch
        pieces = []
        if name == "W" and i == 1:
            # impact-cracked block: slanted jagged split, outer half settled 2 cm and tipped
            sc0 = 0.5 * (s0 + s1) - 0.25
            spl = lambda u, z: sc0 + 0.30 * (u - 9.85) + 0.035 * np.sin(23.0 * u + 11.0 * z)
            dA = np.array([spl(u, z) - 0.012 - s1 for u, z in prof])
            dB = np.array([spl(u, z) + 0.012 - s0 for u, z in prof])
            pA = extrude(prof, s0, s1, 0.2, None, dA)
            pB = extrude(prof, s0, s1, 0.2, dB, None)
            phi = math.radians(1.6)

            def fB(V, phi=phi):
                du, dz = V[:, 1] - C1_OUT, V[:, 2] - Z_C1
                V = V.copy()
                V[:, 1] = C1_OUT + du * math.cos(phi) - dz * math.sin(phi)
                V[:, 2] = Z_C1 + dz * math.cos(phi) + du * math.sin(phi) - 0.045
                return V

            mB = lambda V: V[:, 0] > spl(V[:, 1], V[:, 2])
            deform.append((lambda V, s0=s0, s1=s1: (V[:, 0] > s0) & (V[:, 0] < s1) & mB(V), fB))
            pieces = [pA, pB]
            report["cracked_block"] = {"side": name, "s_range": [round(s0, 3), round(s1, 3)], "drop_m": 0.045,
                                       "tip_deg": 1.6, "gap_m": 0.024}
        else:
            pieces = [extrude(prof, s0, s1, 0.2)]
        for pc in pieces:
            arris_chips(pc.V, s0, s1, arr_c1 if i not in flat else arr_c1[:1], max(1, int((s1 - s0) * 0.5)),
                        rng, 0.025, 0.06)
            drop = rng.uniform(0.0, 0.006)
            tilt = rng.uniform(-0.0018, 0.0018)
            pc.V[:, 2] += -drop + tilt * (pc.V[:, 1] - 9.85)
            pc.V[:, 2] -= max(0.0, pc.V[:, 2].max())
            local_border.append(pc)
    # course 2 (step) and course 3 (plinth) with offset joints
    jit = rng.uniform(-0.3, 0.3, 8)
    e2 = [-9.36, -7.05 + jit[0], -3.45 + jit[1], 0.55 + jit[2], 4.2 + jit[3], 7.45 + jit[4], 9.36]
    e3 = [-9.36, -5.25 + jit[5], -1.25 + jit[6], 2.7 + jit[7], 6.25, 9.36]
    for edges, prof, arr, nch in ((e2, prof_c2(), [(C2_OUT - 0.015, Z_C1 - 0.015, (1.0, 1.0))], 0.9),
                                  (e3, prof_c3(), [(C3_OUT - 0.015, Z_C2 - 0.015, (1.0, 1.0)),
                                                   (C3_OUT - 0.01, -1.14, (1.0, -0.6))], 0.7)):
        for i in range(len(edges) - 1):
            s0 = edges[i] + (J if i > 0 else 0.0)
            s1 = edges[i + 1] - (J if i < len(edges) - 2 else 0.0)
            pc = extrude(prof, s0, s1, 0.2)
            arris_chips(pc.V, s0, s1, arr, max(1, int((s1 - s0) * nch)), rng, 0.03, 0.09)
            pc.V[:, 2] -= rng.uniform(0.0, 0.008)
            local_base.append(pc)
    # channel frieze (lozenge/chevron, phase-locked to the squares: 4 lozenges per square)
    fr = []
    mapfn = lambda a, b, h: np.stack([np.asarray(a, float), np.asarray(b, float), Z_CH + np.asarray(h, float)], 1)
    runs = [(-9.2, -2.3, 6), (2.3, 9.2, 6)] if plaque_side else [(-9.2, 9.2, 16)]
    for (u0, u1, nu) in runs:
        keep = lambda k: rng.uniform() > 0.07
        fr += A.lozenge_frieze(u0, u1, CH_MID - 0.195, CH_MID + 0.195, nu, mapfn, keep=keep, h=0.085, wb=0.06,
                               wt=0.034, nail_h=0.105, nail_scale=0.5, small_nails=True, embed=0.03, rng=rng, wear=0.2)
    local_border += fr
    # v007: stepped-fret relief on the fascia band of the top band's outer face (u = 10.40, z -0.31..-0.16)
    mapf = lambda a, b, h: np.stack([np.asarray(a, float), 10.40 + np.asarray(h, float), np.asarray(b, float)], 1)
    local_border.append(A.stroke(stepped_fret(-9.2, 9.2, -0.295, -0.175), mapf, wb=0.024, wt=0.014, h=0.024,
                                 embed=0.008))
    # v007: ember inlay strips set into the two grooves (top 4 mm below the stone surface)
    local_inlay = []
    for u in INLAY_U:
        w = INLAY_W / 2 - 0.004
        prof = [(u - w, -INLAY_D + 0.002), (u + w, -INLAY_D + 0.002), (u + w, -0.004), (u - w, -0.004)]
        local_inlay.append(extrude(prof, -9.28, 9.28, 0.6, end_dense=False))
    # plinth frieze inside the recessed band of course 3 (raised from the recess face, stays inside 10.925)
    mapp = lambda a, b, h: np.stack([np.asarray(a, float), 10.885 + np.asarray(h, float), np.asarray(b, float)], 1)
    local_base += A.lozenge_frieze(-9.2, 9.2, -1.36, -1.20, 16, mapp, keep=lambda k: rng.uniform() > 0.05, h=0.033,
                                   wb=0.035, wt=0.02, nail_h=0.036, nail_scale=0.5, small_nails=False, embed=0.012)
    # outer bronze bead along the outer rail
    local_bronze.append(A.stroke([(s, OUTER_BEAD_U) for s in np.linspace(-9.28, 9.28, 75)],
                                 lambda a, b, h: np.stack([a, b, h], 1), wb=0.045, wt=0.028, h=0.02, embed=0.03))
    # local deformations (cracked block) then map to world
    for pcs in (local_border, local_bronze, local_inlay):
        for pc in pcs:
            for mfn, dfn in deform:
                msk = mfn(pc.V)
                if msk.any():
                    pc.V[msk] = dfn(pc.V[msk])
    for pcs, acc, amp in ((local_border, acc_border, 0.0035), (local_base, acc_base, 0.005), (local_bronze, acc_bronze, 0.0),
                          (local_inlay, acc_inlay, 0.0)):
        if acc is None:
            continue
        for pc in pcs:
            pc.V = to_world(pc.V, th)
            if amp > 0 and len(pc.V) > 60:
                pc.displace(amp, 1.7, seed=int(rng.integers(997)))
            acc.add(pc)


def build_piers(rng, acc_border, acc_bronze, report):
    report["pyramids"] = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            seed = int(rng.integers(1 << 20))
            cfull = 0.5 * (PIER_IN + PIER_OUT)
            cdie = 0.5 * (PIER_IN + PIER_DIE_OUT)
            efull = 0.5 * (PIER_OUT - PIER_IN)
            edie = 0.5 * (PIER_DIE_OUT - PIER_IN)
            for (z0, z1, c, e) in ((Z_BOT, -1.005, cfull, efull), (-0.995, -0.485, cfull, efull),
                                   (-0.475, Z_DIE_TOP, cdie, edie)):
                pc = A.make_block((e, e, 0.5 * (z1 - z0)), rb=0.035, step=0.2, chips=5, chip_scale=1.8, rng=rng,
                                  center=(sx * c, sy * c, 0.5 * (z0 + z1)), noise_amp=0.003, seed=seed,
                                  chip_opts=dict(skip_bottom=True))
                acc_border.add(pc)
                seed += 1
            ecap = edie - 0.06
            acc_border.add(A.make_block((ecap, ecap, 0.5 * (Z_CAP_TOP - Z_DIE_TOP) + 0.005), rb=0.03, step=0.2,
                                        chips=3, chip_scale=1.2, rng=rng,
                                        center=(sx * cdie, sy * cdie, 0.5 * (Z_CAP_TOP + Z_DIE_TOP) - 0.005),
                                        noise_amp=0.002, seed=seed))
            # carved die faces: frame + lozenge + nailhead on the two outward faces
            zc = 0.5 * (-0.475 + Z_DIE_TOP)
            for nrm, O, U in (((sx, 0, 0), (sx * PIER_DIE_OUT, sy * cdie, zc), (0, 1, 0)),
                              ((0, sy, 0), (sx * cdie, sy * PIER_DIE_OUT, zc), (1, 0, 0))):
                mp = A.map_plane(O, U, (0, 0, 1), nrm)
                ew, eh = edie - 0.13, 0.5 * (Z_DIE_TOP + 0.475) - 0.11
                acc_border.add(A.stroke([(-ew, -eh), (ew, -eh), (ew, eh), (-ew, eh)], mp, 0.035, 0.02, 0.03, 0.01,
                                        closed=True))
                acc_border.add(A.stroke([(-0.46, 0), (0, -0.19), (0.46, 0), (0, 0.19)], mp, 0.032, 0.018, 0.028,
                                        0.01, closed=True))
                acc_border.add(A.nailhead(0.0, 0.0, 0.16, 0.10, 0.034, mp, embed=0.01, flat=0.14))
            # bronze plate + monumental pyramid cap (octagonal hips = chamfered arrises)
            cx, cy = sx * cdie, sy * cdie
            acc_bronze.add(A.make_block((ecap - 0.06, ecap - 0.06, 0.03), rb=0.015, step=0.3,
                                        center=(cx, cy, Z_CAP_TOP + 0.03), noise_amp=0.0, seed=seed + 7))
            # v007: stepped bronze collar + bronze band around the stone cap edge
            acc_bronze.add(A.make_block((ecap - 0.115, ecap - 0.115, 0.03), rb=0.012, step=0.3,
                                        center=(cx, cy, Z_CAP_TOP + 0.085), noise_amp=0.0, seed=seed + 8))
            ew_ = ecap - 0.022
            acc_bronze.add(A.stroke([(-ew_, -ew_), (ew_, -ew_), (ew_, ew_), (-ew_, ew_)],
                                    A.map_plane((cx, cy, Z_CAP_TOP), (1, 0, 0), (0, 1, 0), (0, 0, 1)),
                                    0.018, 0.011, 0.012, 0.006, closed=True))
            zb, za = Z_CAP_TOP + 0.115, Z_CAP_TOP + 0.115 + PYR_H
            b0, ch0 = ecap - 0.15, 0.05
            bt, cht = 0.035, 0.01

            def octo(b, c):
                return np.array([(b, b - c), (b - c, b), (-(b - c), b), (-b, b - c), (-b, -(b - c)), (-(b - c), -b),
                                 (b - c, -b), (b, -(b - c))], float)
            base_r = octo(b0, ch0)
            top_r = octo(bt, cht)
            rings = [np.c_[base_r, np.full(8, zb)], np.c_[base_r, np.full(8, zb + 0.045)]]
            broken = (sx, sy) == (1, 1)
            if broken:
                # sheared apex: break plane tilted, jagged
                zbreak = zb + 0.045 + (za - zb - 0.045) * (0.70 + 0.07 * np.sin(np.arange(8) * 2.1) +
                                                             0.05 * (base_r[:, 0] + base_r[:, 1]) / b0)
                t = (zbreak - zb - 0.045) / (za - zb - 0.045)
                xy = base_r + (top_r - base_r) * t[:, None]
                rings.append(np.c_[xy, zbreak])
            else:
                rings.append(np.c_[top_r, np.full(8, za)])
            Vp = np.concatenate(rings) + np.array([cx, cy, 0.0])
            Fp = []
            for j in range(len(rings) - 1):
                for i in range(8):
                    i2 = (i + 1) % 8
                    Fp.append([j * 8 + i, j * 8 + i2, (j + 1) * 8 + i2, (j + 1) * 8 + i])
            Fp.append(list(range(8))[::-1])
            Fp.append([(len(rings) - 1) * 8 + i for i in range(8)])
            pp = A.Piece(Vp, Fp)
            pp.fix_orientation()
            acc_bronze.add(pp)
            # v007: three engraved (raised) chevrons on each pyramid face + apex finial on intact caps
            hz = za - zb - 0.045
            for k4 in range(4):
                ang = k4 * math.pi / 2
                nrm2 = np.array([math.cos(ang), math.sin(ang)])
                tan2 = np.array([-nrm2[1], nrm2[0]])
                base_mid = np.array([cx, cy]) + nrm2 * b0
                O = np.array([base_mid[0], base_mid[1], zb + 0.045])
                apex = np.array([cx + nrm2[0] * bt, cy + nrm2[1] * bt, za])
                Vd = apex - O
                Lsl = float(np.linalg.norm(Vd))
                Vd = Vd / Lsl
                Nn = np.cross(np.array([tan2[0], tan2[1], 0.0]), Vd)
                if Nn[:2] @ nrm2 < 0:
                    Nn = -Nn
                mpp = A.map_plane(O, (tan2[0], tan2[1], 0.0), Vd, Nn)
                for j in range(3):
                    v0 = Lsl * (0.12 + 0.2 * j)
                    if broken and v0 > Lsl * 0.62:
                        continue
                    w = (b0 - ch0) * (1 - v0 / Lsl) * 0.72
                    acc_bronze.add(A.stroke([(-w, v0), (0.0, v0 + 0.32 * w), (w, v0)], mpp, 0.018, 0.010, 0.012,
                                            0.004))
            if not broken:
                fin = A.lathe([(0, 0), (0.06, 0.0), (0.075, 0.05), (0.03, 0.11), (0.045, 0.16), (0.0, 0.24)], 8)
                fin.translate((cx, cy, za - 0.02))
                acc_bronze.add(fin)
            report["pyramids"].append({"corner": [sx, sy], "centre": [round(cx, 4), round(cy, 4)],
                                       "base_m": round(2 * b0, 3), "apex_z": round(float(Vp[:, 2].max()), 3),
                                       "broken_apex": broken})


def build_plaques(acc_plaque):
    for sy in (-1, 1):
        cy = sy * CH_MID
        acc_plaque.add(A.make_block((1.50, 0.30, 0.019), rb=0.012, step=0.3, center=(0, cy, -0.001), noise_amp=0.0))
        for (ex, ey, ox, oy) in ((1.50, 0.03, 0.0, 0.27), (1.50, 0.03, 0.0, -0.27), (0.03, 0.24, 1.47, 0.0),
                                 (0.03, 0.24, -1.47, 0.0)):
            acc_plaque.add(A.make_block((ex, ey, 0.012), rb=0.006, step=0.5, center=(ox, cy + oy, 0.018),
                                        noise_amp=0.0))
        mp = A.map_plane((0, cy, 0.030), (1, 0, 0), (0, 1, 0), (0, 0, 1))
        for (u, v) in ((-1.47, -0.27), (1.47, -0.27), (1.47, 0.27), (-1.47, 0.27)):
            acc_plaque.add(A.nailhead(u, v, 0.035, 0.035, 0.015, mp, embed=0.004, flat=0.25))


def _box(x0, x1, y0, y1, z0, z1, top_mat=1):
    V = np.array([[x, y, z] for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)], float)
    F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6]]
    pc = A.Piece(V, F, [0, top_mat, 0, 0, 0, 0])
    pc.fix_orientation()
    return pc


def core_piece():
    """Core under the tiles (top = grout bed at -0.14) + v007 perimeter shadow trench (top -0.46) between the outer
    tiles and the border, so the reveal reads as a deep dark line from every view."""
    a, t = 9.30, TRENCH_IN
    out = [_box(-t, t, -t, t, Z_BOT, -0.14)]
    for (x0, x1, y0, y1) in ((-a, a, -a, -t), (-a, a, t, a), (-a, -t, -t, t), (t, a, -t, t)):
        out.append(_box(x0, x1, y0, y1, Z_BOT, -0.46))
    return A.merge_pieces(out)


# ----------------------------------------------------------------------------- build
R.reset_scene()
sc = bpy.context.scene
root = bpy.data.collections.new(ASSET)
sc.collection.children.link(root)
tcol = bpy.data.collections.new("CFCL_Board_Tiles")
root.children.link(tcol)

m_marble, m_tbas, m_grout = mat_marble(), mat_tile_basalt(), mat_grout()
m_stone = mat_stone()
m_bronze = mat_bronze()
m_inlay = mat_inlay()

rng = np.random.default_rng(20261024)
REPORT = {"asset": ASSET, "version": args.ver, "iter": args.iter}
tiles = build_tiles(tcol, m_marble, m_tbas)
acc_border, acc_base, acc_bronze, acc_plaque, acc_inlay = A.Acc(), A.Acc(), A.Acc(), A.Acc(), A.Acc()
for nm, th in SIDES.items():
    side_build(nm, th, rng, acc_border, acc_base, acc_bronze, REPORT, acc_inlay)
build_piers(rng, acc_border, acc_bronze, REPORT)
build_plaques(acc_plaque)
acc_base.add(core_piece())
# inner bronze bead: one closed mitred ring around the playfield
acc_bronze.add(A.stroke([(-BEAD_U, -BEAD_U), (BEAD_U, -BEAD_U), (BEAD_U, BEAD_U), (-BEAD_U, BEAD_U)],
                        A.map_plane((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)), wb=0.034, wt=0.046, h=0.026,
                        embed=0.12, closed=True))         # v007: undercut bead (narrower at the root)
# clamp noise overshoot: everything inside the dais contract box and above the dais top
for acc in (acc_border, acc_base, acc_bronze, acc_plaque):
    for pc in acc.pieces:
        pc.V[:, 0] = np.clip(pc.V[:, 0], -C3_OUT, C3_OUT)
        pc.V[:, 1] = np.clip(pc.V[:, 1], -C3_OUT, C3_OUT)
        pc.V[:, 2] = np.maximum(pc.V[:, 2], Z_BOT)

ob_border = acc_border.build("CFCL_Board_Border", root, [m_stone], sharp_deg=38.0)
ob_base = acc_base.build("CFCL_Board_Base", root, [m_stone, m_grout], sharp_deg=38.0)
ob_bronze = acc_bronze.build("CFCL_Board_Bronze", root, [m_bronze], sharp_deg=30.0)
ob_plaq = acc_plaque.build("CFCL_Board_Plaques", root, [m_bronze], sharp_deg=30.0)
ob_inlay = acc_inlay.build("CFCL_Board_InlayGlow", root, [m_inlay], sharp_deg=30.0)
ob_inlay["cf_runtime"] = "pulse material CFCL_BoardInlayGlow Emission Strength (0 idle)"
for o in (ob_border, ob_base, ob_bronze, ob_plaq):
    try:
        M.bake_curvature(o)
    except Exception as ex:
        print("curv fail", o.name, ex)

# ----------------------------------------------------------------------------- verification
bpy.context.view_layer.update()          # refresh matrix_world of the 64 tile objects before measuring
asset_objs = [o for o in root.all_objects if o.type == "MESH"]


def world_verts(o):
    n = len(o.data.vertices)
    co = np.empty(n * 3, np.float32)
    o.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    mw = np.array(o.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]


tile_top_max = -1e9
flat_dev = 0.0
cen_err = 0.0
chip_depth_max, chip_reach_max = 0.0, 0.0
centres = []
for ob in tiles:
    W = world_verts(ob)
    tile_top_max = max(tile_top_max, float(W[:, 2].max()))
    loc = np.array(ob.location)
    Lc = W - loc
    chipped = np.zeros(len(W), bool)
    if "cfb_chip" in ob.data.attributes:
        cv = np.empty(len(W), np.float32)
        ob.data.attributes["cfb_chip"].data.foreach_get("value", cv)
        chipped = cv > 0.5
        topc = chipped & (np.abs(Lc[:, 0]) <= TILE_E - TILE_RB + 1e-6) & (np.abs(Lc[:, 1]) <= TILE_E - TILE_RB + 1e-6)
        if topc.any():
            chip_depth_max = max(chip_depth_max, float(-Lc[topc, 2].min()))
        if chipped.any():
            cr = np.minimum(TILE_E - np.abs(Lc[chipped, 0]), TILE_E - np.abs(Lc[chipped, 1]))
            chip_reach_max = max(chip_reach_max, float(cr.max()))
    inner = (np.abs(Lc[:, 0]) <= TILE_E - TILE_RB) & (np.abs(Lc[:, 1]) <= TILE_E - TILE_RB) & (Lc[:, 2] > -0.05) & ~chipped
    if inner.any():
        flat_dev = max(flat_dev, float(np.abs(Lc[inner, 2]).max()))
    sqn = ob["cf_square"]
    f, r = FILES.index(sqn[0]), int(sqn[1]) - 1
    fx, fy = (f - 3.5) * SQ, (r - 3.5) * SQ
    # top-face centre from the unchipped interior verts of the top face
    top = (np.abs(Lc[:, 2]) < 1e-6)
    tc = W[top][:, :2]
    tcen = 0.5 * (tc.min(0) + tc.max(0))
    cen_err = max(cen_err, abs(loc[0] - fx), abs(loc[1] - fy), abs(loc[2]), float(np.abs(tcen - [fx, fy]).max()))
    centres.append({"square": sqn, "index_a1_0": 8 * r + f, "blender_x_m": round(fx, 4), "blender_y_m": round(fy, 4),
                    "blender_z_m": 0.0, "gltf_x_m": round(fx, 4), "gltf_y_m": 0.0, "gltf_z_m": round(-fy, 4),
                    "colour": ob["cf_colour"]})
centres.sort(key=lambda d: d["index_a1_0"])
Wb = world_verts(ob_border)
not_corner = np.minimum(np.abs(Wb[:, 0]), np.abs(Wb[:, 1])) < PIER_IN - 0.01
Wbr = world_verts(ob_bronze)
br_not_corner = np.minimum(np.abs(Wbr[:, 0]), np.abs(Wbr[:, 1])) < PIER_IN - 0.01
Wp = world_verts(ob_plaq)
mn, mx = R.bounds(asset_objs)
tile_mn, tile_mx = R.bounds(tiles)
tris = {o.name: R.tri_count([o]) for o in (ob_border, ob_base, ob_bronze, ob_plaq, ob_inlay)}
tris["CFCL_Board_Tiles(64)"] = R.tri_count(tiles)
REPORT["verify"] = {
    "tile_top_max_z": round(tile_top_max, 7),
    "tile_top_flat_max_abs_dev_m (excl. chipped corners)": round(flat_dev, 7),
    "chipped_tiles": len(CHIPPED), "cracked_tiles": len(CRACKED),
    "chip_max_depth_on_top_corner_m": round(chip_depth_max, 4),
    "chip_max_reach_from_edge_m": round(chip_reach_max, 4),
    "square_centre_max_err_m": round(cen_err, 7),
    "a1": [round(tiles[0].location.x, 4), round(tiles[0].location.y, 4), tiles[0]["cf_colour"]],
    "h8": [round(tiles[63].location.x, 4), round(tiles[63].location.y, 4), tiles[63]["cf_colour"]],
    "tiles_bounds": [[round(v, 4) for v in tile_mn], [round(v, 4) for v in tile_mx]],
    "overall_bounds": [[round(v, 4) for v in mn], [round(v, 4) for v in mx]],
    "overall_dims_m": [round(mx[i] - mn[i], 4) for i in range(3)],
    "border_top_max_z_excl_piers": round(float(Wb[not_corner, 2].max()), 4),
    "bronze_trim_max_z_excl_pyramids": round(float(Wbr[br_not_corner, 2].max()), 4),
    "plaques_max_z": round(float(Wp[:, 2].max()), 4),
    "inlay_max_z": round(float(world_verts(ob_inlay)[:, 2].max()), 4),
    "pier_cap_and_pyramid_max_z": round(float(Wbr[:, 2].max()), 4),
    "base_min_z": round(float(world_verts(ob_base)[:, 2].min()), 4),
    "max_abs_xy_all": round(max(abs(mn[0]), abs(mn[1]), mx[0], mx[1]), 4),
    "tris": tris,
    "tris_total": int(sum(tris.values())),
}
print("VERIFY", json.dumps(REPORT["verify"], indent=1), flush=True)

# ----------------------------------------------------------------------------- save asset (clean)
blend = os.path.join(ADIR, f"{ASSET}_v{args.ver:03d}.blend")
for o in asset_objs:
    o.select_set(False)
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
REPORT["blend"] = blend
R.write_json(os.path.join(ADIR, "square_centres.json"), centres)
meta = {"asset": ASSET, "version": args.ver, "blend": os.path.basename(blend), "units": "world metres, +Z up",
        "origin": "board centre (0,0,0) = centre of the playing surface; identity transforms; player on -Y",
        "square_m": SQ, "playing_area_m": 2 * HALF, "tile_m": 2 * TILE_E, "tile_thickness_m": TILE_H,
        "tile_bevel_m": TILE_RB, "tile_top_z": 0.0,
        "square_centre_formula": "((f-3.5)*2.3, (r-3.5)*2.3, 0); a1 dark at (-8.05,-8.05); tile object origin = centre",
        "objects": {o.name: {"tris": R.tri_count([o]), "materials": [m.name for m in o.data.materials if m]}
                    for o in (ob_border, ob_base, ob_bronze, ob_plaq, ob_inlay)},
        "tiles": "64 objects CFCL_Board_Tile_<sq> in sub-collection CFCL_Board_Tiles (custom props cf_square, "
                 "cf_index_a1_0, cf_colour, cf_chipped, cf_cracked)",
        "collection": ASSET, "verify": REPORT["verify"],
        "dais_contract": "all geometry within |x|,|y| <= 10.925 m (CFCL_Arch_AltarDais v006 BoardSkirt box); base bottom Z=-1.55",
        "lod": "LOD0 only; procedural materials - bake before runtime/GLB export"}
R.write_json(os.path.join(ADIR, "meta.json"), meta)
print("SAVED", blend, flush=True)

# ----------------------------------------------------------------------------- preview context (not saved)
if not args.norender:
    R.setup_render(sc, "EEVEE", (1280, 720), args.samples)
    R.setup_world(sc)
    R.standard_lights(11.0)
    prev = bpy.data.collections.new("PREVIEW_ONLY")
    sc.collection.children.link(prev)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=16.0, depth=0.8, location=(0, 0, Z_BOT - 0.4))
    disc = bpy.context.active_object
    disc.name = "PREVIEW_Dais"
    M.assign(disc, "AncientStone")
    bpy.ops.mesh.primitive_plane_add(size=240, location=(0, 0, -6.0))
    lava = bpy.context.active_object
    lava.name = "PREVIEW_Lava"
    M.assign(lava, "Lava")
    pm = bpy.data.materials.new("PREVIEW_ProxyGrey")
    pm.diffuse_color = (0.2, 0.2, 0.2, 1)
    try:
        pm.use_nodes = True
        pm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.16, 0.17, 1)
        pm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    except Exception:
        pass
    def mannequin(px, py, yaw):
        """1.78 m spear-carrying human silhouette (preview scale reference only, never saved)."""
        parts = []
        cy_, sy_ = math.cos(yaw), math.sin(yaw)

        def P(x, y, z):
            return (px + cy_ * x - sy_ * y, py + sy_ * x + cy_ * y, z)
        for (x, y, z, r, d, rx, ry) in ((-0.10, 0, 0.43, 0.085, 0.86, 0, 4), (0.10, 0, 0.43, 0.085, 0.86, 0, -4),
                                        (0, 0, 1.15, 0.17, 0.62, 0, 0), (-0.25, 0, 1.13, 0.055, 0.62, 0, 12),
                                        (0.25, 0.08, 1.20, 0.055, 0.55, -40, -10), (0.33, 0.2, 1.31, 0.018, 2.6, 0, 0)):
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=d, location=P(x, y, z),
                                                rotation=(math.radians(rx), math.radians(ry), yaw))
            parts.append(bpy.context.active_object)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.115, location=P(0, 0, 1.665))
        parts.append(bpy.context.active_object)
        for o in parts:
            o.data.materials.append(pm)
            for c in list(o.users_collection):
                c.objects.unlink(o)
            prev.objects.link(o)
            o.name = "PREVIEW_ScaleProxy_1.8m"
    for (px, py, yaw) in ((-1.15, -1.15, 0.3), (3.45, 3.45, 2.8), (-3.45, -8.05, 0.0)):
        mannequin(px, py, yaw)
    for o in (disc, lava):
        for c in list(o.users_collection):
            c.objects.unlink(o)
        prev.objects.link(o)
    views = args.views.split(",")
    CAMS = {"a": ("soldier", (3.0, -9.0, 1.8), (0.0, 8.0, 1.2), 24.0),
            "b": ("elevated34", (-18.0, -24.0, 16.0), (0.0, 0.0, -1.0), 30.0),
            "d": ("corner_close", (-5.0, -15.2, 2.6), (-9.3, -9.9, 0.15), 35.0),
            "e": ("west_story", (-17.0, -6.5, 4.2), (-9.8, -2.6, -0.4), 35.0),
            "f": ("tile_detail", (-0.5, -10.6, 3.8), (-0.8, -5.0, 0.0), 35.0),
            "g": ("god_gameplay", (0.0, -26.0, 30.0), (0.0, 2.0, -2.0), 26.0),
            "h": ("border_close", (2.6, -14.2, 1.9), (0.0, -9.9, -0.15), 35.0)}
    REPORT["renders"] = []
    for v in views:
        if v in CAMS:
            nm, loc, tgt, lens = CAMS[v]
            cam = R.camera("CAM_" + nm, loc, tgt, lens)
            sc.render.resolution_x, sc.render.resolution_y = 1280, 720
        elif v == "c":
            nm = "top_ortho"
            cam = R.camera("CAM_top", (0, 0, 40.0), (0, 0.0001, 0), 50.0)
            cam.rotation_euler = (0, 0, 0)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = 22.6
            sc.render.resolution_x, sc.render.resolution_y = 720, 720
        else:
            continue
        p = os.path.join(RDIR, f"iter{args.iter:02d}_{v}_{nm}.png")
        t1 = time.time()
        R.render_to(p, cam)
        REPORT["renders"].append({"view": v, "path": p, "s": round(time.time() - t1, 1)})
    # v007: show the runtime inlay pulse (Emission Strength driven by the game; asset default stays 0.0)
    if "pulse" in views and "CFCL_BoardInlayGlow" in bpy.data.materials:
        bsdf = [n for n in bpy.data.materials["CFCL_BoardInlayGlow"].node_tree.nodes if n.type == "BSDF_PRINCIPLED"][0]
        bsdf.inputs["Emission Strength"].default_value = 2.5
        for v in ("b", "h"):
            nm, loc, tgt, lens = CAMS[v]
            cam = R.camera("CAM_pulse_" + nm, loc, tgt, lens)
            sc.render.resolution_x, sc.render.resolution_y = 1280, 720
            p = os.path.join(RDIR, f"iter{args.iter:02d}_{v}_{nm}_PULSE.png")
            R.render_to(p, cam)
            REPORT["renders"].append({"view": v + "_pulse", "path": p})
        bsdf.inputs["Emission Strength"].default_value = 0.0
REPORT["seconds"] = round(time.time() - T0, 1)
R.write_json(os.path.join(RDIR, f"iter{args.iter:02d}_report.json"), REPORT)
print("BOARD_ARENA_DONE", REPORT["seconds"], flush=True)
