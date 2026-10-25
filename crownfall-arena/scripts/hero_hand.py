"""CFCL_Hero_Hand - colossal petrified LEFT hand reaching from the ground (Claude track, hero sculptor).

Run (headless Blender, slot-gated):
    python lib/run_blender.py scripts/hero_hand.py --timeout 2400 -- --iter 1 [--fast] [--norender]

Method
- Anatomy designed in REAL adult-hand centimetres (canonical frame: origin = wrist crease centre, +z toward the
  fingers, palm facing -y, thumb on -x).  hand length 19, palm length 10.8 (MCP joints at 8.4-9.5), palm width
  8.5 at the knuckles, phalanx ratio ~1 : 0.62 : 0.45, middle 8.2 / index 7.4 / ring 7.7 / little 6.2 visible
  finger lengths, thumb metacarpal 4.5 + 2 phalanges, thenar/hypothenar eminences with a cupped palm.
- Uniform scale SC = 2.5 m / 19 cm.  Forearm leans 15 deg toward the eclipse, 2 m of forearm visible.
- Gesture (research 4c): index + middle extended, ring + little curled (PIP 46 / 56 deg), thumb opposed
  (pulp rotated ~85 deg to face the fingers), wrist extended 12 deg and radially deviated 8 deg.
- Stone damage: little fingertip snapped through the middle phalanx (separate fragment object with the
  matching fracture), faceted knuckle / fingertip / forearm chips, cracks across finger joints, three spiral
  V-groove cracks climbing the forearm, eroded palm creases, pits and vertical rain runnels.
- Bronze manacle (snapped open, 4 hanging links, last link sheared) and a basalt mound with heaved plates.
"""
import sys
import os
import math
import time
import json
import shutil

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import numpy as np
import cf_sdf as S

F32 = np.float32
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(name, default):
    if name in ARGV:
        i = ARGV.index(name)
        if i + 1 < len(ARGV):
            return type(default)(ARGV[i + 1])
    return default


ITER = _arg("--iter", 1)
FAST = "--fast" in ARGV
NO_RENDER = "--norender" in ARGV
ASSET = "CFCL_Hero_Hand"
ASSET_DIR = os.path.join(CL, "assets", ASSET)
REN_DIR = os.path.join(CL, "renders", "hero_hand")
T_START = time.time()


def log(*a):
    print(f"[hand {time.time() - T_START:7.1f}s]", *a, flush=True)


# =============================================================================================
# generic helpers (duplicated in hero_hand.py on purpose: scripts must be standalone)
# =============================================================================================
def nrm(v):
    v = np.asarray(v, np.float64)
    return (v / np.linalg.norm(v)).astype(F32)


def fold(P):
    Q = P.copy()
    Q[:, 0] = np.abs(Q[:, 0])
    return Q


def ball(P, c, r):
    D = P - np.asarray(c, F32)
    return np.einsum('ij,ij->i', D, D) < F32(r * r)


def seg_mask(P, a, b, r):
    a = np.asarray(a, F32)
    b = np.asarray(b, F32)
    ba = b - a
    t = np.clip(((P - a) @ ba) / F32(ba @ ba), 0, 1)
    D = P - a - t[:, None] * ba
    return np.einsum('ij,ij->i', D, D) < F32(r * r)


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return (t * t * (3 - 2 * t)).astype(F32)


def basis(n):
    n = nrm(n)
    h = np.array([0, 0, 1.0]) if abs(n[2]) < 0.9 else np.array([1.0, 0, 0])
    a = nrm(np.cross(n, h))
    b = nrm(np.cross(n, a))
    return n, a, b


def axis_angle(u, deg):
    u = np.asarray(nrm(u), np.float64)
    t = math.radians(deg)
    K = np.array([[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]])
    return (np.eye(3) + math.sin(t) * K + (1 - math.cos(t)) * K @ K).astype(F32)


def flake(P, c, n, depth, radii, bevel=30.0, tilt=(0.0, 0.0), rot=0.0, rough=0.05, seed=0, rough_f=1.6):
    """Removal SDF (<0 inside) of a faceted stone break at surface point c (outward normal n).
    Convex polygon prism with len(radii) planar facets.  bevel>0: walls lean out (a chip, wider at
    the surface); bevel<0: wider inside (impact cone).  Floor = plane `depth` below c (tiltable)."""
    n, a, b = basis(n)
    D = P - np.asarray(c, F32)
    u = D @ a
    v = D @ b
    w = D @ n
    tn = nrm(n + tilt[0] * a + tilt[1] * b)
    R = -((D + F32(depth) * n) @ tn)
    tb = F32(math.tan(math.radians(bevel)))
    k = len(radii)
    for i, rho in enumerate(radii):
        ang = rot + 2 * math.pi * i / k
        R = np.maximum(R, u * F32(math.cos(ang)) + v * F32(math.sin(ang)) - (F32(rho) + w * tb))
    if rough:
        R = R + F32(rough) * S.fbm(P * F32(rough_f), 1.0, 2, seed=seed)
    return R


def crack(P, o, t, n_c, L, w0, D, d_outer, warp=0.3, wf=0.7, seed=0):
    """V-groove crack starting at o, running along t inside the plane with normal n_c.
    Lip width w0 tapering to 0 at length L; groove narrows to 0 at depth D below the outer surface."""
    Dp = P - np.asarray(o, F32)
    s = Dp @ np.asarray(t, F32)
    h = Dp @ np.asarray(n_c, F32)
    if warp:
        ramp = np.clip(s / 1.2, 0, 1).astype(F32)
        h = h + F32(warp) * ramp * (S.fbm(P * F32(wf), 1.0, 3, seed=seed)
                                    + 0.35 * S.fbm(P * F32(wf * 4.0), 1.0, 2, seed=seed + 7))
    taper = np.clip(1.0 - s / F32(L), 0, 1) ** F32(0.8)
    depthfac = np.clip(1.0 + d_outer / F32(D), 0, 1)
    R = np.abs(h) - F32(0.5 * w0) * taper * depthfac
    return np.maximum(R, -s)


def eval_chunks(fn, P, chunk=500_000):
    out = np.empty(len(P), F32)
    for i in range(0, len(P), chunk):
        out[i:i + chunk] = fn(P[i:i + chunk])
    return out


def _up(A, c, axis, n):
    t = np.arange(n, dtype=np.float64) / c
    i0 = np.minimum(np.floor(t).astype(np.int64), A.shape[axis] - 2)
    f = (t - i0).astype(F32)
    a0 = np.take(A, i0, axis=axis)
    a1 = np.take(A, i0 + 1, axis=axis)
    sh = [1, 1, 1]
    sh[axis] = n
    return (a0 + (a1 - a0) * f.reshape(sh)).astype(F32)


def mesh_narrow(fn, bmin, bmax, voxel, c=4, margin_k=1.6, label="", max_samples=8.2e6):
    """Narrow-band SDF sampling + Surface Nets. Dense grid <= max_samples (voxel grows if needed)."""
    t0 = time.time()
    bmin = np.asarray(bmin, np.float64)
    bmax = np.asarray(bmax, np.float64)
    ext = bmax - bmin + 4 * voxel
    while np.prod(ext / voxel + 1) > max_samples:
        voxel *= 1.04
        ext = bmax - bmin + 4 * voxel
    bmin = bmin - 2 * voxel
    n = np.ceil((bmax + 2 * voxel - bmin) / voxel).astype(int) + 1
    n = ((n - 1 + c - 1) // c) * c + 1
    nx, ny, nz = (int(v) for v in n)
    ncx, ncy, ncz = (nx - 1) // c + 1, (ny - 1) // c + 1, (nz - 1) // c + 1
    xs = (bmin[0] + np.arange(nx) * voxel).astype(F32)
    ys = (bmin[1] + np.arange(ny) * voxel).astype(F32)
    zs = (bmin[2] + np.arange(nz) * voxel).astype(F32)
    Pc = np.stack(np.meshgrid(xs[::c], ys[::c], zs[::c], indexing='ij'), -1).reshape(-1, 3)
    Fc = eval_chunks(fn, Pc).reshape(ncx, ncy, ncz)
    A = np.abs(Fc)
    neg = Fc < 0

    def sl(X, dx, dy, dz):
        return X[dx:ncx - 1 + dx, dy:ncy - 1 + dy, dz:ncz - 1 + dz]
    mn = sl(A, 0, 0, 0).copy()
    anyn = sl(neg, 0, 0, 0).copy()
    alln = anyn.copy()
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                mn = np.minimum(mn, sl(A, dx, dy, dz))
                anyn |= sl(neg, dx, dy, dz)
                alln &= sl(neg, dx, dy, dz)
    act = (mn < margin_k * c * voxel * math.sqrt(3)) | (anyn & ~alln)
    F = _up(_up(_up(Fc, c, 0, nx), c, 1, ny), c, 2, nz)
    M = np.zeros((nx, ny, nz), bool)
    M[:-1, :-1, :-1] = act.repeat(c, 0).repeat(c, 1).repeat(c, 2)
    M[1:, :, :] |= M[:-1, :, :].copy()
    M[:, 1:, :] |= M[:, :-1, :].copy()
    M[:, :, 1:] |= M[:, :, :-1].copy()
    cnt = 0
    for z0 in range(0, nz, 12):
        z1 = min(nz, z0 + 12)
        ii, jj, kk = np.nonzero(M[:, :, z0:z1])
        if len(ii) == 0:
            continue
        P = np.stack([xs[ii], ys[jj], zs[kk + z0]], 1)
        F[ii, jj, kk + z0] = eval_chunks(fn, P)
        cnt += len(ii)
    del M
    v, q = S.surface_nets(F, bmin.astype(F32), F32(voxel))
    log(f"mesh {label}: grid {nx}x{ny}x{nz}={nx*ny*nz/1e6:.2f}M, voxel {voxel*100:.2f}cm, exact {cnt/1e6:.2f}M, "
        f"{len(v)} verts {len(q)} quads, {time.time()-t0:.0f}s")
    return v, q


def surf_hit(fn, origin, direction, tmax, n=700):
    """Outermost inside->outside crossing of fn along origin + t*direction."""
    direction = nrm(direction)
    ts = np.linspace(0, tmax, n).astype(F32)
    P = (np.asarray(origin, F32)[None, :] + ts[:, None] * direction[None, :]).astype(F32)
    d = fn(P)
    idx = np.nonzero((d[:-1] < 0) & (d[1:] >= 0))[0]
    if len(idx) == 0:
        return None
    i = idx[-1]
    t = ts[i] + (ts[i + 1] - ts[i]) * (-d[i]) / (d[i + 1] - d[i])
    return np.asarray(origin, F32) + F32(t) * direction


def grad(fn, p, e=0.02):
    p = np.asarray(p, F32)
    P = np.array([p + [e, 0, 0], p - [e, 0, 0], p + [0, e, 0], p - [0, e, 0], p + [0, 0, e], p - [0, 0, e]], F32)
    d = fn(P)
    return nrm([d[0] - d[1], d[2] - d[3], d[4] - d[5]])


# =============================================================================================
# hand design (human centimetres, canonical frame)
#   origin = centre of the wrist crease; +z toward the fingers; palm faces -y; thumb on -x
#   (a LEFT hand seen palm-on with the thumb on screen-left).  Forearm runs down -z.
# =============================================================================================
SC = 2.5 / 19.0          # metres per human cm: wrist crease -> middle fingertip = 2.5 m
VIS_FOREARM = 16.0       # cm of forearm above the mound (= 2.1 m)
WP = np.array([0.0, 0.2, 0.3], F32)                 # wrist pivot
RW = S.rot_matrix(6.0, 0.0, 0.0)                    # wrist slightly palmar-flexed: cupped palm faces the board/camera

# finger skeleton: MCP centre, spread (deg, + = ulnar), flexion (MCP, PIP, DIP), lateral wobble per joint,
# phalanx lengths (proximal, middle, distal incl. pad), radii (MCP, PIP, DIP, tip)
FINGERS = {
    "index": dict(mcp=(-2.75, -0.25, 9.15), base=(-1.5, 0.2, 1.7), spread=-17.0, flex=(5, 7, 5), dev=(-3, 2, 0),
                  L=(4.2, 2.6, 1.9), r=(0.99, 0.90, 0.80, 0.70)),
    "middle": dict(mcp=(-0.9, 0.15, 9.5), base=(-0.4, 0.35, 1.5), spread=-5.0, flex=(6, 8, 6), dev=(2, -1, 0),
                   L=(4.6, 2.85, 2.05), r=(1.02, 0.93, 0.82, 0.71)),
    "ring": dict(mcp=(0.95, 0.05, 9.2), base=(0.75, 0.3, 1.6), spread=4.0, flex=(34, 56, 32), dev=(3, -2, 2),
                 L=(4.35, 2.7, 1.95), r=(0.97, 0.88, 0.78, 0.68)),
    "little": dict(mcp=(2.7, -0.35, 8.35), base=(1.75, 0.15, 1.9), spread=10.0, flex=(40, 60, 34), dev=(4, 3, 0),
                   L=(3.45, 2.1, 1.55), r=(0.88, 0.80, 0.71, 0.63)),
}
THUMB = dict(cmc=(-2.25, -0.55, 1.9), L=(4.5, 3.2, 2.7), r=(1.08, 1.05, 0.93, 0.74), flex=(0, 18, 28))


def _rot_pair(d, p, deg):
    a = math.radians(deg)
    return (math.cos(a) * d + math.sin(a) * p), (-math.sin(a) * d + math.cos(a) * p)


def _chain(f):
    sp = math.radians(f["spread"])
    d = np.array([math.sin(sp), 0.0, math.cos(sp)])
    p = np.array([0.0, -1.0, 0.0])
    lat = np.cross(p, d)
    J = [np.array(f["mcp"], float)]
    dirs, pals = [], []
    for k in range(3):
        d, p = _rot_pair(d, p, f["flex"][k])
        lat = np.cross(p, d)
        w = math.radians(f["dev"][k])
        d = math.cos(w) * d + math.sin(w) * lat
        d /= np.linalg.norm(d)
        p = p - (p @ d) * d
        p /= np.linalg.norm(p)
        L = f["L"][k] - (f["r"][3] if k == 2 else 0.0)
        J.append(J[-1] + L * d)
        dirs.append(d.copy())
        pals.append(p.copy())
    f["J"] = [j.astype(F32) for j in J]
    f["dirs"] = [nrm(v) for v in dirs]
    f["pals"] = [nrm(v) for v in pals]


for _f in FINGERS.values():
    _chain(_f)


def _thumb_chain():
    t = THUMB
    d = nrm((-0.60, -0.62, 0.50)).astype(float)            # ~48 deg radial + 38 deg palmar abduction
    p = np.array([0.8, -0.35, 0.1])                          # pulp faces the fingers (opposition ~85 deg)
    p = p - (p @ d) * d
    p /= np.linalg.norm(p)
    J = [np.array(t["cmc"], float)]
    dirs, pals = [], []
    for k in range(3):
        d, p = _rot_pair(d, p, t["flex"][k])
        L = t["L"][k] - (t["r"][3] if k == 2 else 0.0)
        J.append(J[-1] + L * d)
        dirs.append(d.copy())
        pals.append(p.copy())
    t["J"] = [j.astype(F32) for j in J]
    t["dirs"] = [nrm(v) for v in dirs]
    t["pals"] = [nrm(v) for v in pals]


_thumb_chain()

# little finger: tip broken off through the middle phalanx (fragment lies on the mound)
_lf = FINGERS["little"]
BREAK_P = (_lf["J"][1] + 0.52 * (_lf["J"][2] - _lf["J"][1])).astype(F32)
BREAK_N = nrm(_lf["dirs"][1] + 0.30 * _lf["pals"][1] + 0.18 * np.cross(_lf["pals"][1], _lf["dirs"][1]))


def break_field(P):
    """>0 on the distal (fragment) side of the little-finger fracture."""
    return (P - BREAK_P) @ BREAK_N + F32(0.07) * S.fbm(P * F32(2.2), 1.0, 2, seed=301) \
        + F32(0.05) * np.sign(S.fbm(P * F32(1.1), 1.0, 1, seed=302)) * F32(0.6)


def finger_sdf(P, f, k0=0):
    """Phalanx chain: round-cone shafts with a flattened dorsal plane, laterally wide PIP/DIP knuckles,
    a fleshy fingertip pad."""
    J, r = f["J"], f["r"]
    d = np.full(len(P), 1e3, F32)
    for k in range(k0, 3):
        seg = S.round_cone(P, J[k], J[k + 1], r[k], r[k + 1])
        dors = -f["pals"][k]
        L = float(np.linalg.norm(J[k + 1] - J[k]))
        t = np.clip(((P - J[k]) @ f["dirs"][k]) / F32(L), 0, 1)
        rt = F32(r[k]) + F32(r[k + 1] - r[k]) * t
        flat = (P - J[k]) @ dors - F32(0.80) * rt                       # flatter back of the finger
        seg = S.smax(seg, flat, 0.22 * r[k])
        d = np.minimum(d, seg)
    for k in (1, 2):                                                       # PIP / DIP knuckles
        if k < k0:
            continue
        dors = -f["pals"][k - 1]
        lat = nrm(np.cross(f["pals"][k - 1], f["dirs"][k - 1]))
        Rk = np.stack([lat, dors, f["dirs"][k - 1]], 1).astype(F32)
        kn = S.ellipsoid(P, J[k] + dors * F32(0.08 * r[k]), (1.14 * r[k], 0.95 * r[k], 0.8 * r[k]), Rk)
        d = S.smin(d, kn, 0.28 * r[k])
    tipc = J[2] + f["dirs"][2] * F32(0.5 * f["L"][2]) + f["pals"][2] * F32(0.22 * r[3])
    d = S.smin(d, S.ellipsoid(P, tipc, (r[3] * 0.88, r[3] * 0.9, r[3] * 0.9)), 0.2) if k0 <= 2 else d
    return d


def thumb_sdf(P):
    t = THUMB
    J, r = t["J"], t["r"]
    d = S.round_cone(P, J[0], J[1], r[0], r[1])
    d = S.smin(d, S.round_cone(P, J[1], J[2], r[1], r[2]), 0.3)
    d = S.smin(d, S.round_cone(P, J[2], J[3], r[2], r[3]), 0.25)
    d = S.smin(d, S.sphere(P, J[1] - t["pals"][0] * F32(0.2), r[1] * 1.08), 0.3)     # MCP knuckle
    d = S.smin(d, S.sphere(P, J[2] - t["pals"][1] * F32(0.15), r[2] * 1.07), 0.25)    # IP knuckle
    tipc = J[2] + t["dirs"][2] * F32(1.3) + t["pals"][2] * F32(0.3)
    d = S.smin(d, S.ellipsoid(P, tipc, (0.85, 0.85, 0.95)), 0.25)                      # pulp
    return d


def palm_sdf(P):
    z = P[:, 2]
    Pt = P.copy()
    Pt[:, 0] = Pt[:, 0] / (0.80 + 0.20 * np.clip(z / 8.0, 0, 1))                       # taper to the wrist
    d = S.box(Pt, (0.0, 0.05, 5.3), (3.3, 1.05, 3.95), None, 0.95)
    for f in FINGERS.values():                                                          # metacarpals
        d = S.smin(d, S.round_cone(P, f["base"], f["mcp"], 0.72, 0.82), 0.6)
        d = S.smin(d, S.sphere(P, np.array(f["mcp"], F32) + F32((0, 0.55, 0.15)), f["r"][0] * 1.0), 0.4)
        pad = np.array(f["mcp"], F32) + F32((0, -0.85, -0.75))
        d = S.smin(d, S.ellipsoid(P, pad, (0.85, 0.62, 0.78)), 0.45)                    # distal palm pads
        tb = np.array(f["base"], F32) + F32((0, 0.8, 0))
        te = np.array(f["mcp"], F32) + F32((0, 0.95, -0.5))
        d = S.smin(d, S.capsule(P, tb, te, 0.17), 0.25)                                  # extensor tendons
    d = S.smin(d, S.ellipsoid(P, (-2.35, -1.0, 3.2), (1.65, 1.35, 2.7), S.rot_matrix(0, -25, 0)), 0.8)   # thenar
    d = S.smin(d, S.ellipsoid(P, (2.55, -0.85, 4.0), (1.15, 1.05, 3.2), S.rot_matrix(0, 6, 0)), 0.8)      # hypothenar
    d = S.ssub(d, S.ellipsoid(P, (0.05, -2.2, 5.4), (1.95, 1.2, 2.6)), 0.7)                               # cup
    d = S.smin(d, S.ellipsoid(P, (0.0, 0.15, 0.5), (2.85, 1.55, 1.8)), 0.9)                               # carpus
    # first web space (thumb <-> index)
    t = THUMB
    wa = t["J"][1] - t["dirs"][0] * F32(1.0)
    d = S.smin(d, S.capsule(P, wa, np.array(FINGERS["index"]["mcp"], F32) + F32((-0.5, -0.25, -1.9)), 0.45), 0.8)
    d = S.smin(d, thumb_sdf(P), 0.9)
    return d


def hand_local_sdf(Ph):
    """Hand (palm + digits) in the hand frame. Returns (d, d_frag) where d_frag is the broken little tip."""
    d = palm_sdf(Ph)
    for name, f in FINGERS.items():
        m = seg_mask(Ph, f["J"][0], f["J"][3], 3.0)
        if not m.any():
            continue
        df = finger_sdf(Ph[m], f)
        if name == "little":
            df = np.maximum(df, break_field(Ph[m]))
        d[m] = S.smin(d[m], df, 0.75 if name != "little" else 0.65)
    return d


def frag_local_sdf(Ph):
    f = FINGERS["little"]
    d = finger_sdf(Ph, f, k0=1)
    d = np.maximum(d, -break_field(Ph))
    d = d + F32(0.035) * (S.ridged(Ph * F32(1.4), 1.0, 3, seed=72) - F32(0.5))
    return d


def forearm_sdf(Q):
    """Distal forearm: tapered wrist, flexor (palmar-ulnar) and extensor (dorsal-radial) muscle masses,
    brachioradialis ridge, flexor tendons at the wrist, radial / ulnar styloids."""
    Qe = Q.copy()
    Qe[:, 0] /= F32(1.48)
    d = S.round_cone(Qe, (0, 0.15, 0.2), (0, 0.5, -17.5), 1.85, 2.5)
    for tx in (-0.9, 0.1, 1.0):                                                   # flexor tendons at the wrist
        d = S.smin(d, S.capsule(Q, (tx, -1.6, -0.6), (tx * 0.8, -1.8, -6.0), 0.26), 0.45)
    d = S.smin(d, S.ellipsoid(Q, (1.3, -1.1, -10.5), (2.5, 2.1, 5.5)), 1.0)       # flexor mass
    d = S.smin(d, S.ellipsoid(Q, (-1.7, 0.9, -9.5), (2.3, 2.0, 5.8)), 1.0)        # extensor mass
    d = S.smin(d, S.capsule(Q, (-2.6, 0.2, -15.0), (-2.2, 0.3, -4.0), 0.9), 0.8)  # brachioradialis ridge
    d = S.smin(d, S.sphere(Q, (2.55, 0.9, -0.4), 0.55), 0.45)                    # ulnar styloid
    d = S.smin(d, S.sphere(Q, (-2.6, 0.4, -0.2), 0.5), 0.45)                     # radial styloid
    return d


def to_handframe(Q):
    return ((Q - WP) @ RW + WP).astype(F32)


def handframe_to_canon(Ph):
    return ((np.asarray(Ph, F32) - WP) @ RW.T + WP).astype(F32)


def anatomy(Q):
    """Canonical hand + forearm solid (no damage)."""
    d = forearm_sdf(Q)
    Ph = to_handframe(Q)
    m = Ph[:, 2] > -2.5
    if m.any():
        dh = hand_local_sdf(Ph[m])
        d[m] = S.smin(d[m], dh, 1.0)
    return d


# ---- damage -----------------------------------------------------------------------------------
DMG = None


def _surface_point(c, n, fn):
    n = nrm(n)
    p = surf_hit(lambda P: -fn(P), np.asarray(c, F32) - 2.5 * n, n, 5.0)
    return np.asarray(c, F32) if p is None else p


def _setup_damage():
    g = {}
    F = FINGERS
    chips = []

    def J(name, k):
        return handframe_to_canon(F[name]["J"][k][None, :])[0]

    def dors(name, k):
        return nrm(-(F[name]["pals"][k] @ RW.T))
    # knuckle and fingertip chips (fracture facets)
    spec = [
            (np.array([-2.4, 2.0, -4.0]), (-0.6, 1.0, 0.0), 0.28, 1.2),            # forearm spalls
            (np.array([2.6, 1.0, -9.0]), (0.9, 0.4, 0.0), 0.32, 1.5),
            (np.array([-3.0, -0.6, -7.5]), (-1.0, -0.3, 0.0), 0.25, 1.1),
            (np.array([3.2, -0.2, 3.5]), (1.0, -0.2, 0.1), 0.22, 0.9)]             # hypothenar edge
    rng = np.random.default_rng(17)
    for i, (c, n, dep, rad) in enumerate(spec):
        p = _surface_point(c, n, anatomy)
        k = int(rng.integers(5, 7))
        chips.append(dict(c=p, n=nrm(n), depth=dep * 0.5, radii=[rad * float(rng.uniform(0.75, 1.15)) for _ in range(k)],
                          rot=float(rng.uniform(0, 6.3)), tilt=(float(rng.uniform(-.2, .2)), float(rng.uniform(-.2, .2))),
                          seed=700 + i))
    g["chips"] = chips
    # cracks across finger joints (partial rings, dorsal + lateral sides)
    jc = []
    for name, k, ang in (("little", 1, 14),):
        f = F[name]
        d = f["dirs"][k] if k < 3 else f["dirs"][2]
        p = f["J"][k] + f["dirs"][min(k, 2)] * F32(0.25 * f["r"][k])
        n = nrm(d + math.tan(math.radians(ang)) * np.cross(f["pals"][min(k, 2)], d))
        jc.append(dict(p=p.astype(F32), n=n, pal=f["pals"][min(k, 2)], r=f["r"][k]))
    g["jcracks"] = jc
    return g


def palm_creases(Ph, d_outer):
    """Eroded palmar flexion creases (V-grooves) in the hand frame."""
    x, y, z = Ph[:, 0], Ph[:, 1], Ph[:, 2]
    dep = np.clip(1.0 + d_outer / F32(0.07), 0, 1)                    # wide, shallow eroded valleys (no aliasing)
    hw = F32(0.17) * dep
    w = F32(0.12) * S.fbm(Ph * F32(1.9), 1.0, 3, seed=33)
    distal = np.abs(z - (8.35 - 0.75 * ((x + 1.6) / 5.1) ** 2) + w) - hw
    distal = np.maximum(distal, np.maximum(-(x + 1.8), x - 3.7))
    prox = np.abs(z - (7.2 - 0.276 * (x + 3.2)) + w) - hw
    prox = np.maximum(prox, np.maximum(-(x + 3.3), x - 2.7))
    then = np.abs(np.sqrt((x + 3.9) ** 2 + ((z - 3.2) / 1.25) ** 2) - 2.6 + w) - hw
    then = np.maximum(then, np.maximum(-(z - 0.5), z - 7.0))
    R = np.minimum(np.minimum(distal, prox), then)
    R = np.maximum(R, y + 0.5)                                         # palmar side only
    return R


def hand_h(Q, Pw=None):
    d = anatomy(Q)
    d_outer = d.copy()
    g = DMG

    def cut(mask, R):
        if mask.any():
            d[mask] = np.maximum(d[mask], -R)
            d_outer[mask] = np.maximum(d_outer[mask], -R)
    for ch in g["chips"]:
        m = ball(Q, ch["c"], max(ch["radii"]) + 1.0)
        if m.any():
            cut(m, flake(Q[m], ch["c"], ch["n"], ch["depth"], ch["radii"], bevel=30, tilt=ch["tilt"], rot=ch["rot"],
                         rough=0.04, seed=ch["seed"]))
    Ph = to_handframe(Q)
    hm = Ph[:, 2] > -1.0
    if hm.any():
        idx = np.nonzero(hm)[0]
        Pm = Ph[idx]
        R = palm_creases(Pm, d_outer[idx])
        for jc in g["jcracks"]:
            D = Pm - jc["p"]
            h = D @ jc["n"] + F32(0.05) * S.fbm(Pm * F32(2.0), 1.0, 2, seed=44)
            near = np.sqrt(np.einsum('ij,ij->i', D, D)) - F32(jc["r"] * 1.6)
            dorsal = (D @ jc["pal"]) - F32(0.35 * jc["r"])                     # skip the palmar side
            dep = np.clip(1.0 + d_outer[idx] / F32(0.22), 0, 1)
            Rj = np.maximum(np.maximum(np.abs(h) - F32(0.06) * dep, near), dorsal)
            R = np.minimum(R, Rj)
        d[idx] = np.maximum(d[idx], -R)
        d_outer[idx] = np.maximum(d_outer[idx], -R)
    # spiral cracks climbing the forearm
    fm = Q[:, 2] < 1.5
    if fm.any():
        idx = np.nonzero(fm)[0]
        Qf = Q[idx]
        th = np.arctan2(Qf[:, 1] - 0.3, Qf[:, 0] / 1.42)
        hgt = -Qf[:, 2]
        R = np.full(len(idx), 10.0, F32)
        for (th0, pitch, h0, h1, w0, sd) in ((0.4, 13.0, -0.5, 15.5, 0.22, 51), (3.4, -19.0, 2.5, 14.0, 0.18, 52)):
            ang = th - (th0 + 2 * math.pi * hgt / pitch)
            ang = (ang + math.pi) % (2 * math.pi) - math.pi
            warp = F32(0.45) * S.fbm(Qf * F32(0.8), 1.0, 3, seed=sd) + F32(0.12) * S.fbm(Qf * F32(3.0), 1.0, 2, seed=sd + 5)
            taper = np.clip((hgt - h0) / 2.0, 0, 1) * np.clip((h1 - hgt) / 2.5, 0, 1)
            dep = np.clip(1.0 + d_outer[idx] / F32(0.9), 0, 1)
            Rc = np.abs(ang * F32(2.4) + warp) - F32(0.5 * w0) * taper * dep
            R = np.minimum(R, Rc)
        d[idx] = np.maximum(d[idx], -R)
        d_outer[idx] = np.maximum(d_outer[idx], -R)
    # long rain-erosion flutes running down the forearm (broad, shallow channels)
    fm2 = Q[:, 2] < 0.5
    if fm2.any():
        idx = np.nonzero(fm2)[0]
        Qf = Q[idx]
        R = np.full(len(idx), 10.0, F32)
        for (th0, z0, z1, w, sd) in ((1.3, -15.5, -2.5, 0.42, 61), (2.2, -14.0, -4.0, 0.34, 62),
                                     (-0.4, -15.0, -6.0, 0.38, 63), (3.6, -12.0, -3.0, 0.3, 64)):
            c = np.array([math.cos(th0) * 3.4, 0.3 + math.sin(th0) * 2.4], F32)
            wig = F32(0.35) * S.fbm(Qf * F32(0.6), 1.0, 2, seed=sd)
            dx = Qf[:, 0] - c[0] - wig
            dy = Qf[:, 1] - c[1]
            Rf = np.sqrt(dx * dx + dy * dy) - F32(w)
            Rf = np.maximum(Rf, np.maximum(F32(z0) - Qf[:, 2], Qf[:, 2] - F32(z1)))
            R = np.minimum(R, Rf)
        dep = np.clip(1.0 + d_outer[idx] / F32(0.22), 0, 1)
        R = R + F32(0.22) * (1 - dep)
        d[idx] = np.maximum(d[idx], -R)
        d_outer[idx] = np.maximum(d_outer[idx], -R)
    e = F32(0.07) * S.fbm(Q * F32(0.5), 1.0, 2, seed=71)
    e += F32(0.04) * (S.ridged(Q * F32(1.3), 1.0, 3, seed=72) - F32(0.5))
    if Pw is not None:
        ns = np.nonzero(np.abs(d_outer) < 0.6)[0]                      # near-surface points: real SDF normals
        if len(ns):
            Qn = Q[ns]
            h0 = d_outer[ns]
            gx = anatomy(Qn + F32((0.06, 0, 0))) - h0
            gy = anatomy(Qn + F32((0, 0.06, 0))) - h0
            gz = anatomy(Qn + F32((0, 0, 0.06))) - h0
            gl = np.sqrt(gx * gx + gy * gy + gz * gz) + F32(1e-6)
            upw = sstep(0.2, 0.65, (gx * UP_C[0] + gy * UP_C[1] + gz * UP_C[2]) / gl)
            Pn = Pw[ns]
            clus = sstep(0.12, 0.42, S.fbm(Qn * F32(0.32), 1.0, 2, seed=75))          # pockets come in clusters
            pk = S.fbm(Pn * np.array([1 / 0.045, 1 / 0.045, 1 / 0.16], F32), 1.0, 2, seed=73)  # drawn out along gravity
            e[ns] += F32(0.07) * sstep(0.30, 0.55, pk) * clus * upw
            steep = F32(1.0) - upw
            Rn = S.ridged(Pn * np.array([1 / 0.07, 1 / 0.07, 1 / 0.6], F32), 1.0, 2, seed=74)
            e[ns] += F32(0.045) * sstep(0.84, 0.97, Rn) * steep
    return d + e, d_outer + e


# =============================================================================================
# asset-frame pose (metres).  Asset origin = ground-contact centre of the mound.
# Forearm leans 15 deg toward the eclipse (local dir (-0.45, 0.88) once yawed -24 deg in the layout).
# =============================================================================================
ECL_LOCAL = nrm((-0.51, 0.86, 0.0))   # plan direction of the eclipse once yawed -22 deg
LEAN_DEG = 15.0                         # reach implied by a 15 deg lean (upright hand, reference 01)
_uf = nrm(math.cos(math.radians(LEAN_DEG)) * np.array([0, 0, 1.0]) + math.sin(math.radians(LEAN_DEG)) * ECL_LOCAL)
_yp = np.array([0, 1.0, 0]) - (np.array([0, 1.0, 0]) @ _uf) * _uf
_yp = nrm(_yp)
_xp = nrm(np.cross(_yp, _uf))
RA = np.stack([_xp, _yp, _uf], 1).astype(F32)       # canonical -> asset
UP_C = (RA.T @ np.array([0, 0, 1.0], F32)).astype(F32)   # world up in canonical coords
MOUND_TOP = 0.50
EMERGE = np.array([0.0, 0.0, MOUND_TOP], F32)
TA = (EMERGE - RA @ np.array([0.0, 0.3, -VIS_FOREARM], F32) * F32(SC)).astype(F32)


def to_canon(Pw):
    return (((Pw - TA) @ RA) / F32(SC)).astype(F32)


def canon_to_w(Q):
    return (np.asarray(Q, F32) * F32(SC)) @ RA.T + TA


def ground_h(x, y):
    x = np.asarray(x, F32)
    y = np.asarray(y, F32)
    r2 = x * x + y * y
    h = 0.42 * np.exp(-r2 / 1.25 ** 2) + 0.16 * np.exp(-r2 / 2.4 ** 2)
    P2 = np.stack([x * 0.8, y * 0.8, np.zeros_like(x)], 1).astype(F32)
    h += 0.08 * S.fbm(P2, 1.0, 3, seed=41) + 0.03 * (S.ridged(P2 * 3.0, 1.0, 2, seed=43) - 0.5)
    h -= 0.30 * sstep(2.1, 3.6, np.sqrt(r2))
    return h.astype(F32)


def hand_world(Pw):
    Q = to_canon(Pw)
    d, d_outer = hand_h(Q, Pw)
    d = d * F32(SC)
    d_outer = d_outer * F32(SC)
    near = Pw[:, 2] < 1.2
    if near.any():
        Pn = Pw[near]
        gf = Pn[:, 2] - (ground_h(Pn[:, 0], Pn[:, 1]) - F32(0.03))
        gf = np.maximum(gf, np.maximum(d_outer[near] - F32(0.30), -d_outer[near]))
        d[near] = S.smin(d[near], gf, 0.2)
    return np.maximum(d, -(Pw[:, 2] + F32(0.15)))


def hand_outer_world(Pw):
    return anatomy(to_canon(Pw)) * F32(SC)


# ---- finger fragment lying on the mound --------------------------------------------------------
FRAG_C = None
FRAG_R = (S.rot_matrix(0, 0, 35.0) @ S.rot_matrix(80.0, 0, 0)).astype(F32)
FRAG_POS = np.array([0.95, -1.15, 0.0], F32)


def _setup_frag():
    global FRAG_C, FRAG_POS
    f = FINGERS["little"]
    FRAG_C = ((f["J"][1] + f["J"][3]) * 0.5 + f["dirs"][1] * 0.6).astype(F32)
    gz = float(ground_h(FRAG_POS[0:1], FRAG_POS[1:2])[0])
    FRAG_POS = np.array([FRAG_POS[0], FRAG_POS[1], gz + 0.04], F32)


def frag_world(Pw):
    Ph = ((Pw - FRAG_POS) @ FRAG_R) / F32(SC) + FRAG_C
    d = frag_local_sdf(Ph.astype(F32)) * F32(SC)
    return np.maximum(d, -(Pw[:, 2] - (ground_h(Pw[:, 0], Pw[:, 1]) - F32(0.08))))


# ---- mound with heaved plates ---------------------------------------------------------------------
def _build_plates():
    rng = np.random.default_rng(808)
    plates = []
    n = 8
    for k in range(n):
        th = 2 * math.pi * k / n + rng.uniform(-0.25, 0.25)
        rad = rng.uniform(0.62, 0.95)
        c = np.array([rad * math.cos(th), rad * math.sin(th), 0.0])
        c[2] = float(ground_h(np.array([c[0]], F32), np.array([c[1]], F32))[0]) + rng.uniform(0.0, 0.08)
        outward = np.array([math.cos(th), math.sin(th), 0.0])
        tilt = math.radians(rng.uniform(15, 30))
        nz = nrm(math.cos(tilt) * np.array([0, 0, 1.0]) + math.sin(tilt) * outward)
        _, a, b = basis(nz)
        k2 = int(rng.integers(5, 7))
        planes = [nz, -nz]
        offs = [rng.uniform(0.07, 0.11), rng.uniform(0.07, 0.11)]
        size = rng.uniform(0.32, 0.5)
        for j in range(k2):
            ang = 2 * math.pi * j / k2 + rng.uniform(-0.3, 0.3)
            planes.append(nrm(math.cos(ang) * a + math.sin(ang) * b + rng.uniform(-0.2, 0.2) * nz))
            offs.append(size * rng.uniform(0.75, 1.15))
        plates.append(dict(c=c.astype(F32), N=np.array(planes, F32), off=np.array(offs, F32), s=size))
    for k in range(34):                                                    # loose rubble
        th = rng.uniform(0, 2 * math.pi)
        rad = 1.0 + 1.7 * rng.uniform(0, 1) ** 1.3
        s = 0.06 + 0.24 * rng.uniform(0, 1) ** 2.2
        c = np.array([rad * math.cos(th), rad * math.sin(th), 0.0])
        c[2] = float(ground_h(np.array([c[0]], F32), np.array([c[1]], F32))[0]) + s * rng.uniform(-0.2, 0.3)
        N = rng.normal(size=(int(rng.integers(7, 10)), 3))
        N = np.concatenate([N, np.eye(3), -np.eye(3)])
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        plates.append(dict(c=c.astype(F32), N=N.astype(F32), off=(s * rng.uniform(0.7, 1.1, len(N))).astype(F32), s=s))
    return plates


PLATES = None


def mound_world(Pw):
    x, y, z = Pw[:, 0], Pw[:, 1], Pw[:, 2]
    d = (z - ground_h(x, y)) * F32(0.8)
    for pl in PLATES:
        m = ball(Pw, pl["c"], pl["s"] * 1.6 + 0.15)
        if not m.any():
            continue
        q = Pw[m] - pl["c"]
        dr = np.max(q @ pl["N"].T - pl["off"][None, :], axis=1)
        dr = np.maximum(dr, S.length(q) - F32(1.25 * pl["s"] + 0.1))
        d[m] = S.smin(d[m], dr, 0.025)
    d = d + F32(0.01) * (S.ridged(Pw * F32(4.0), 1.0, 2, seed=91) - F32(0.5))
    ms = ball(Pw, (0, 0, 0.6), 1.6)
    if ms.any():
        d[ms] = np.maximum(d[ms], -(hand_outer_world(Pw[ms]) + F32(0.03)))
    return np.maximum(d, -(z + F32(0.25)))


# ---- bronze manacle + chain (asset frame, metres) ------------------------------------------------
MAN = {}


def _setup_manacle():
    zc = -2.3
    c = canon_to_w((0.0, 0.22, zc))
    ax, ay = 2.12 * 1.48 + 0.18, 2.12 + 0.18                # inner half-axes (cm) with a loose gap
    MAN.update(c=c.astype(F32), ax=ax * SC, ay=ay * SC, t=0.075, hgt=0.26, R=RA)
    th_l = math.atan2(-0.75, -0.66)                           # lug on the palmar-radial underside
    lug_local = np.array([math.cos(th_l) * (ax * SC + 0.06), math.sin(th_l) * (ay * SC + 0.06), -0.02])
    lug = c + RA @ lug_local
    MAN.update(th_gap=th_l + math.pi + 0.35, th_lug=th_l, lug=lug.astype(F32))
    links = []
    hl, rho, rw = 0.06, 0.08, 0.034
    pitch = 2 * (hl + rho) - 2.4 * rw                                 # interlocking pitch (m)
    down = np.array([0, 0, -1.0], F32)                              # links hang free under gravity
    outward = nrm(RA @ np.array([math.cos(th_l), math.sin(th_l), 0.0]))
    tang = nrm(np.cross(down, outward))
    start = lug.astype(float) + down * (hl + rho - 0.02) + outward * 0.03
    for k in range(4):
        cen = start + down * (pitch * k)
        side = tang if k % 2 == 0 else outward
        links.append(dict(c=np.asarray(cen, F32), a=down, b=nrm(side), sheared=(k == 3)))
    MAN.update(links=links, hl=hl, rho=rho, rw=rw)


def manacle_world(Pw):
    m = MAN
    q = (Pw - m["c"]) @ m["R"]
    th = np.arctan2(q[:, 1] / m["ay"], q[:, 0] / m["ax"])
    dg = (th - m["th_gap"] + math.pi) % (2 * math.pi) - math.pi
    bend = 1.0 + 0.16 * np.exp(-(dg / 0.45) ** 2)                       # sprung ends near the break
    e = np.sqrt((q[:, 0] / (m["ax"] * bend)) ** 2 + (q[:, 1] / (m["ay"] * bend)) ** 2)
    rmean = 0.5 * (m["ax"] + m["ay"])
    ring = np.abs((e - 1.0) * rmean - m["t"] / 2) - m["t"] / 2
    d = np.maximum(ring, np.abs(q[:, 2]) - m["hgt"] / 2) - 0.008
    d = np.maximum(d, -(np.abs(dg) * rmean - 0.09))                     # the snapped gap
    # age: lumpy cast surface, corrosion pits, two dents and a worn, uneven rim
    d = d + F32(0.006) * S.fbm(Pw * F32(9.0), 1.0, 2, seed=5) + F32(0.004) * S.fbm(Pw * F32(30.0), 1.0, 2, seed=6)
    d = d + F32(0.007) * sstep(0.25, 0.55, S.fbm(Pw * F32(22.0), 1.0, 2, seed=7))
    for dc, dr in (((0.0, -1.0, 0.0), 0.10), ((0.8, 0.5, 0.3), 0.08)):
        cdir = m["R"] @ np.array(dc, F32)
        cen = m["c"] + nrm(cdir) * F32(max(m["ax"], m["ay"]) + m["t"] + dr * 0.75)
        d = S.ssub(d, S.sphere(Pw, cen, dr), 0.02)
    d = np.maximum(d, -flake(Pw, m["c"] + m["R"] @ np.array([math.cos(m["th_gap"] + 0.3) * m["ax"] * 1.17,
                                                              math.sin(m["th_gap"] + 0.3) * m["ay"] * 1.17,
                                                              m["hgt"] / 2]),
                             m["R"] @ np.array([0, 0, 1.0]), 0.05, [0.05, 0.06, 0.05, 0.07], bevel=20, rough=0))
    # hinge lug
    lug_box = S.box(Pw, m["lug"], (0.07, 0.07, 0.11), m["R"], 0.015)
    d = np.minimum(d, lug_box)
    for L in m["links"]:
        D = Pw - L["c"]
        a = D @ L["a"]
        b = D @ L["b"]
        cn = D @ nrm(np.cross(L["a"], L["b"]))
        qa = np.maximum(np.abs(a) - m["hl"], 0)
        dl = np.sqrt((np.sqrt(qa * qa + b * b) - m["rho"]) ** 2 + cn * cn) - m["rw"]
        dl = dl + F32(0.004) * S.fbm(Pw * F32(25.0), 1.0, 2, seed=9)            # pitted, worn links
        if L["sheared"]:
            dl = np.maximum(dl, -(np.maximum(np.abs(b + m["rho"]) - 0.035, -(a + 0.02))))  # sheared open
        d = np.minimum(d, dl)
    return d


# =============================================================================================
# Blender build
# =============================================================================================
def build():
    import bpy
    import cf_materials as M
    import cf_render as R
    global DMG, PLATES
    log("setup")
    DMG = _setup_damage()
    _setup_frag()
    _setup_manacle()
    PLATES = _build_plates()
    R.reset_scene()
    col = bpy.data.collections.new(ASSET)
    bpy.context.scene.collection.children.link(col)
    mat_stone = M.get("HandStone")       # library defaults (surface agent owns moss/value tuning)
    mat_basalt = M.get("Basalt")
    mat_bronze = M.get("Bronze")
    vs = 1.6 if FAST else 1.0

    # hand bbox from a coarse sample of the canonical anatomy
    P = np.stack(np.meshgrid(np.arange(-9, 9.01, 0.35, dtype=F32), np.arange(-8, 6.01, 0.35, dtype=F32),
                             np.arange(-17, 21.01, 0.35, dtype=F32), indexing='ij'), -1).reshape(-1, 3)
    W = canon_to_w(P[anatomy(P) < 0])
    bmin = W.min(0) - 0.12
    bmax = W.max(0) + 0.12
    bmin[0] = min(bmin[0], -0.75)
    bmin[1] = min(bmin[1], -0.75)
    bmax[0] = max(bmax[0], 0.75)
    bmax[1] = max(bmax[1], 0.75)
    bmin[2] = -0.17
    v, q = mesh_narrow(hand_world, bmin, bmax, 0.010 * vs, label="hand")
    hd = S.to_blender_mesh(ASSET, v, q, collection=col)
    del v, q
    decimate(hd, 118000 if not FAST else 60000)

    fa = canon_to_w(np.array([[0, 0, 0]], F32))  # noqa
    fr_pts = []
    f = FINGERS["little"]
    for k in (1, 2, 3):
        fr_pts.append(((f["J"][k] - FRAG_C) * F32(SC)) @ FRAG_R.T + FRAG_POS)
    fr_pts = np.array(fr_pts)
    v, q = mesh_narrow(frag_world, fr_pts.min(0) - 0.16, fr_pts.max(0) + 0.16, 0.007 * vs, label="fragment")
    fg = S.to_blender_mesh(ASSET + "_FingerFragment", v, q, collection=col)
    decimate(fg, 7000)

    lk = np.array([L["c"] for L in MAN["links"]] + [MAN["c"]])
    span = max(MAN["ax"], MAN["ay"]) + 0.2
    v, q = mesh_narrow(manacle_world, np.minimum(lk.min(0), MAN["c"] - span) - 0.12,
                       np.maximum(lk.max(0), MAN["c"] + span) + 0.12, 0.0075 * vs, label="manacle")
    mc = S.to_blender_mesh(ASSET + "_Manacle", v, q, collection=col)
    decimate(mc, 16000)

    v, q = mesh_narrow(mound_world, (-3.5, -3.5, -0.3), (3.5, 3.5, 1.1), 0.022 * vs, label="mound")
    mo = S.to_blender_mesh(ASSET + "_Mound", v, q, collection=col)
    decimate(mo, 30000)

    for o, m in ((hd, mat_stone), (fg, mat_stone), (mc, mat_bronze), (mo, mat_basalt)):
        o.data.materials.clear()
        o.data.materials.append(m)
        try:
            M.bake_curvature(o)
        except Exception as e:  # pragma: no cover
            log("curvature bake failed", o.name, e)
        o.data.shade_smooth()
        try:
            o.data.set_sharp_from_angle(angle=math.radians(52))
        except Exception as e:  # pragma: no cover
            log("sharp-from-angle unavailable:", e)
    from mathutils import Matrix, Vector
    for o in (fg, mc):
        mn, mx = R.bounds([o])
        oc = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
        o.data.transform(Matrix.Translation(-oc))
        o.location = oc
    bpy.context.view_layer.update()
    info = save_asset([hd, fg, mc, mo])
    if not NO_RENDER:
        render_all(hd, fg, mc, mo, info)
    write_meta(info)
    log("done")


def decimate(ob, target):
    import bpy
    nq = len(ob.data.polygons)
    ratio = min(1.0, target / max(1, 2 * nq))
    if ratio < 0.999:
        m = ob.modifiers.new("Dec", 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        old = ob.data
        ob.modifiers.clear()
        ob.data = me
        me.name = ob.name + "_Mesh"
        bpy.data.meshes.remove(old)
    log(f"decimate {ob.name}: {2*nq} -> {len(ob.data.polygons)} faces")


def next_version():
    os.makedirs(ASSET_DIR, exist_ok=True)
    vs = [int(f[-9:-6]) for f in os.listdir(ASSET_DIR) if f.startswith(ASSET + "_v") and f.endswith(".blend")]
    return (max(vs) + 1) if vs else 1


def save_asset(objs):
    import bpy
    import cf_render as R
    ver = next_version()
    path = os.path.join(ASSET_DIR, f"{ASSET}_v{ver:03d}.blend")
    info = dict(version=ver, blend=os.path.basename(path), objects=[])
    for o in objs:
        mn, mx = R.bounds([o])
        info["objects"].append(dict(name=o.name, dims=[round(mx[i] - mn[i], 3) for i in range(3)],
                                    bounds_min=[round(v, 3) for v in mn], bounds_max=[round(v, 3) for v in mx],
                                    origin=[round(v, 3) for v in o.location], tris=R.tri_count([o]),
                                    materials=[m.name for m in o.data.materials]))
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    os.makedirs(os.path.join(ASSET_DIR, "src"), exist_ok=True)
    shutil.copy(os.path.abspath(__file__), os.path.join(ASSET_DIR, "src", f"hero_hand_v{ver:03d}.py"))
    log("saved", path)
    tip = canon_to_w(handframe_to_canon(FINGERS["middle"]["J"][3][None, :]))[0]
    info["middle_tip_world"] = [round(float(v), 3) for v in tip]
    info["wrist_world"] = [round(float(v), 3) for v in canon_to_w(np.zeros((1, 3), F32))[0]]
    return info


RESEARCH = dict(origin=(4.5, 10.0, -0.35), yaw=-22.0)   # tips 4.1% W clear of eclipse (3.0,20,5.4) r2; palm ~18 deg off camera
CODEX = dict(origin=(3.53, 9.91, -0.14), yaw=-18.0)    # Codex pass12 foot point; tips 6.4% W clear of (0,19,6.05) r1.9


def placements(info, mode):
    cfg = RESEARCH if mode == "research" else CODEX
    yaw = cfg["yaw"]
    cz = math.radians(yaw)
    Rz = np.array([[math.cos(cz), -math.sin(cz), 0], [math.sin(cz), math.cos(cz), 0], [0, 0, 1]])
    L = np.array(cfg["origin"], float)
    out = []
    for ob in info["objects"]:
        loc = L + Rz @ np.array(ob["origin"])
        out.append(dict(source=ob["name"], name=ob["name"], location=[round(float(v), 4) for v in loc],
                        rotation_deg=[0.0, 0.0, yaw], scale=[1, 1, 1]))
    return out


def render_all(hd, fg, mc, mo, info):
    import bpy
    import cf_render as R
    import cf_materials as M
    from mathutils import Vector
    sc = bpy.context.scene
    R.setup_world(sc)
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=80, fill_type='NGON', location=(0, 0, -0.06))
    gnd = bpy.context.active_object
    gnd.name = "CFCL_PreviewGround"
    gnd.data.materials.append(M.get("Basalt"))
    os.makedirs(REN_DIR, exist_ok=True)
    pre = os.path.join(REN_DIR, f"iter{ITER:02d}")
    paths = R.turntable([hd], pre, lens=50, res=(900, 1000), samples=40 if FAST else 56,
                        views=(("front", 0, 10), ("q_left", -40, 16), ("side", 90, 8), ("q_back", 150, 20)))
    f = FINGERS
    lt = Vector(canon_to_w(handframe_to_canon(f["little"]["J"][1][None, :]))[0])
    paths.append(R.render_to(f"{pre}_closeup_fingers.png",
                             R.camera("CFCL_Cam_cu1", tuple(lt + Vector((0.9, -1.5, 0.5))), tuple(lt), 40)))
    wr = Vector(MAN["c"])
    paths.append(R.render_to(f"{pre}_closeup_wrist.png",
                             R.camera("CFCL_Cam_cu2", tuple(wr + Vector((1.2, -1.9, 0.2))), tuple(wr - Vector((0, 0, 0.4))), 35)))
    pl = {p["name"]: p for p in placements(info, "research")}
    for o in (hd, fg, mc, mo):
        p = pl[o.name]
        o.location = p["location"]
        o.rotation_euler = (0, 0, math.radians(p["rotation_deg"][2]))
    gnd.location = (0, 0, RESEARCH["origin"][2] - 0.06)
    try:
        R.append_board()
    except Exception as e:
        log("board append failed", e)
    # stand-in eclipse disc (render check only, not saved): research position (3.0, 20, 5.4) r 2.0
    bpy.ops.mesh.primitive_uv_sphere_add(radius=2.0, location=(3.0, 20.0, 5.4), segments=48, ring_count=24)
    ecl = bpy.context.active_object
    em = bpy.data.materials.new("PreviewEclipseDisc")
    em.use_nodes = True
    em.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    ecl.data.materials.append(em)
    R.setup_render(sc, "EEVEE", (1280, 720), 40 if FAST else 64)
    paths.append(R.render_to(f"{pre}_hero28mm.png", R.camera("CFCL_Cam_Hero", (0, -1.31, 0.22), (0, 10, 0.615), 28)))
    paths.append(R.render_to(f"{pre}_hero75mm.png", R.camera("CFCL_Cam_HeroTele", (0, -1.31, 0.22), (4.2, 10.3, 2.5), 75)))
    info["renders"] = [os.path.relpath(p, CL) for p in paths]


def write_meta(info):
    import cf_render as R
    meta = dict(asset=ASSET, version=info["version"], blend=info["blend"], iteration=ITER,
                units="metres, +Z up", scale_m_per_human_cm=SC,
                design="real adult LEFT hand in cm (wrist crease->middle tip 19 cm) scaled uniformly to 2.5 m",
                origin="asset origin (0,0,0) = ground-contact centre of the mound; fragment/manacle origins = their "
                       "own bottom centres",
                objects=info["objects"], tris_total=sum(o["tris"] for o in info["objects"]),
                tris_hand_plus_fragments=sum(o["tris"] for o in info["objects"] if not o["name"].endswith("Mound")),
                middle_tip_world=info.get("middle_tip_world"), wrist_world=info.get("wrist_world"),
                renders=info.get("renders", []), placement_research=RESEARCH, placement_codex=CODEX)
    R.write_json(os.path.join(ASSET_DIR, "meta.json"), meta)
    for mode, fn in (("research", "arrangement.json"), ("codex", "arrangement_codex.json")):
        R.write_json(os.path.join(ASSET_DIR, fn), dict(asset=ASSET, blend=info["blend"],
                                                        placements=placements(info, mode)))
    log("meta written", meta["tris_total"], "tris")


if __name__ == "__main__":
    try:
        import bpy  # noqa: F401
        build()
    except ImportError:
        print("Run inside Blender via lib/run_blender.py")
