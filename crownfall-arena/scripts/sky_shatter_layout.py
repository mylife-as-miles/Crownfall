"""CFCL_Sky_Shatter - pure-numpy layout (NO bpy): cameras, keep-clear zones, dome fracture, landmass /
debris-stream / cloud specs.  Shared by:
  scripts/sky_shatter.py          (Blender build + test renders, via lib/run_blender.py)
  scripts/sky_shatter_preview.py  (system python + PIL: 2-D composition check of every key camera, no Blender)

World METRES (the main build appends this asset unscaled): board 21.85 m at the origin (top Z=0), player on -Y.
Story: the ECLIPSE is breaking the heavens.  The sky shell is fractured radially from the eclipse direction; near
the eclipse the plates are blown open (hinged inward / detached / gone), revealing a bright ember-gold "beyond".
"""
import math
import os
import sys

import numpy as np

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
if os.path.join(CL, "lib") not in sys.path:
    sys.path.insert(0, os.path.join(CL, "lib"))
import cf_sdf as S  # noqa: E402  (pure numpy)

F32 = np.float32
D2R = math.pi / 180.0

# ------------------------------------------------------------------ cameras (36 mm sensor, 16:9)
CAMS = {
    "hero": ((0.0, -30.0, 9.0), (0.0, 20.0, 5.5), 24.0),
    "worm": ((6.0, -14.0, 1.2), (0.0, 30.0, 14.0), 18.0),
    "god": ((0.0, -26.0, 30.0), (0.0, 2.0, -2.0), 26.0),
    "high34": ((-45.0, -55.0, 40.0), (0.0, 15.0, 0.0), 30.0),
    # establishing shot (ours): low, behind the player side, wide, looking up into the broken sky
    "wide": ((-16.0, -82.0, 6.0), (8.0, 120.0, 66.0), 16.0),
}
KEY_CAMS = ("hero", "worm", "god", "high34")
TEST_CAMS = ("hero", "worm", "wide")

# ------------------------------------------------------------------ scene facts (world metres)
ECL_C = np.array((3.9, 92.0, 30.5))     # v010 eclipse (cf_atmos ECLIPSE_POS (0.85,20,6.2) env x4.6 + dz); was (6.9,92,26.8)
ECL_R = 12.4                            # was 9.2
# conservative keep-clear boxes (hand includes the v007 x1.25 group scale; measured off main v006 renders)
BOXES = {
    "board": ((-16.5, 16.5), (-16.5, 16.5), (-2.0, 0.6)),   # top below the worm camera (z 1.2)
    "skull": ((-19.5, -5.5), (38.0, 50.0), (-1.0, 13.0)),
    "hand": ((16.0, 31.5), (39.0, 53.0), (-1.0, 34.5)),   # hand shifted ~4 m +X (user note, 2026-10-24)
}


def cam_basis(name):
    loc, tgt, lens = CAMS[name]
    loc = np.array(loc, float)
    f = np.array(tgt, float) - loc
    f /= np.linalg.norm(f)
    r = np.cross(f, (0.0, 0.0, 1.0))
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return loc, f, r, u, lens


def project(name, P):
    """-> U, V (0..1, V down), depth.  Same maths as build_main_scene._proj."""
    loc, f, r, u, lens = cam_basis(name)
    v = np.atleast_2d(np.asarray(P, float)) - loc
    z = v @ f
    zz = np.where(z > 0.1, z, np.nan)
    U = 0.5 + 0.5 * (v @ r) / zz * lens / 18.0
    V = 0.5 - 0.5 * (v @ u) / zz * lens / 10.125
    return U, V, z


def zones(name, ecl_k=2.0, margin=0.012):
    rects = []
    for key, (xs, ys, zs) in BOXES.items():
        pts = np.array([(x, y, z) for x in xs for y in ys for z in zs])
        U, V, z = project(name, pts)
        ok = np.isfinite(U)
        if not ok.any():
            continue
        u0, u1, v0, v1 = np.nanmin(U), np.nanmax(U), np.nanmin(V), np.nanmax(V)
        if not ok.all():          # box partly behind the camera (worm stands on the board) -> extend to frame bottom
            v1 = max(v1, 1.0)
            u0, u1 = min(u0, 0.0), max(u1, 1.0)
        rects.append((key, u0 - margin, v0 - margin, u1 + margin, v1 + margin))
    U, V, z = project(name, ECL_C[None])
    lens = CAMS[name][2]
    ell = None
    if np.isfinite(U[0]):
        ell = (U[0], V[0], 0.5 * ECL_R / z[0] * lens / 18.0 * ecl_k, 0.5 * ECL_R / z[0] * lens / 10.125 * ecl_k)
    return rects, ell


def bad_points(name, P, size=None, ecl_k=2.0, margin=0.012, keys=("board", "skull", "hand")):
    """Boolean mask: projected point (+ its projected radius) falls in a keep-clear zone of camera `name`."""
    P = np.atleast_2d(P)
    U, V, z = project(name, P)
    lens = CAMS[name][2]
    pad = np.zeros(len(P)) if size is None else 0.5 * np.asarray(size) / np.maximum(z, 0.1) * lens / 18.0
    rects, ell = zones(name, ecl_k, margin)
    bad = np.zeros(len(P), bool)
    for key, a, b, c, d in rects:
        if key in keys:
            bad |= (U + pad >= a) & (U - pad <= c) & (V + pad >= b) & (V - pad <= d)
    if ell is not None:
        eu, ev, ru, rv = ell
        bad |= ((U - eu) / (ru + pad)) ** 2 + ((V - ev) / (rv + pad)) ** 2 < 1.0
    on = (U + pad >= 0) & (U - pad <= 1) & (V + pad >= 0) & (V - pad <= 1)
    return bad & np.isfinite(U) & on


def violates(name, P, ecl_k=2.0, margin=0.012, keys=("board", "skull", "hand")):
    """Projected bbox of a compact object (points P) overlaps a keep-clear zone (only if on screen)."""
    U, V, z = project(name, P)
    ok = np.isfinite(U)
    if not ok.any():
        return False
    u0, u1, v0, v1 = np.nanmin(U), np.nanmax(U), np.nanmin(V), np.nanmax(V)
    if u1 < 0 or u0 > 1 or v1 < 0 or v0 > 1:
        return False
    rects, ell = zones(name, ecl_k, margin)
    for key, a, b, c, d in rects:
        if key in keys and not (u1 < a or u0 > c or v1 < b or v0 > d):
            return True
    if ell is not None:
        eu, ev, ru, rv = ell
        cu, cv = np.clip(eu, u0, u1), np.clip(ev, v0, v1)
        if ((cu - eu) / ru) ** 2 + ((cv - ev) / rv) ** 2 < 1.0:
            return True
    return False


HERO_HAND_SCREEN = (1250 / 1920, 130 / 1080, 1480 / 1920, 520 / 1080)   # critic hero_v009: hand silhouette (u0,v0,u1,v1)


def peel_violates(P, margin=0.015):
    """per-point hero test (arc-shaped plates: a bbox test hits the disc even when the plate does not)."""
    if bad_points("hero", P, None, ecl_k=1.1, margin=margin, keys=("board", "skull")).any():
        return True
    U, V, _ = project("hero", P)
    ok = np.isfinite(U)
    u0, v0, u1, v1 = HERO_HAND_SCREEN
    return bool(np.any(ok & (U > u0 - margin) & (U < u1 + margin) & (V > v0 - margin) & (V < v1 + margin)))


def violates_any(P, ecl_k=2.0, margin=0.012, cams=KEY_CAMS):
    return [c for c in cams if violates(c, P, ecl_k, margin)]


# ------------------------------------------------------------------ rotations
def rotmat(axis, ang):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    x, y, z = a
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def align(a, b):
    """rotation matrix taking unit vector a onto unit vector b."""
    a = np.asarray(a, float) / np.linalg.norm(a)
    b = np.asarray(b, float) / np.linalg.norm(b)
    v = np.cross(a, b)
    s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3)
    return rotmat(v, math.atan2(s, float(a @ b)))


def euler_xyz(m):
    """3x3 -> Blender XYZ euler (radians)."""
    sy = -m[2, 0]
    ry = math.asin(max(-1.0, min(1.0, sy)))
    if abs(sy) < 0.9999:
        rx = math.atan2(m[2, 1], m[2, 2])
        rz = math.atan2(m[1, 0], m[0, 0])
    else:
        rx = math.atan2(-m[1, 2], m[1, 1])
        rz = 0.0
    return rx, ry, rz


# ================================================================== 1. DOME
DOME_R = 520.0
DOME_T = 7.0
BEYOND_R = 615.0
# epicentre: the dome point behind the eclipse as seen from between the hero and worm cameras
_MC = np.array((3.0, -22.0, 5.0))
_d = ECL_C - _MC
_d /= np.linalg.norm(_d)
_b = _MC @ _d
_t = -_b + math.sqrt(_b * _b - (_MC @ _MC - DOME_R ** 2))
EPI_POINT = _MC + _t * _d
EPI = EPI_POINT / np.linalg.norm(EPI_POINT)
_Z = np.array((0.0, 0.0, 1.0))
E_UP = _Z - (_Z @ EPI) * EPI
E_UP /= np.linalg.norm(E_UP)
E_RT = np.cross(EPI, E_UP)
E_RT /= np.linalg.norm(E_RT)

PEEL_TARGETS = []   # v010: replaced by 3-4 thick tilted petals at the corona + 2 falling plates (critic R5)
PEEL_SPOTS = []                                   # filled by build_dome: hot spots in the beyond behind the peels
FALL_TARGETS = [(0.385, 0.10, 32.0), (0.615, 0.01, 28.0)]   # hero (u, v, rotation deg) of the two FALLING plates
FALL_TRAILS = []                                  # filled by build_dome: debris trailing each falling plate
RING_EDGES_DEG = [0.0, 7.0, 13.0, 20.0, 28.0, 37.0, 48.0, 61.0, 76.0, 92.0, 108.0]
N_SECT = 10
EL_MIN_DEG = -2.5
GRID_S = np.array([0.0, 0.03, 0.08, 0.17, 0.33, 0.5, 0.67, 0.83, 0.92, 0.97, 1.0])


def sky_dir(rho, th):
    rho = np.asarray(rho, float)
    th = np.asarray(th, float)
    return (np.cos(rho)[..., None] * EPI
            + np.sin(rho)[..., None] * (np.cos(th)[..., None] * E_UP + np.sin(th)[..., None] * E_RT))


def rho_theta(d):
    d = np.asarray(d, float)
    return np.arccos(np.clip(d @ EPI, -1, 1)), np.arctan2(d @ E_RT, d @ E_UP)


HOLE_TARGETS = [  # hero (u, v, radius deg, beyond boost): critic hero_v013 R5
    (0.695, 0.15, 6.5, 4.2),   # hot tear behind the hand's fingertips (hand ~x1250-1480, y130-520 @1920x1080)
    (0.17, 0.08, 9.0, 3.0),    # bright tear behind landmass L (x120-520, y20-150)
]


def hero_ray_dome(u, v, radius=None):
    loc, f, r, up, lens = cam_basis("hero")
    d = f + (u - 0.5) * 2 * 18 / lens * r + (0.5 - v) * 2 * 10.125 / lens * up
    d /= np.linalg.norm(d)
    radius = radius or DOME_R
    b = loc @ d
    t = -b + math.sqrt(b * b - (loc @ loc - radius ** 2))
    p = loc + t * d
    return p / np.linalg.norm(p)


def forced_holes(with_boost=False, hero_only=False):
    """(unit dir, angular radius rad[, boost]) of the tears: stream ends + hero-composed hot tears."""
    out = []
    if not hero_only:
        for st in STREAMS:
            if st.get("hole"):
                e = np.array(st["pts"][-1], float)
                out.append((e / np.linalg.norm(e), st["hole"] * D2R, 2.6, "stream"))
    for (u, v, rd, boost) in HOLE_TARGETS:
        out.append((hero_ray_dome(u, v), rd * D2R, boost, "hero"))
    return [(h[0], h[1], h[2]) if with_boost else (h[0], h[1]) for h in out] if not hero_only else out


def gap_r(rho):
    """radial-crack width (radians) as a function of angular distance from the epicentre (radians)."""
    rd = np.asarray(rho) / D2R
    return (0.05 + 0.75 * np.exp(-(rd - 7.0) / 6.5)) * D2R


def gap_c(rho):
    return 0.8 * gap_r(rho)


class Zig:
    """piecewise-linear zig-zag offset (crack-like) over x."""

    def __init__(self, rng, x0, x1, step, amp_fn):
        xs = [x0 - step[1]]
        while xs[-1] < x1 + step[1]:
            xs.append(xs[-1] + rng.uniform(*step))
        self.xs = np.array(xs)
        self.ys = rng.uniform(-1, 1, len(xs)) * np.array([amp_fn(x) for x in xs])

    def __call__(self, x):
        return np.interp(x, self.xs, self.ys)


def _radial_line(rng, th0):
    zig = Zig(rng, 0.0, 115 * D2R, (1.8 * D2R, 5.5 * D2R), lambda r: (0.45 + 0.045 * r / D2R) * D2R)
    return lambda rho: th0 + zig(rho) / np.maximum(np.sin(rho), math.sin(3 * D2R))


def _ring_line(rng, r0, dr):
    zig = Zig(rng, -0.2, 2 * math.pi + 0.8, (0.04, 0.12), lambda t: 0.11 * dr)
    return lambda th: r0 + zig(th)


def build_dome(seed=33):
    """Returns dict(plates=[...], shards=[...], epi=..., stats=...).
    plate: ring, rho_c, theta_c, heat, state(inplace|hinged|detached), angle, xform (Rm, c_from, c_to),
           dirs (n,n,3) original unit directions, edge (n,n) metres to plate border."""
    rng = np.random.default_rng(seed)
    rng2 = np.random.default_rng(seed + 1000)      # v010 extras (keeps the v009 crack pattern)
    R = DOME_R

    def fade(f, lo=24.0, hi=75.0, p_full=0.25):
        f.rf = 1e9 if rng2.random() < p_full else rng2.uniform(lo, hi) * D2R
        return f

    # sector boundaries (12 radial cracks, jittered spacing)
    base = np.linspace(0, 2 * math.pi, N_SECT + 1)[:-1] + rng.uniform(0, 2 * math.pi / N_SECT)
    base = base + rng.uniform(-0.36, 0.36, N_SECT) * (2 * math.pi / N_SECT)
    base = np.sort(base)
    radial = [fade(_radial_line(rng, t)) for t in base]
    th_left = list(base)
    th_right = list(base[1:]) + [base[0] + 2 * math.pi]
    _wrap = (lambda f: (lambda r: f(r) + 2 * math.pi))(radial[0])
    _wrap.rf = radial[0].rf
    rad_right = radial[1:] + [_wrap]
    rings = RING_EDGES_DEG
    # concentric boundaries per (ring edge j, sector k): staggered radii -> T-junctions (voronoi-like)
    ring_fn = {}
    for j in range(1, len(rings)):
        dr = (rings[min(j + 1, len(rings) - 1)] - rings[j - 1]) * 0.5 * D2R
        for k in range(N_SECT):
            room = min(rings[j] - rings[j - 1], rings[min(j + 1, len(rings) - 1)] - rings[j]) if j < len(rings) - 1                 else rings[j] - rings[j - 1]
            jit = 0.0 if j == 1 else rng.uniform(-0.38, 0.38) * room
            r0 = (rings[j] + jit) * D2R
            ring_fn[(j, k)] = _ring_line(rng, r0, dr) if j > 1 else (lambda th, r0=r0: r0 + 0 * th)
            ring_fn[(j, k)].sealed = bool(rings[j] > 26 and rng2.random() < 0.45)
    plates = []
    pid = 0
    for k in range(N_SECT):
        used = [1, 2, 3, 4]
        for j in range(5, len(rings) - 1):
            if used[-1] == j - 1 and rng.random() < 0.38:
                continue
            used.append(j)
        used.append(len(rings) - 1)
        for jj in range(len(used) - 1):
            j, j2 = used[jj], used[jj + 1]
            r_lo, r_hi = rings[j] * D2R, rings[j2] * D2R
            rmid = 0.5 * (r_lo + r_hi)
            thL0, thR0 = radial[k](rmid), rad_right[k](rmid)
            arc = (thR0 - thL0) * math.sin(rmid)
            m = max(1, int(round(arc / ((r_hi - r_lo) * 1.15))))
            lines = [radial[k]]
            for i in range(1, m):
                f0 = (i + rng.uniform(-0.2, 0.2)) / m
                t0 = thL0 + (thR0 - thL0) * f0
                lines.append(fade(_radial_line(rng, t0), 18.0, 45.0, 0.0))
            lines.append(rad_right[k])
            bot, top = ring_fn[(j, k)], ring_fn[(j2, k)]
            for i in range(m):
                L, Rr = lines[i], lines[i + 1]
                uu, vv = np.meshgrid(GRID_S, GRID_S, indexing="ij")
                tl0, tr0 = L(rmid), Rr(rmid)
                th0 = tl0 + (tr0 - tl0) * uu
                sb, st_ = getattr(bot, "sealed", False), getattr(top, "sealed", False)
                rb = bot(th0) + (0.0 if sb else gap_c(bot(th0)) * (0.5 if j > 1 else 0.0))
                rt = top(th0) - (0.0 if st_ else gap_c(top(th0)) * 0.5)
                rho = rb + (rt - rb) * vv
                fL = np.clip((L.rf - rho) / (5 * D2R), 0, 1)
                fR = np.clip((Rr.rf - rho) / (5 * D2R), 0, 1)
                g = gap_r(rho) * 0.5 / np.maximum(np.sin(rho), math.sin(3 * D2R))
                tl, tr = L(rho) + g * fL, Rr(rho) - g * fR
                th = tl + (tr - tl) * uu
                if np.any(tr <= tl) or np.any(rt <= rb):
                    continue
                dirs = sky_dir(rho, th)
                sn = np.sin(rho) * R
                edge = np.minimum(np.minimum(np.where(sb, 1e6, (rho - rb) * R), np.where(st_, 1e6, (rt - rho) * R)),
                                  np.minimum((th - tl) * sn / np.maximum(fL, 1e-3), (tr - th) * sn / np.maximum(fR, 1e-3)))
                el = np.arcsin(np.clip(dirs[..., 2], -1, 1)) / D2R
                if el.max() < EL_MIN_DEG:
                    continue
                rc = float(rho.mean())
                plates.append(dict(id=pid, ring=j, sector=k, sub=i, rho_c=rc, theta_c=float(th.mean()),
                                   heat=float(math.exp(-(rc / D2R - 6.0) / 13.0)), dirs=dirs, edge=edge,
                                   el_min=float(el.min()), state="inplace", angle=0.0,
                                   xform=(np.eye(3), np.zeros(3), np.zeros(3))))
                pid += 1
    stats = {"cells": len(plates)}
    # ---------------------------------------------------------------- break-up rules
    keep = []
    for p in plates:
        j, rd = p["ring"], p["rho_c"] / D2R
        x = rng.random()
        if rd > 86 and x < 0.33:          # the shell frays at its edge
            continue
        if j == 1:
            if x < 0.30:
                continue                    # blown out (the beyond shows here)
            p["state"] = "hinged"                  # torn trapdoor petals (detached plates read as paper kites)
            p["angle"] = rng.uniform(38, 68) * D2R
        elif j == 2:
            if x < 0.08:
                continue
            p["state"] = "hinged"
            p["angle"] = rng.uniform(14, 36) * D2R
        elif j == 3:
            p["state"] = "hinged"
            p["angle"] = rng.uniform(4, 11) * D2R
        elif j == 4:
            if x < 0.6:
                p["state"] = "hinged"
                p["angle"] = rng.uniform(1.5, 5) * D2R
        elif x < 0.07:                      # rare peeling plates across the whole sky
            p["state"] = "peel"
            p["angle"] = rng.uniform(8, 22) * D2R
        keep.append(p)
    plates = keep
    # secondary tears: the debris streams pour into holes torn where they meet the shell
    holes = [(h[0], h[1], h[3]) for h in forced_holes(hero_only=True)] + \
        [(e / np.linalg.norm(e), st["hole"] * D2R, "stream") for st in STREAMS if st.get("hole")
         for e in [np.array(st["pts"][-1], float)]]
    keep = []
    for p in plates:
        dc = p["dirs"].reshape(-1, 3).mean(0)
        dc /= np.linalg.norm(dc)
        gone = False
        for hd, hr, kind in holes:
            ang = math.acos(max(-1.0, min(1.0, float(dc @ hd))))
            if ang < hr:
                gone = True
            elif ang < 1.7 * hr and p["state"] in ("inplace",) and kind == "stream":
                p["state"] = "peel"
                p["angle"] = rng.uniform(10, 24) * D2R
        if not gone:
            keep.append(p)
    stats["forced_hole_removed"] = len(plates) - len(keep)
    plates = keep
    # 2-3 large PEELING plates where the hero sees them (critic: "peeling sky plates with ember light bleeding through")
    PEEL_SPOTS.clear()
    cents = []
    for p in plates:
        U, V, _ = project("hero", p["dirs"].reshape(-1, 3).mean(0)[None] * R)
        cents.append((float(U[0]), float(V[0])))
    for (tu, tv, ang) in PEEL_TARGETS:
        best = min((i for i, p in enumerate(plates) if p["ring"] >= 2 and p["state"] != "curl"),
                   key=lambda i: (cents[i][0] - tu) ** 2 + (cents[i][1] - tv) ** 2, default=None)
        if best is None:
            continue
        p = plates[best]
        p["state"], p["angle"], p["curl"] = "curl", ang * D2R, True
    # ---------------------------------------------------------------- transforms + keep-clear
    n_fix = {"hinge_reduced": 0, "to_inplace": 0, "detach_moved": 0, "detach_dropped": 0}
    # curated FALLING plates (hero screen targets): detached, closer, rotated 25-38 deg, debris trails up to the slot
    FALL_TRAILS.clear()
    for (tu, tv, rot_deg) in FALL_TARGETS:
        cands = [p for p in plates if p["ring"] >= 2 and p["state"] in ("inplace", "hinged") and not p.get("curl")]
        if not cands:
            continue

        def dist_(p):
            U, V, _ = project("hero", p["dirs"].reshape(-1, 3).mean(0)[None] * R)
            return (U[0] - tu) ** 2 + (V[0] - (tv - 0.07)) ** 2

        p = min(cands, key=dist_)
        P = p["dirs"].reshape(-1, 3) * R
        c = P.mean(0)
        ok = False
        for attempt in range(6):
            loc_, f_, r_, u_, lens_ = cam_basis("hero")
            dd = f_ + (tu - 0.5) * 2 * 18 / lens_ * r_ + (0.5 - tv) * 2 * 10.125 / lens_ * u_
            dd /= np.linalg.norm(dd)
            c_to = loc_ + dd * (430.0 - 20 * attempt)
            ax = np.cross(dd, (0, 0, 1.0)) * rng2.uniform(0.6, 1.0) + rng2.normal(0, 0.35, 3)
            Rm = rotmat(ax, rot_deg * D2R) @ align(c / np.linalg.norm(c), c_to / np.linalg.norm(c_to))
            Q = (P - c) @ Rm.T + c_to
            if not peel_violates(Q[::3]):
                ok = True
                break
            rot_deg *= 0.85
        if not ok:
            continue
        p["state"], p["angle"], p["xform"] = "fall", rot_deg * D2R, (Rm, c, c_to)
        slot = c * 0.985
        FALL_TRAILS.append(dict(key=f"Fall{len(FALL_TRAILS)}", pts=[tuple(c_to + (0, 0, 4.0)),
                                                                      tuple(c_to + (slot - c_to) * 0.35),
                                                                      tuple(c_to + (slot - c_to) * 0.75)],
                                n=110, w=(7.0, 18.0), s0=(0.8, 2.4), s1=(0.3, 1.0), strands=2, twist=0.3,
                                seed=700 + len(FALL_TRAILS), rock_only=True, hero_relaxed=True))
    out = []
    for p in plates:
        P = p["dirs"] * R
        if p["state"] == "fall":
            out.append(p)
            continue
        if p["state"] in ("hinged", "peel", "curl"):
            # hinge on the edge farthest from the epicentre (peel: random edge); swing the opposite edge INWARD
            if p["state"] in ("hinged", "curl"):
                e_a, e_b, far = P[0, -1], P[-1, -1], P[:, 0].mean(0)
            else:
                ch = rng.integers(4)
                e_a, e_b, far = [(P[0, 0], P[-1, 0], P[:, -1].mean(0)), (P[0, -1], P[-1, -1], P[:, 0].mean(0)),
                                 (P[0, 0], P[0, -1], P[-1].mean(0)), (P[-1, 0], P[-1, -1], P[0].mean(0))][ch]
            piv = 0.5 * (e_a + e_b)
            ax = e_b - e_a
            ang = p["angle"]
            for attempt in range(4):
                Rm = rotmat(ax, ang)
                if np.linalg.norm(piv + Rm @ (far - piv)) > np.linalg.norm(far):
                    Rm = rotmat(ax, -ang)
                drop = np.array((0, 0, -1.0)) * (p["heat"] * rng.uniform(0, 14)) if p["state"] == "hinged" else 0
                c_to = piv + drop
                Q = (P.reshape(-1, 3) - piv) @ Rm.T + c_to
                if p["state"] == "curl":
                    sgn = 1.0 if np.linalg.norm(piv + rotmat(ax, ang) @ (far - piv)) < np.linalg.norm(far) else -1.0
                    p["curl_axis"], p["curl_piv"], p["curl_sign"] = ax, piv, sgn
                    p["angle"] = ang
                    Q = plate_world(p, R).reshape(-1, 3)
                if p["state"] == "curl" or (p["state"] == "hinged" and p["ring"] <= 2):
                    # curated peels + near-corona petals: backdrop at ~500 m -> disc x1.1 + the real hand rect
                    if not peel_violates(Q[::3]):
                        break
                elif ang < 10 * D2R or not violates_any(Q[::7], ecl_k=1.35):
                    break
                ang *= 0.5
                n_fix["hinge_reduced"] += 1
            else:
                Rm, c_to, ang = np.eye(3), piv, 0.0
                p["state"] = "inplace"
                n_fix["to_inplace"] += 1
            p["angle"] = ang
            p["xform"] = (Rm, piv, c_to)
            if p["state"] == "curl":
                p["xform"] = (np.eye(3), np.zeros(3), np.zeros(3))
                uc = p["dirs"].reshape(-1, 3).mean(0)
                PEEL_SPOTS.append((uc / np.linalg.norm(uc), 7.0 * D2R))
        elif p["state"] == "detached":
            c = P.reshape(-1, 3).mean(0)
            dc = c / np.linalg.norm(c)
            ok = False
            for attempt in range(12):
                rr, tt = rho_theta(dc)
                d_rho = rng.uniform(4, 13) * D2R * (1 + 0.25 * attempt)
                dnew = sky_dir(rr + d_rho, tt + rng.uniform(-0.25, 0.25) * (1 + 0.6 * attempt))
                dnew = dnew + np.array((0, 0, -rng.uniform(0.02, 0.09)))
                dnew /= np.linalg.norm(dnew)
                r_new = rng.uniform(220, 440)
                c_to = dnew * r_new
                Rm = rotmat(rng.normal(size=3), rng.uniform(25, 95) * D2R) @ align(dc, dnew)
                Q = (P.reshape(-1, 3) - c) @ Rm.T + c_to
                if not violates_any(Q[::5], ecl_k=2.0):
                    ok = True
                    break
                n_fix["detach_moved"] += 1
            if not ok:
                n_fix["detach_dropped"] += 1
                continue
            p["xform"] = (Rm, c, c_to)
        out.append(p)
    stats.update({k: v for k, v in n_fix.items()})
    for s_ in ("inplace", "hinged", "peel", "curl", "fall", "detached"):
        stats[s_] = sum(1 for p in out if p["state"] == s_)
    # ---------------------------------------------------------------- shard field (pieces of the blown-out plates)
    shards = []
    tries = 0
    lm_boxes = []                      # keep the shard field off the landmass silhouettes in the hero
    for lm in LANDMASSES:
        uu, vv, _ = project("hero", lm_hull(lm))
        lm_boxes.append((np.nanmin(uu) - 0.02, np.nanmax(uu) + 0.02, np.nanmin(vv) - 0.02, np.nanmax(vv) + 0.02))
    while len(shards) < 100 and tries < 8000:
        tries += 1
        rd = 6.0 + rng.exponential(12.0)
        if rd > 46:
            continue
        th = rng.uniform(0, 2 * math.pi)
        d = sky_dir(rd * D2R, th)
        r = rng.uniform(210, 500)
        pos = d * r + np.array((0, 0, -rng.uniform(0, 1) ** 2 * 45))
        size = rng.uniform(4.0, 14) * (r / 400) ** 0.5
        if np.arcsin(pos[2] / np.linalg.norm(pos)) < 1.5 * D2R:
            continue
        if any(bad_points(cn, pos[None], [size * 1.4], ecl_k=2.0)[0] for cn in KEY_CAMS):
            continue
        hu, hv, _ = project("hero", pos[None])
        if any(u0 < hu[0] < u1 and v0 < hv[0] < v1 for (u0, u1, v0, v1) in lm_boxes):
            continue
        shards.append(dict(pos=pos, size=size, rot=rng.uniform(0, 2 * math.pi, 3), heat=math.exp(-(rd - 6) / 14),
                           nv=int(rng.integers(3, 6)), seed=int(rng.integers(1 << 30))))
    stats["shards"] = len(shards)
    return dict(plates=out, shards=shards, stats=stats)


def plate_world(p, radius):
    """plate grid (n,n,3) at a given shell radius, in world space after its transform.  'curl' plates bend
    progressively away from their hinge (v=1 edge) like peeling paint: row angle = angle * (1-v)^1.6."""
    P = p["dirs"] * radius
    if p.get("curl") and "curl_axis" in p:
        out = np.empty_like(P)
        for j, sv in enumerate(GRID_S):
            Rj = rotmat(p["curl_axis"], p["curl_sign"] * p["angle"] * (1.0 - sv) ** 1.6)
            out[:, j] = (P[:, j] - p["curl_piv"]) @ Rj.T + p["curl_piv"]
        return out
    Rm, c_from, c_to = p["xform"]
    return ((P.reshape(-1, 3) - c_from) @ Rm.T + c_to).reshape(P.shape)


# ---------------------------------------------------------------- sky painting (vertex colours, linear)
def sky_paint(dirs, edge, heat, seed=5):
    """dirs (N,3) original directions; edge (N,) metres to the plate border; heat (N,) -> RGB (N,3) emission."""
    d = np.asarray(dirs, F32)
    el = np.arcsin(np.clip(d[:, 2], -1, 1)) / D2R
    rho = np.arccos(np.clip(d @ EPI.astype(F32), -1, 1)) / D2R
    # vertical gradient: hazy storm horizon -> dark cold zenith (cool, dark: the fog veil lifts it in-scene)
    ks = np.array([-5, 2, 10, 22, 40, 65, 95], float)
    cols = np.array([(0.13, 0.14, 0.16), (0.115, 0.125, 0.15), (0.078, 0.088, 0.115), (0.05, 0.06, 0.08),
                     (0.032, 0.04, 0.056), (0.022, 0.028, 0.04), (0.018, 0.022, 0.034)])
    base = np.stack([np.interp(el, ks, cols[:, i]) for i in range(3)], 1)
    # big billowing storm masses painted on the shell: dark cores, cold lit rims, paler gaps between masses
    P = (d * 2.3).astype(F32)
    Pw = S.warp(P, 0.6, 1.0, seed=seed, octaves=3)
    c = S.fbm(Pw, 1.0, 5, seed=seed + 7)
    c2 = S.fbm((d * 9.0).astype(F32), 1.0, 3, seed=seed + 19)
    c = c + 0.18 * c2
    mass = np.clip((c + 0.02) / 0.32, 0, 1)
    rim = np.clip(1 - np.abs(c + 0.06) / 0.07, 0, 1)
    gap = np.clip((-c - 0.18) / 0.2, 0, 1)
    dark = np.array((0.012, 0.015, 0.022))
    lite = np.array((0.30, 0.33, 0.40))
    col = base * (1 - 0.78 * mass[:, None]) + dark * 0.78 * mass[:, None]
    col = col * (1 + 0.9 * gap[:, None])
    col += lite * (rim * (0.25 + 0.75 * np.clip((el + 2) / 30, 0, 1)))[:, None] * 0.38
    # warm wash from the tear (cloud undersides catching the beyond light)
    w = 0.55 * np.exp(-rho / 10.0) + 0.12 * np.exp(-rho / 28.0)
    warm = np.array((0.95, 0.50, 0.17))
    col += warm * (w * (0.3 + 0.7 * (1 - mass) + 0.6 * rim))[:, None] * 0.5
    # light bleeding along the cracks (strong near the eclipse, fading out across the sky)
    hh = np.asarray(heat, float)
    e = np.asarray(edge, float)
    glow = np.exp(-e / 2.6) * (0.01 + 1.0 * hh)
    col += np.array((1.0, 0.56, 0.19)) * glow[:, None]
    return np.clip(col, 0, 4).astype(F32)


def beyond_grid():
    """(rho_deg, theta) grid for the emissive 'beyond' shell + emission colour/strength per vertex."""
    rds = np.array([0, 0.6, 1.2, 2, 3, 4, 5, 6.5, 8, 10, 12, 14.5, 17, 20, 24, 28, 33, 38, 44, 50, 57, 64, 72, 80,
                    88, 96, 104, 112], float)
    ths = np.linspace(0, 2 * math.pi, 97)
    RR, TT = np.meshgrid(rds * D2R, ths, indexing="ij")
    dirs = sky_dir(RR, TT)
    r = rds[:, None] * np.ones_like(TT)
    strength = 0.07 + 3.0 * np.exp(-r / 5.0) + 2.6 * np.exp(-r / 10.5)     # ~2.0 at the corona -> ~0.2 in the corners
    for hd, hr, boost in forced_holes(with_boost=True):
        ang = np.arccos(np.clip(dirs @ hd, -1, 1))
        strength = strength + boost * np.exp(-(ang / (0.8 * hr)) ** 2)
    for hd, hr in PEEL_SPOTS:          # ember light bleeding through behind the peeling plates
        ang = np.arccos(np.clip(dirs @ hd, -1, 1))
        strength = strength + 2.2 * np.exp(-(ang / hr) ** 2)
    t = np.clip(r / 40.0, 0, 1)[..., None]
    c_hot = np.array((1.0, 0.86, 0.64))
    c_mid = np.array((1.0, 0.60, 0.24))
    c_far = np.array((0.82, 0.34, 0.10))
    col = np.where(t < 0.3, c_hot + (c_mid - c_hot) * (t / 0.3), c_mid + (c_far - c_mid) * ((t - 0.3) / 0.7))
    return rds, ths, dirs, col, strength


# ================================================================== 2. LANDMASSES
def _hero_point(u, v, d):
    loc, f, r, up, lens = cam_basis("hero")
    return tuple(float(x) for x in loc + d * f + (u - 0.5) * 2 * d * 18 / lens * r + (0.5 - v) * 2 * d * 10.125 / lens * up)


LLOC = _hero_point(0.17, 0.135, 330.0)    # v011: top surface at hero v~0.13 so the megastructure on it is in frame
LANDMASSES = [
    # HERO (0,-30,9)->(0,20,5.5) 24 mm, critic hero_v009 sec.4: "two torn inverted landmasses with ruins on top at
    # different depths: a large SHARP one upper-left (~x150-600, y40-200 of 1920x1080) and a HAZIER one upper-right".
    # L ~260 m from camera (light aerial haze), R ~380 m (strong haze: haze="far").  Tips stay > 35 m above ground.
    dict(key="L", loc=LLOC, rot=(6.0, 6.0, 22.0), R=36.0, el=(1.3, 0.85), D=44.0, nb=7,
         seed=1101, ruins="arch_wall", trail=(-0.95, 0.15), roots=11, chunks=10, target=34000),
    dict(key="R", loc=(237.0, 359.0, 123.0), rot=(6.0, -8.0, -30.0), R=26.0, el=(1.3, 0.85), D=36.0, nb=6,
         seed=1213, ruins="towers_bridge", trail=(0.95, 0.1), roots=8, chunks=6, target=16000, haze="far"),
]


def lm_matrix(lm):
    return S.rot_matrix(*lm["rot"]).astype(float)


def lm_hull(lm):
    """rough world-space hull points (top ellipse + inverted cone + tip) for keep-clear tests / preview."""
    R0, D0 = lm["R"], lm["D"]
    ex, ey = lm["el"]
    a = np.linspace(0, 2 * math.pi, 24, endpoint=False)
    pts = [np.stack([np.cos(a) * R0 * ex, np.sin(a) * R0 * ey, np.full_like(a, 6.0)], 1),
           np.stack([np.cos(a) * R0 * ex * 0.85, np.sin(a) * R0 * ey * 0.85, np.full_like(a, -0.25 * D0)], 1),
           np.stack([np.cos(a) * R0 * ex * 0.5, np.sin(a) * R0 * ey * 0.5, np.full_like(a, -0.6 * D0)], 1),
           np.array([[0, 0, -D0]])]
    P = np.concatenate(pts, 0)
    return P @ lm_matrix(lm).T + np.array(lm["loc"])


def make_landmass_sdf(lm):
    """Inverted, strata-banded, cleaved cliff mass (adapted from terrain_islands, metres). Top plateau at z=0."""
    R0, D0 = lm["R"], lm["D"]
    ex, ey = lm["el"]
    nb = lm["nb"]
    seed = lm["seed"]
    rng = np.random.default_rng(seed)
    tipw, pw, dome = 0.12, 0.85, 0.05

    def band_params(nbands):
        n = nbands + 3
        bs = rng.uniform(0.84, 1.04, n)
        bs[rng.random(n) < 0.3] *= rng.uniform(0.76, 0.86)
        bs[0] = 1.0
        bo = rng.normal(0, 0.06, (n, 2))
        bo[0] = 0
        pa = rng.uniform(0, 2 * np.pi, (n, 6))
        po = rng.uniform(0.58, 0.95, (n, 6))
        po[0] = rng.uniform(0.82, 0.97, 6)
        th = rng.choice([0.55, 0.8, 1.0, 1.3, 1.7], n)
        cum = np.cumsum(th) / th[:nbands].sum()
        la = rng.uniform(0, 2 * np.pi)
        lean = np.array([math.cos(la), math.sin(la)]) * rng.uniform(0.3, 0.55)
        return bs, bo, pa, po, cum, lean

    parts = [dict(cx=0.0, cy=0.0, R=R0, D=D0, nb=nb, ex=ex, ey=ey, bp=band_params(nb), tilt=rng.normal(0, 0.15, 2),
                  top=True)]
    for _ in range(2):
        a = rng.uniform(0, 2 * np.pi)
        parts.append(dict(cx=0.5 * R0 * math.cos(a), cy=0.45 * R0 * math.sin(a), R=rng.uniform(0.45, 0.62) * R0,
                          D=rng.uniform(0.55, 0.8) * D0, nb=max(3, nb - 2), ex=1.0, ey=0.9,
                          bp=band_params(nb), tilt=rng.normal(0, 0.2, 2), top=False))
    notches = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.66, 0.88), rng.uniform(0.12, 0.35) * R0)
               for _ in range(int(rng.integers(3, 6)))]
    fiss = [(rng.uniform(0, np.pi), rng.uniform(-0.4, 0.4) * R0, rng.uniform(0.02, 0.04) * R0,
             rng.uniform(0.2, 0.45) * R0) for _ in range(int(rng.integers(1, 3)))]
    drips = []
    for _ in range(int(rng.integers(3, 6))):
        a = rng.uniform(0, 2 * np.pi)
        u = rng.uniform(0.25, 0.7)
        rr = R0 * (1 - u) ** 0.9 * rng.uniform(0.35, 0.7)
        drips.append((rr * math.cos(a) * ex, rr * math.sin(a) * ey, -u * D0 + 0.05 * D0,
                      rng.uniform(0.12, 0.32) * D0, rng.uniform(0.06, 0.11) * R0))
    # side of the mass that faces the hero camera (local frame) -> fractures, roots and chunks concentrate there
    Mloc = lm_matrix(lm)
    dc = Mloc.T @ (np.array(CAMS["hero"][0]) - np.array(lm["loc"]))
    th_cam = math.atan2(dc[1], dc[0])
    sockets = []
    for _ in range(lm["roots"]):
        a = th_cam + rng.normal(0, 0.9) if rng.random() < 0.75 else rng.uniform(0, 2 * np.pi)
        u = rng.uniform(0.05, 0.28)
        rr = R0 * (1 - u) ** 0.9 * 0.84
        sockets.append((rr * math.cos(a) * ex, rr * math.sin(a) * ey, -u * D0, rng.uniform(0.04, 0.07) * R0))

    cracks = []
    for _ in range(int(rng.integers(5, 9))):
        a = th_cam + rng.normal(0, 0.8)
        u = rng.uniform(0.12, 0.7)
        rr = R0 * (1 - u) ** 0.85 * 0.95
        n = np.array((math.cos(a + math.pi / 2 + rng.normal(0, 0.5)), math.sin(a + math.pi / 2 + rng.normal(0, 0.5)),
                      rng.normal(0, 0.35)))
        n /= np.linalg.norm(n)
        cracks.append(((rr * math.cos(a) * ex, rr * math.sin(a) * ey, -u * D0), n, rng.uniform(0.9, 1.5) * R0 / 48,
                       rng.uniform(0.22, 0.42) * R0))
    # fracture chunks: boxes straddling the surface on the camera side; carved from the body (+ crack gap) and
    # re-meshed separately, then displaced (slumped / tilted / some falling away)
    chunks = []
    for i in range(lm.get("chunks", 0)):
        a = th_cam + rng.normal(0, 0.75)
        u = rng.uniform(0.06, 0.72) if i > 1 else rng.uniform(0.75, 0.92)
        rr = R0 * (1 - u) ** 0.85 * 0.92
        c = np.array((rr * math.cos(a) * ex, rr * math.sin(a) * ey, -u * D0))
        half = np.array((rng.uniform(0.13, 0.26), rng.uniform(0.12, 0.2), rng.uniform(0.1, 0.22))) * R0
        Rb = np.asarray(S.rot_matrix(rng.normal(0, 18), rng.normal(0, 18), math.degrees(a) + 90), float)
        out = np.array((math.cos(a), math.sin(a), 0.0))
        fall = i < 2 or rng.random() < 0.15
        drop = rng.uniform(14, 34) if fall else rng.uniform(1.5, 7.0)
        tvec = out * rng.uniform(1.0, 5.0) * (3 if fall else 1) + np.array((0, 0, -drop)) * R0 / 48
        tilt = np.asarray(S.rot_matrix(*(rng.normal(0, 25 if fall else 7, 3))), float)
        chunks.append(dict(c=c, half=half, Rb=Rb, gap=rng.uniform(0.9, 1.8) * R0 / 48, t=tvec, Rt=tilt, fall=fall))

    def wedge(P, Pw, p):
        x = (Pw[:, 0] - p["cx"]) / p["ex"]
        y = (Pw[:, 1] - p["cy"]) / p["ey"]
        z = Pw[:, 2]
        R_, D_, nb_ = p["R"], p["D"], p["nb"]
        bs, bo, pa, po, cum, lean = p["bp"]
        phi = np.arctan2(y, x)
        ring = np.stack([np.cos(phi) * 1.6, np.sin(phi) * 1.6, np.full_like(phi, seed * 0.37 + R_ * 0.01)],
                        1).astype(F32)
        Rp = R_ * (1.0 + 0.16 * S.perlin(ring, seed) + 0.06 * S.perlin(ring * 2.7, seed + 5))
        u = np.clip(-z / D_, 0.0, 1.25)
        wob = S.fbm((P / F32(R0 / 0.7)).astype(F32), 1.0, 2, seed=seed + 9) * 0.05
        b = np.clip(np.searchsorted(cum, u + wob), 0, len(bs) - 1).astype(np.int32)
        ub = np.clip(np.where(b > 0, cum[np.maximum(b - 1, 0)], 0.0) + 0.02, 0, 1)
        prof = np.maximum(tipw * 0.5, (1.0 - ub) ** pw)
        Rz = Rp * prof * bs[b]
        sh = (ub ** 1.2) * R_
        xo = x - bo[b, 0] * R_ - lean[0] * sh
        yo = y - bo[b, 1] * R_ - lean[1] * sh
        side = (np.sqrt(xo * xo + yo * yo) - Rz) * 0.85
        for i in range(6):
            d_pl = xo * np.cos(pa[b, i]) + yo * np.sin(pa[b, i]) - po[b, i] * Rz
            side = np.maximum(side, d_pl)
        if p["top"]:
            rho = np.sqrt(x * x + y * y)
            ztop = dome * R_ * (1 - np.clip(rho / R_, 0, 1.2) ** 2) + 0.03 * R_ * S.fbm(
                (P / F32(R0 / 2.0)).astype(F32), 1.0, 3, seed=seed + 3)
            top = Pw[:, 2] - ztop
        else:
            top = Pw[:, 2] + 0.16 * D0
        tx, ty = p["tilt"]
        bot = -Pw[:, 2] - D_ * (0.88 + 0.12 * (x * tx + y * ty) / R_)
        return np.maximum(np.maximum(side, top), bot)

    def f(P):
        Pw = S.warp(P, 0.04 * R0, 1.1 / R0, seed=seed, octaves=2)
        d = wedge(P, Pw, parts[0])
        for p in parts[1:]:
            d = S.smin(d, wedge(P, Pw, p), 0.06 * R0)
        for a, off, h in notches:
            proj = P[:, 0] * math.cos(a) / ex + P[:, 1] * math.sin(a) / ey
            rem = np.maximum(off * R0 - proj, -h - P[:, 2])
            d = np.maximum(d, -rem)
        for a, c, w, dep in fiss:
            proj = P[:, 0] * math.cos(a) + P[:, 1] * math.sin(a)
            rem = np.maximum(np.abs(proj - c) - w, -dep - P[:, 2])
            d = np.maximum(d, -rem)
        for (x0, y0, z0, ln, rr) in drips:
            dd = S.round_cone(P, (x0, y0, z0), (x0 * 1.05, y0 * 1.05, z0 - ln), rr, rr * 0.3)
            dd = np.maximum(dd, -(P[:, 2] - (z0 - ln * 0.8)))
            d = S.smin(d, dd, 0.05 * R0)
        for (x0, y0, z0, rr) in sockets:
            d = S.ssub(d, S.sphere(P, (x0, y0, z0), rr), 0.02 * R0)
        for (c, n, w, r) in cracks:                 # deep fissures through the underside
            q = P - np.asarray(c, F32)
            cr = np.maximum(np.abs(q @ np.asarray(n, F32)) - w, np.sqrt(np.einsum("ij,ij->i", q, q)) - r)
            d = np.maximum(d, -cr)
        # vertical erosion flutes on the cliff faces
        fl = S.ridged((P * F32(1.0 / (0.2 * R0)) * np.array((1, 1, 0.16), F32)).astype(F32), 1.0, 3, seed=seed + 41)
        d = d + 0.032 * R0 * fl * np.clip(-P[:, 2] / (0.1 * D0), 0, 1)
        d = d + 0.012 * R0 * S.fbm((P / F32(R0 / 3.5)).astype(F32), 1.0, 3, seed=seed + 21)
        return d

    def f_main(P):
        d = f(P)
        for ch in chunks:
            d = np.maximum(d, -S.box(P, ch["c"], ch["half"] + ch["gap"], R=ch["Rb"].astype(F32)))
        return d

    ext = R0 * 1.25 * max(ex, ey) + 0.5 * R0
    bmin = (-ext, -ext, -D0 * 1.12 - 1.0)
    bmax = (ext, ext, R0 * 0.18)
    ztop = lambda x, y: dome * R0 * (1 - np.clip(np.sqrt((x / ex) ** 2 + (y / ey) ** 2) / R0, 0, 1.2) ** 2)
    return dict(f=f, f_main=f_main, bmin=bmin, bmax=bmax, sockets=sockets, ztop=ztop, chunks=chunks)


# ================================================================== 3. DEBRIS STREAMS (+ landmass trails)
STREAMS = [
    # control points from screen targets (worm: left of the skull, curving over into the tear above the eclipse)
    dict(key="West", pts=[(-143, 145, -6), (-155, 151, 44), (-152, 168, 95), (-128, 199, 146), (-79, 246, 188),
                          (-37, 302, 196), (-12, 345, 196)],
         n=2300, w=(24.0, 7.0), s0=(1.3, 3.8), s1=(0.3, 0.8), strands=3, twist=0.9, seed=11, hole=6.5),
    # hero right edge: torn ground lifting up into the underside of landmass R (still tethered by its debris)
    dict(key="East", pts=[(203.2, 323.8, -6.0), (213.2, 332.8, 16.7), (223.2, 341.8, 39.3), (233.2, 350.8, 62.0), (243.2, 359.8, 84.7)],
         n=1500, w=(26.0, 12.0), s0=(1.4, 4.2), s1=(0.6, 1.8), strands=3, twist=-0.6, seed=23),
]


def catmull(pts, n=400):
    P = np.asarray(pts, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n // (len(P) - 3), endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    C = np.array(out)
    seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    return C, s / s[-1]


def stream_chips(st, protos_rock=(0, 1, 2, 3), protos_mason=(4, 5, 6, 7, 8), protos_shard=(9,)):
    """-> dict(pos (N,3) world, rot (N,3) euler rad, scale (N,), proto (N,) int, t (N,))"""
    rng = np.random.default_rng(st["seed"])
    C, s = catmull(st["pts"], 600)
    n = st["n"]
    # along-curve parameter, denser low down
    t = rng.random(n * 2) ** 1.25
    t = t[rng.random(len(t)) < (1.0 - 0.5 * t)][:n]
    n = len(t)
    idx = np.clip(np.searchsorted(s, t), 1, len(C) - 1)
    a = (t - s[idx - 1]) / np.maximum(s[idx] - s[idx - 1], 1e-9)
    base = C[idx - 1] + (C[idx] - C[idx - 1]) * a[:, None]
    T = C[idx] - C[idx - 1]
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array(CAMS["hero"][0]) - base
    ref /= np.linalg.norm(ref, axis=1, keepdims=True)
    N = np.cross(T, ref)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-6)
    B = np.cross(N, T)
    w0, w1 = st["w"]
    W = w0 + (w1 - w0) * t ** 0.7
    W = W * (1 + 1.4 * np.clip((t - 0.82) / 0.18, 0, 1))        # dissolves / fans out at the top
    k = st["strands"]
    which = rng.integers(0, k, n)
    in_strand = rng.random(n) < 0.76
    ph = 2 * math.pi * which / k
    lat_c = 0.34 * W * np.sin(2 * math.pi * st["twist"] * t + ph)
    ver_c = 0.10 * W * np.cos(2 * math.pi * st["twist"] * t + ph)
    lat = np.where(in_strand, lat_c + rng.normal(0, 1, n) * 0.10 * W, rng.normal(0, 1, n) * 0.48 * W)
    ver = np.where(in_strand, ver_c + rng.normal(0, 1, n) * 0.07 * W, rng.normal(0, 1, n) * 0.30 * W)
    pos = base + N * lat[:, None] + B * ver[:, None] + T * rng.normal(0, 1.5, n)[:, None]
    lo = np.array(st["s0"])[None] + (np.array(st["s1"]) - np.array(st["s0"]))[None] * (t[:, None] ** 0.8)
    scale = (lo[:, 0] + (lo[:, 1] - lo[:, 0]) * rng.random(n)) * np.exp(rng.normal(0, 0.3, n))
    p_mason = np.clip(0.6 - 0.8 * t, 0.08, 0.6) * (0.0 if st.get("rock_only") else 1.0)
    r = rng.random(n)
    proto = np.where(r < p_mason, rng.choice(protos_mason, n),
                     np.where(r < p_mason + 0.12 + 0.2 * t, rng.choice(protos_shard, n), rng.choice(protos_rock, n)))
    rot = rng.uniform(0, 2 * math.pi, (n, 3))
    # torn ground plates at the root of the stream (big, half-buried, peeling up)
    m = 0 if st.get("rock_only") else 22
    tb = rng.uniform(0, 0.05, m)
    a0 = rng.uniform(0, 2 * math.pi, m)
    rr = rng.uniform(4, 20, m)
    bp = np.array(st["pts"][0], float)[None] + np.stack([np.cos(a0) * rr, np.sin(a0) * rr * 0.8,
                                                        rng.uniform(-3, 9, m) + tb * 40], 1)
    pos = np.vstack([pos, bp])
    rot = np.vstack([rot, np.stack([rng.uniform(-1.0, 1.0, m), rng.uniform(-1.0, 1.0, m),
                                    rng.uniform(0, 2 * math.pi, m)], 1)])
    scale = np.concatenate([scale, rng.uniform(3.5, 8.5, m)])
    proto = np.concatenate([proto, rng.choice([5, 7, 7, 6], m)])
    t = np.concatenate([t, tb])
    keep = pos[:, 2] > -4.0
    if st.get("hero_relaxed"):      # falling-plate trails: judged in the hero only (disc x1.2, real hand rect)
        U, V, _ = project("hero", pos)
        u0, v0, u1, v1 = HERO_HAND_SCREEN
        keep &= ~bad_points("hero", pos, scale * 1.3, ecl_k=1.2, keys=("board", "skull"))
        keep &= ~((U > u0 - 0.01) & (U < u1 + 0.01) & (V > v0 - 0.01) & (V < v1 + 0.01))
    else:
        for cn in KEY_CAMS:
            keep &= ~bad_points(cn, pos, scale * 1.3, ecl_k=2.0)
    return dict(pos=pos[keep], rot=rot[keep], scale=scale[keep], proto=proto[keep].astype(np.int32), t=t[keep],
                dropped=int((~keep).sum()))


def trail_spec(lm):
    """debris falling off a torn landmass, trailing down and away from the epicentre."""
    M_ = lm_matrix(lm)
    tip = np.array(lm["loc"]) + M_ @ np.array((0, 0, -0.9 * lm["D"]))
    dx, dy = lm["trail"]
    L = 1.4 * lm["D"] + 50
    h = np.array((dx, dy, 0.0))
    h /= np.linalg.norm(h)
    pts = [tip, tip + h * 0.25 * L + (0, 0, -0.18 * L), tip + h * 0.6 * L + (0, 0, -0.42 * L),
           tip + h * 1.0 * L + (0, 0, -0.62 * L)]
    n = int(70 + 1.6 * lm["D"])
    return dict(key="Trail_" + lm["key"], pts=[tuple(p) for p in pts], n=n, w=(0.55 * lm["R"], 1.3 * lm["R"]),
                s0=(0.025 * lm["R"], 0.075 * lm["R"]), s1=(0.25, 0.8), strands=2, twist=0.4, seed=lm["seed"] + 7,
                rock_only=True)


# ================================================================== 4. CLOUD BANKS
CLOUD_BANKS = [
    # key, centre, half extents (x,y,z), yaw deg, side the tear light comes from (+1 right / -1 left / 0 below)
    # kept within ~400 m of hero/worm (main build: EEVEE volumetric_end = 414 m)
    dict(key="LowWest", c=(-165.0, 255.0, 28.0), half=(110.0, 45.0, 26.0), yaw=-25.0, light=1, seed=1, vol=False),
    dict(key="LowEast", c=(170.0, 255.0, 30.0), half=(110.0, 45.0, 28.0), yaw=22.0, light=-1, seed=2, vol=False),
    dict(key="HighWest", c=(-200.0, 250.0, 190.0), half=(90.0, 50.0, 42.0), yaw=-35.0, light=1, seed=3),
    dict(key="HighEast", c=(165.0, 240.0, 178.0), half=(88.0, 50.0, 42.0), yaw=30.0, light=-1, seed=4),
    dict(key="Horizon", c=(25.0, 330.0, 4.0), half=(170.0, 40.0, 14.0), yaw=0.0, light=0, seed=5, gap=True),
]


def cloud_hull(cb):
    hx, hy, hz = cb["half"]
    a = math.radians(cb["yaw"])
    Rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    pts = np.array([(x, y, z) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]) * 0.8
    return pts @ Rz.T + np.array(cb["c"])


def cloud_cards(cb):
    """2 cards per bank: (centre, width, height, texture key)."""
    hx, hy, hz = cb["half"]
    c = np.array(cb["c"])
    tex = {1: "LitRight", -1: "LitLeft", 0: "Backlit"}[cb["light"]]
    a = math.radians(cb["yaw"])
    if cb.get("gap"):        # two banks either side of a gap under the eclipse
        return [(c + np.array((-0.62 * hx, 0, 0)), 0.95 * hx, 2.4 * hz, "LitRight"),
                (c + np.array((0.70 * hx, 0, 0)), 0.95 * hx, 2.4 * hz, "LitLeft")]
    side = np.array((math.cos(a), math.sin(a), 0.0))
    return [(c + np.array((0, -0.35 * hy, 0)), 2.3 * hx, 2.6 * hz, tex),
            (c + side * 0.45 * hx + np.array((0, 0.4 * hy, 0.45 * hz)), 1.5 * hx, 2.0 * hz,
             "Storm" if cb["light"] else tex)]
