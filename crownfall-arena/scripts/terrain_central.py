"""CFCL_Terrain_Central - rock that carries the altar, plus the skull seat, hand seat, buried spine ridge
and the broken rear lip (offset slabs with lava gaps).  REVISED scale (2026-10-23 20:05 contract).

Objects (all modelled in WORLD coordinates; origin moved to the plateau-top centre of each piece and the
object location set there, so appending the collection drops everything in place):
  CFCL_Terrain_Central     plateau top Z=-0.86, r~3.85 (dips to ~3.35 toward skull/hand so the lava clefts
                           cut in close), flat dais seat r<3.55, broken tilted rim slabs, stratified cliffs
                           with ledges/undercuts, foot below the lava (Z -3.8)
  CFCL_Terrain_SkullSeat   (-3.3, 9.0) top ~-0.6, ~4 m plateau, tilted bed + compression rim for the skull,
                           ejecta blocks fanned away from the board
  CFCL_Terrain_HandSeat    (4.0, 10.0) mound top ~-0.5, ~3.5 m, forearm socket r~0.5 tilted toward the
                           eclipse, heaved plates around the wrist
  CFCL_Terrain_SpineRidge  4 knobbed vertebra masses from behind the altar toward the skull base (story line)
  CFCL_Terrain_RearSlabs   broken rear lip: 5 offset/tilted slabs between the plateau and the gate, gaps
Materials: Basalt (cliffs) + AncientStone on up-facing tops.

Run:  python lib/run_blender.py scripts/terrain_central.py -- --iter 1 [--norender] [--only Central]
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, S, M, R, F32, Vector

ASSET = "CFCL_Terrain_Central"
args = T.get_args()
ITER = int(args.get("iter", 1))
OUT = os.path.join(T.RENDERS, "central")
os.makedirs(OUT, exist_ok=True)
LAVA = LD.LAVA_Z_NEAR


# ---------------------------------------------------------------------------------------------
def band_set(rng, n, var=(0.9, 1.08), mean_h=0.42, ngl=8):
    """Strata description: irregular band thicknesses, recessed (undercut) / protruding (ledge) bands,
    per-band offsets + 2 cleavage planes, a global set of vertical cleavage planes and fissures."""
    th = mean_h * rng.choice([0.45, 0.7, 1.0, 1.3, 1.7], n, p=[0.15, 0.25, 0.3, 0.2, 0.1])
    cum = np.cumsum(th)
    bs = rng.uniform(var[0], var[1], n)
    kind = rng.random(n)
    bs[kind < 0.28] = rng.uniform(0.8, 0.88, int((kind < 0.28).sum()))      # recessed soft beds
    bs[kind > 0.85] = rng.uniform(1.05, 1.1, int((kind > 0.85).sum()))      # protruding hard beds
    bs[0] = max(bs[0], 0.97)
    bo = rng.normal(0, 0.03, (n, 2))
    pa = rng.uniform(0, 2 * np.pi, (n, 2))
    po = rng.uniform(0.84, 0.97, (n, 2))
    ga = np.sort(rng.uniform(0, 2 * np.pi / ngl, ngl) + np.arange(ngl) * 2 * np.pi / ngl)
    go = rng.uniform(0.86, 0.98, ngl)
    fis = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.02, 0.05), rng.uniform(0.2, 0.45))
           for _ in range(int(rng.integers(6, 12)))]
    dip = rng.normal(0, 0.09, 2)
    return dict(cum=cum, bs=bs, bo=bo, pa=pa, po=po, ga=ga, go=go, fis=fis, dip=dip)


def strata_side(P, Pw, cx, cy, Rfun, top_z, band_h, bands, seed, taper=0.0, flare=None):
    """Signed side distance of a stratified, cleaved rock mass."""
    B = bands
    bs, bo, pa, po = B["bs"], B["bo"], B["pa"], B["po"]
    nbt = len(bs)
    x = Pw[:, 0] - cx
    y = Pw[:, 1] - cy
    z = Pw[:, 2]
    phi = np.arctan2(y, x)
    Rp = Rfun(phi)
    wob = S.fbm(P * F32(0.5), 1.0, 2, seed=seed + 9) * 0.12
    t = (top_z - z) + x * B["dip"][0] + y * B["dip"][1] + wob
    b = np.clip(np.searchsorted(B["cum"], t), 0, nbt - 1).astype(np.int32)
    Rz = Rp * bs[b] * (1.0 - taper * b)
    if flare is not None:   # (z_center, width, amount): widen near the lava line
        zc, wd, am = flare
        Rz = Rz * (1.0 + am * np.exp(-((z - zc) / wd) ** 2))
    xo = x - bo[b, 0] * Rp
    yo = y - bo[b, 1] * Rp
    rho = np.sqrt(xo * xo + yo * yo)
    side = (rho - Rz) * 0.9
    for i in range(2):
        side = np.maximum(side, xo * np.cos(pa[b, i]) + yo * np.sin(pa[b, i]) - po[b, i] * Rz)
    for a, o in zip(B["ga"], B["go"]):            # global vertical cleavage -> polygonal outline
        side = np.maximum(side, xo * math.cos(a) + yo * math.sin(a) - o * Rfun(np.full(1, a))[0] * bs[b])
    for a, w, dep in B["fis"]:                    # vertical joints / fissures cut into the faces
        perp = np.abs(-xo * math.sin(a) + yo * math.cos(a))
        along = xo * math.cos(a) + yo * math.sin(a)
        rem = np.maximum(perp - w, (Rz - dep) - along)
        side = np.maximum(side, -rem)
    return side


def tier_drop(P, cx, cy, Rfun, seed, nsect=7):
    """Broken stepped top: two outward tiers whose drop varies per angular sector (no flat table)."""
    rng = np.random.default_rng(seed + 77)
    off = rng.uniform(0, 2 * np.pi)
    d1 = rng.uniform(0.08, 0.32, nsect)
    d2 = rng.uniform(0.15, 0.45, nsect)
    r1 = rng.uniform(0.5, 0.68, nsect)
    x = P[:, 0] - cx
    y = P[:, 1] - cy
    phi = np.arctan2(y, x)
    rr = np.sqrt(x * x + y * y) / Rfun(phi)
    k = np.floor(((phi - off) % (2 * np.pi)) / (2 * np.pi / nsect)).astype(np.int32)
    t1 = np.clip((rr - r1[k]) / 0.04, 0, 1)
    t2 = np.clip((rr - (r1[k] + 0.2)) / 0.04, 0, 1)
    return t1 * d1[k] + t2 * d2[k]


def spur_sdf(P, Pw, a, b, half_w, top_z, seed, grow=0.04):
    """Stratified cliff spur (2D capsule a->b) whose beds widen downward: connects a seat to the banks."""
    rng = np.random.default_rng(seed)
    ins = rng.uniform(0.86, 1.0, 40)
    x, y, z = Pw[:, 0], Pw[:, 1], Pw[:, 2]
    ax_, ay_ = a
    bx_, by_ = b
    dx, dy = bx_ - ax_, by_ - ay_
    L2 = dx * dx + dy * dy
    t = np.clip(((x - ax_) * dx + (y - ay_) * dy) / L2, 0, 1)
    dist = np.hypot(x - (ax_ + t * dx), y - (ay_ + t * dy))
    band = np.clip(np.floor((top_z - z) / 0.36 + 0.12 * S.fbm(P * F32(0.6), 1.0, 2, seed=seed)), 0, 39).astype(np.int32)
    w = half_w * ins[band] * (1 + grow * band) * (1 - 0.25 * t)
    ztop = top_z - 0.25 * t + 0.05 * S.fbm(P * F32(1.2), 1.0, 2, seed=seed + 1)
    return np.maximum(dist - w, z - ztop)


def ring_noise(phi, seed, f1=1.7, f2=4.3):
    ring = np.stack([np.cos(phi) * f1, np.sin(phi) * f1, np.full_like(phi, seed * 0.31)], 1).astype(F32)
    ring2 = np.stack([np.cos(phi) * f2, np.sin(phi) * f2, np.full_like(phi, seed * 0.57)], 1).astype(F32)
    return S.perlin(ring, seed) + 0.4 * S.perlin(ring2, seed + 1)


def gauss_ang(phi, c, w):
    d = np.angle(np.exp(1j * (phi - c)))
    return np.exp(-(d / w) ** 2)


# ---------------------------------------------------------------------------------------------
def central_sdf():
    seed = 1201
    rng = np.random.default_rng(seed)
    top = LD.PLATEAU_Z
    phiL, phiR = math.radians(125), math.radians(55)       # toward skull / hand (lava clefts)

    def Rfun(phi):
        # MAIN SCENE: the dais is r 4.2-4.5 -> rock r >= 4.7 everywhere, clefts start just beyond
        return LD.PLATEAU_R + 0.22 * ring_noise(phi, seed) + 0.05 * gauss_ang(phi, phiL, 0.3)

    bands = band_set(rng, 12, (0.9, 1.06), mean_h=0.42, ngl=9)
    nseg = 11
    seg_off = rng.uniform(0, 2 * np.pi)
    seg_drop = rng.uniform(0.05, 0.45, nseg)
    seg_tilt = np.tan(np.radians(rng.uniform(4, 16, nseg)))
    seg_drop[rng.choice(nseg, 3, replace=False)] *= 0.25
    cracks = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.03, 0.06)) for _ in range(5)]
    seat_cracks = [(rng.uniform(0, np.pi), rng.uniform(-3.2, 3.2), rng.uniform(0.008, 0.02)) for _ in range(6)]

    def f(P):
        Pw = S.warp(P, 0.05, 0.55, seed=seed, octaves=2)
        side = strata_side(P, Pw, 0, 0, Rfun, top - 0.05, 0.42, bands, seed, taper=0.004,
                           flare=(LAVA - 0.6, 0.7, 0.07))
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        rho = np.sqrt(x * x + y * y)
        phi = np.arctan2(y, x)
        sidx = np.floor(((phi - seg_off) % (2 * np.pi)) / (2 * np.pi / nseg)).astype(np.int32)
        SR = LD.DAIS_SEAT_R
        rr = np.maximum(rho - SR, 0.0)
        ztop = top + 0.008 * S.fbm(P * F32(1.5), 1.0, 2, seed=seed + 4) - (rho > SR) * (
            seg_drop[sidx] + rr * seg_tilt[sidx])
        d = np.maximum(side, z - ztop)
        # segment gaps (radial cracks through the rim only)
        ang = ((phi - seg_off) % (2 * np.pi / nseg))
        gapd = np.minimum(ang, 2 * np.pi / nseg - ang) * rho - 0.05
        rem = np.maximum(np.maximum(gapd, SR - 0.05 - rho), (top - 0.55) - z)
        d = np.maximum(d, -rem)
        # a few longer cracks running from the skull side, stopping at the dais seat (r 3.55)
        for a, w in cracks:
            proj_n = -x * math.sin(a) + y * math.cos(a)
            rem = np.maximum(np.maximum(np.abs(proj_n) - w, SR + 0.05 - rho), (top - 0.35) - z)
            d = np.maximum(d, -rem)
        for a, c, w in seat_cracks:                       # shallow fracture lines across the dais seat
            proj_n = -x * math.sin(a) + y * math.cos(a) - c
            rem = np.maximum(np.abs(proj_n) - w, (top - 0.06) - z)
            d = np.maximum(d, -rem)
        d = np.maximum(d, -(z - (LAVA - 1.35)))          # foot below the lava
        d = d + 0.018 * S.fbm(P * F32(2.2), 1.0, 3, seed=seed + 7)
        return d

    return f, (-6.2, -6.2, LAVA - 1.45), (6.2, 6.2, top + 0.12), 0.046, (0, 0, top)


def skull_seat_sdf():
    seed = 1301
    rng = np.random.default_rng(seed)
    cx, cy, top = LD.SKULL_SEAT
    yaw = math.atan2(-cy, -cx)                 # direction toward the board

    def Rfun(phi):
        return 2.1 + 0.38 * ring_noise(phi, seed) + 0.3 * gauss_ang(phi, yaw + math.pi, 0.7)

    bands = band_set(rng, 10, (0.93, 1.02), mean_h=0.38, ngl=8)
    ej = []                                     # ejecta blocks fanned away from the board
    for i in range(6):
        a = yaw + math.pi + rng.normal(0, 0.6)
        dist = rng.uniform(1.4, 2.2)
        ej.append((cx + dist * math.cos(a), cy + dist * math.sin(a), top + rng.uniform(-0.12, 0.05),
                   rng.uniform(0.28, 0.55), rng.uniform(0, 180), rng.uniform(-30, 30)))
    radial = [yaw + rng.uniform(-1.2, 1.2) for _ in range(5)]
    bx, by = cx + 0.15 * math.cos(yaw), cy + 0.15 * math.sin(yaw)

    def f(P):
        Pw = S.warp(P, 0.04, 0.7, seed=seed, octaves=2)
        side = strata_side(P, Pw, cx, cy, Rfun, top - 0.05, 0.38, bands, seed, taper=-0.035,
                           flare=(LAVA - 0.5, 0.6, 0.1))
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        lx, ly = x - bx, y - by
        # tilted top: down toward the board by ~6 deg, stepped broken tiers toward the rim
        u = lx * math.cos(yaw) + ly * math.sin(yaw)
        v = -lx * math.sin(yaw) + ly * math.cos(yaw)
        ztop = top - 0.1 * u + 0.025 * S.fbm(P * F32(1.3), 1.0, 3, seed=seed + 3) - tier_drop(P, cx, cy, Rfun, seed)
        d = np.maximum(side, z - ztop)
        # spurs: toward the broken rear lip and back into the far bank (connected cliffs, not a mushroom)
        d = S.smin(d, spur_sdf(P, Pw, (cx + 0.8, cy - 0.3), (-0.9, 8.3), 1.0, top - 0.45, seed + 31), 0.2)
        d = S.smin(d, spur_sdf(P, Pw, (cx, cy + 1.0), (-3.2, 13.0), 1.25, top - 0.25, seed + 32), 0.2)
        # skull bed: irregular impact depression (~3 x 2.6 m, ~0.35 deep), radial cracks toward the altar
        bed = S.ellipsoid(Pw, (bx, by, top + 0.55), (1.6, 1.4, 0.9)) + 0.06 * S.fbm(P * F32(1.8), 1.0, 2, seed=seed + 11)
        d = S.ssub(d, bed, 0.1)
        for a in radial:
            proj_n = -(x - bx) * math.sin(a) + (y - by) * math.cos(a)
            along = (x - bx) * math.cos(a) + (y - by) * math.sin(a)
            rem = np.maximum(np.maximum(np.abs(proj_n) - 0.035, 1.2 - along), (top - 0.3) - z)
            d = np.maximum(d, -rem)
        for (ex, ey, ez, s, a, t) in ej:
            Rm = S.rot_matrix(t, t * 0.5, a)
            blk = S.box(P, (ex, ey, ez), (s, s * 0.7, s * 0.45), Rm, round_r=0.02)
            blk = np.maximum(blk, (P - np.array([ex, ey, ez], F32)) @ np.array([0.6, -0.5, 0.62], F32) - 0.25 * s)
            d = np.minimum(d, blk)
        d = np.maximum(d, -(z - (LAVA - 1.2)))
        d = d + 0.014 * S.fbm(P * F32(2.6), 1.0, 3, seed=seed + 8)
        return d

    return f, (cx - 3.3, cy - 3.3, LAVA - 1.3), (0.4, 14.6, top + 0.45), 0.037, (cx, cy, top)


def hand_seat_sdf():
    seed = 1401
    rng = np.random.default_rng(seed)
    cx, cy, top = LD.HAND_SEAT

    def Rfun(phi):
        return 1.8 + 0.3 * ring_noise(phi, seed)

    bands = band_set(rng, 10, (0.93, 1.02), mean_h=0.36, ngl=7)
    # forearm socket axis: tilted ~15 deg toward the eclipse (+Y, slightly +X)
    ax = np.array([0.08, 0.26, 1.0])
    ax /= np.linalg.norm(ax)
    sock_c = np.array([cx + 0.1, cy + 0.05, top + 0.2])
    plates = []
    for i in range(5):
        a = i * 2 * np.pi / 5 + rng.uniform(-0.4, 0.4)
        plates.append((a, rng.uniform(15, 30), rng.uniform(0.6, 1.0), rng.uniform(0.4, 0.75),
                       rng.uniform(0.72, 1.0), rng.uniform(-25, 25)))

    def f(P):
        Pw = S.warp(P, 0.04, 0.7, seed=seed, octaves=2)
        side = strata_side(P, Pw, cx, cy, Rfun, top - 0.25, 0.36, bands, seed, taper=-0.035,
                           flare=(LAVA - 0.5, 0.6, 0.12))
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        rho = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        ztop = top - 0.22 - 0.12 * (rho / 1.8) ** 2 + 0.03 * S.fbm(P * F32(1.4), 1.0, 3, seed=seed + 3) \
            - tier_drop(P, cx, cy, Rfun, seed)
        d = np.maximum(side, z - ztop)
        d = S.smin(d, spur_sdf(P, Pw, (cx - 0.8, cy - 0.4), (2.3, 8.6), 0.95, top - 0.5, seed + 31), 0.2)
        d = S.smin(d, spur_sdf(P, Pw, (cx + 0.2, cy + 1.0), (4.8, 13.6), 1.15, top - 0.3, seed + 32), 0.2)
        # heaved plates tilted outward around the wrist
        for (a, tilt, ln, wd, rr, yj) in plates:
            px = cx + math.cos(a) * rr
            py = cy + math.sin(a) * rr
            Rm = S.rot_matrix(0, tilt, math.degrees(a) + yj)
            pl = S.box(P, (px, py, top - 0.12), (ln * 0.5, wd * 0.5, 0.1), Rm, round_r=0.012)
            pl = np.maximum(pl, (P - np.array([px, py, top], F32)) @ np.array(
                [math.cos(a + 1.3), math.sin(a + 1.3), 0.2], F32) - 0.22 * ln)
            d = np.minimum(d, pl)
        # forearm socket (open hole following the forearm axis)
        q = P - sock_c[None, :].astype(F32)
        h = q @ ax.astype(F32)
        perp = np.sqrt(np.maximum((q * q).sum(1) - h * h, 0))
        hole = np.maximum(perp - 0.5, -h - 1.4)
        d = np.maximum(d, -hole)
        d = np.maximum(d, -(z - (LAVA - 1.2)))
        d = d + 0.014 * S.fbm(P * F32(2.6), 1.0, 3, seed=seed + 8)
        return d

    return f, (1.0, cy - 2.9, LAVA - 1.3), (cx + 2.9, 15.0, top + 0.35), 0.035, (cx, cy, top)


def spine_sdf():
    """4 knobbed vertebra-like masses on a line from behind the altar toward the skull base."""
    seed = 1501
    rng = np.random.default_rng(seed)
    a = np.array([-0.55, 4.55])
    b = np.array([-2.15, 7.25])
    dirv = (b - a) / np.linalg.norm(b - a)
    perp = np.array([-dirv[1], dirv[0]])
    yaw = math.degrees(math.atan2(dirv[1], dirv[0]))
    verts = []
    for i in range(4):
        t = i / 3.0
        c = a + (b - a) * t
        s = 1.45 * (1.0 - 0.15 * t)
        # half-sunk in the lava: tops stay below the far-rail sightline of the 20 mm Codex hero (~Z -1.0)
        verts.append((c[0], c[1], -1.75 - 0.12 * i + rng.normal(0, 0.05), s, rng.uniform(-14, 14)))

    def f(P):
        Pw = S.warp(P, 0.035, 0.9, seed=seed, octaves=2)
        d = None
        for vi, (x0, y0, z0, s, roll) in enumerate(verts):
            Rm = S.rot_matrix(roll, 0, yaw)
            body = S.box(Pw, (x0, y0, z0 - 0.45 * s), (0.36 * s, 0.5 * s, 0.55 * s), Rm, round_r=0.04 * s)
            spin = S.round_cone(Pw, (x0, y0, z0 - 0.05), (x0 - dirv[0] * 0.18, y0 - dirv[1] * 0.18, z0 + 0.3 * s),
                                0.24 * s, 0.13 * s)
            tl = S.round_cone(Pw, (x0 + perp[0] * 0.2, y0 + perp[1] * 0.2, z0 - 0.15),
                              (x0 + perp[0] * 0.6 * s, y0 + perp[1] * 0.6 * s, z0 - 0.28), 0.17 * s, 0.1 * s)
            tr = S.round_cone(Pw, (x0 - perp[0] * 0.2, y0 - perp[1] * 0.2, z0 - 0.15),
                              (x0 - perp[0] * 0.5 * s, y0 - perp[1] * 0.5 * s, z0 - 0.34), 0.16 * s, 0.09 * s)
            v = S.smin(S.smin(S.smin(body, spin, 0.05), tl, 0.04), tr, 0.04)
            vr = np.random.default_rng(seed + vi)
            for k in range(7):                     # cleavage: fractured, faceted masses
                nrm = vr.normal(size=3)
                nrm[2] = abs(nrm[2]) * 0.6
                nrm /= np.linalg.norm(nrm)
                v = np.maximum(v, (Pw - np.array([x0, y0, z0 - 0.3 * s], F32)) @ nrm.astype(F32)
                               - vr.uniform(0.32, 0.55) * s)
            for k in range(2):                     # broken notch / missing chunk
                c = np.array([x0, y0, z0 - 0.2 * s]) + vr.normal(0, 0.35, 3) * s
                v = S.ssub(v, S.box(Pw, tuple(c), (0.22 * s, 0.25 * s, 0.2 * s),
                                    S.rot_matrix(*vr.uniform(0, 90, 3)), 0.0), 0.02)
            d = v if d is None else np.minimum(d, v)
        d = d + 0.07 * (S.ridged(P, 3.2, 3, seed=seed + 2) - 0.5) + 0.025 * S.fbm(P * F32(6.0), 1.0, 2, seed=seed)
        d = np.maximum(d, -(P[:, 2] - (LAVA - 1.0)))
        return d

    lo = np.minimum(a, b) - 1.7
    hi = np.maximum(a, b) + 1.7
    return f, (lo[0], lo[1], LAVA - 1.1), (hi[0], hi[1], -0.9), 0.034, (float(a[0] + b[0]) / 2,
                                                                      float(a[1] + b[1]) / 2, -1.5)


def rear_slabs_sdf():
    """Broken rear lip: offset, tilted slabs stepping from the plateau toward the gate, lava in the gaps."""
    seed = 1601
    rng = np.random.default_rng(seed)
    slabs = [  # (cx, cy, top_z, half x, half y, yaw, tilt_x, tilt_y)
        (0.9, 4.55, -0.98, 1.15, 0.62, 8, 4, -6),
        (2.35, 5.35, -1.12, 0.75, 0.85, -14, -7, 3),
        (0.55, 6.15, -1.05, 1.0, 0.55, 18, 9, 5),
        (1.95, 7.2, -0.88, 0.95, 0.7, -6, -3, -9),
        (0.2, 8.15, -0.95, 1.25, 0.6, 12, 5, 4),
        (2.05, 8.75, -1.3, 0.6, 0.5, 30, 14, -8),
    ]

    def f(P):
        Pw = S.warp(P, 0.03, 1.0, seed=seed, octaves=2)
        d = None
        for i, (x0, y0, zt, hx, hy, yaw, tx, ty) in enumerate(slabs):
            hz = (zt - (LAVA - 1.0)) * 0.5
            Rm = S.rot_matrix(tx, ty, yaw)
            v = S.box(Pw, (x0, y0, zt - hz), (hx, hy, hz), Rm, round_r=0.03)
            # 2 cleavage cuts per slab + strata notch
            for k in range(2):
                a = rng.uniform(0, 2 * np.pi) if False else (i * 1.7 + k * 2.3)
                n = np.array([math.cos(a), math.sin(a), 0.25 * (k - 0.5)])
                n /= np.linalg.norm(n)
                off = 0.75 * (abs(n[0]) * hx + abs(n[1]) * hy)
                v = np.maximum(v, (Pw - np.array([x0, y0, zt - 0.3], F32)) @ n.astype(F32) - off)
            d = v if d is None else np.minimum(d, v)
        d = d + 0.02 * S.fbm(P * F32(2.4), 1.0, 3, seed=seed + 1)
        return d

    return f, (-1.6, 3.5, LAVA - 1.1), (3.6, 9.6, -0.6), 0.032, (1.2, 6.5, -0.95)


PIECES = {
    "Central": (central_sdf, 58000),
    "SkullSeat": (skull_seat_sdf, 45000),
    "HandSeat": (hand_seat_sdf, 40000),
    "SpineRidge": (spine_sdf, 14000),
    "RearSlabs": (rear_slabs_sdf, 16000),
}


def build(key, col):
    fn, target = PIECES[key]
    f, bmin, bmax, vox, origin = fn()
    ob = T.sdf_object("CFCL_Terrain_" + key, f, bmin, bmax, vox, col, target_tris=None, sharp_angle=None)
    T.drop_small_parts(ob, 80)
    T.decimate_to(ob, target)
    T.shade(ob, True, 45)
    M.assign(ob, "Basalt")
    T.set_origin(ob, origin)
    return ob


def main():
    R.reset_scene()
    col = T.new_collection(ASSET)
    only = args.get("only")
    obs = []
    for k in PIECES:
        if only and k != only:
            continue
        ob = build(k, col)
        obs.append(ob)
        T.log(k, "tris", R.tri_count([ob]), "dims", [round(x, 2) for x in ob.dimensions], "loc",
              [round(c, 2) for c in ob.location])
    bpy.context.view_layer.update()
    path, ver = T.next_version_path(ASSET, ITER)
    T.save_blend(path)
    T.write_json(os.path.join(T.ASSETS, ASSET, "arrangement.json"),
                 {"asset": ASSET, "blend": os.path.basename(path),
                  "placements": [{"source": o.name, "name": o.name, "location": [round(c, 4) for c in o.location],
                                  "rotation_deg": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]} for o in obs]})
    T.write_json(os.path.join(T.ASSETS, ASSET, "meta.json"),
                 {"asset": ASSET, "blend": os.path.basename(path), "version": ver,
                  "objects": [T.obj_info(o) for o in obs],
                  "origin": "each object: centre of its top plateau, object location = world placement "
                            "(saved in place; rotation 0, scale 1)",
                  "material_slots": ["CFCL_Basalt (moss on up-facing planes from the material mask)"],
                  "budget_tris_each": 60000, "lava_level_near": LAVA, "plateau_top_z": LD.PLATEAU_Z,
                  "dais_seat_radius": LD.DAIS_SEAT_R, "plateau_radius": LD.PLATEAU_R})
    if args.get("norender"):
        return
    sc = bpy.context.scene
    R.setup_world(sc)
    R.standard_lights(scale=4.0)
    # simple lava stand-in plane (render only) so the cliffs read against the lava line
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 4, LAVA))
    lv = bpy.context.active_object
    lv.name = "CFCL_Preview_LavaPlane"
    M.assign(lv, "Lava")
    pre = os.path.join(OUT, f"iter{ITER:02d}")
    views = (("front", 0, 14), ("q_left", -40, 24), ("side", 90, 10), ("q_back", 150, 30))
    for o in obs:
        T.hide_all_but([o], obs)
        R.turntable([o], f"{pre}_{o.name}", views=views, lens=40, dist_mult=1.6, res=(800, 600), samples=32,
                    ground=False)
    for o in obs:
        o.hide_render = False
        o.hide_viewport = False
    R.setup_render(sc, "EEVEE", (1280, 720), 32)
    cam = R.camera("CFCL_CentralGroup", (0, -8.5, 6.5), (0, 4.5, -1.3), lens=24)
    R.render_to(f"{pre}_group_elev.png", cam)
    cam = R.camera("CFCL_CentralHero", LD.CAMS["hero"]["loc"], LD.CAMS["hero"]["target"], lens=28)
    R.render_to(f"{pre}_group_hero.png", cam)


main()
