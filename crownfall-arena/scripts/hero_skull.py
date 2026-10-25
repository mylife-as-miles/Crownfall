"""CFCL_Hero_Skull - colossal petrified human skull (Claude track, hero sculptor).

Run (headless Blender, slot-gated):
    python lib/run_blender.py scripts/hero_skull.py --timeout 2400 -- --iter 1 [--fast] [--norender]

Method
- Anatomy is designed in REAL adult-skull centimetres in the Frankfort-horizontal frame
  (x lateral, +x = the skull's own LEFT; y posterior, -y = face; z up; origin between the porions).
  Reference measurements used: glabella->opisthocranion 18.5, parietal breadth 14, basion-bregma 13.5,
  bizygomatic 13.3, orbits 4.0 x 3.4 (centres 3.1 from midline, tilted down laterally, >=4.5 deep),
  interorbital 2.5, nasal aperture 2.5 x 3.2, vertex->upper incisal edge 18.0.
- Uniform scale SC metres per human cm (0.16 -> 2.24 m breadth, 2.96 m length, 2.88 m vertex->teeth,
  ~2.6 m visible above the rubble).  Pose baked: chin pitched down 8 deg, rolled 6 deg (left side up).
- SDF = ellipsoids / round cones / tubes joined with smin, cavities with ssub, hollow brain case
  (shell 1.0 cm = 7% of breadth), then stone damage: faceted flake removals (plane-bounded convex
  prisms), an impact breach on the upper-LEFT parietal with spall terraces and a radiating V-groove
  crack network, a broken right zygomatic arch, chipped rims, zig-zag sutures, weathering pits and
  vertical rain runnels.  Teeth are a separate finer SDF mesh (individual, uneven, 3 missing).
- Narrow-band evaluation: coarse grid, exact SDF only near the surface, Surface Nets meshing.
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
ASSET = "CFCL_Hero_Skull"
ASSET_DIR = os.path.join(CL, "assets", ASSET)
REN_DIR = os.path.join(CL, "renders", "hero_skull")
T_START = time.time()


def log(*a):
    print(f"[skull {time.time() - T_START:7.1f}s]", *a, flush=True)


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
    Deff = F32(D) * (1.0 - 0.65 * np.clip(s / F32(L), 0, 1))
    depthfac = np.clip(1.0 + d_outer / Deff, 0, 1)
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
# skull design (human centimetres)
# =============================================================================================
SC = 0.15            # metres per human cm (2.1 m breadth, 2.8 m length, 2.8 m vertex->teeth)
T_SHELL = 1.0        # cranial wall thickness (cm) = 7% of breadth
PITCH, ROLL = 8.0, -6.0
C0 = np.array([0.0, 1.0, 4.6], F32)  # brain-case centre

# ---- upper dental arch (parabola through the crown centres)
ARCH_Y0, ARCH_C = -8.75, 0.62
_ax = np.linspace(0, 3.8, 6000)
_ay = ARCH_Y0 + ARCH_C * _ax ** 2
_as = np.concatenate([[0], np.cumsum(np.hypot(np.diff(_ax), np.diff(_ay)))])


def arch_at(s):
    x = float(np.interp(s, _as, _ax))
    y = ARCH_Y0 + ARCH_C * x * x
    t = nrm((1.0, 2 * ARCH_C * x, 0.0))
    out = nrm((t[1], -t[0], 0.0))
    return x, y, t, out


# name, md width, crown height, labio-lingual half thickness, kind, cervical z
UPPER = [("CI", 0.86, 1.06, 0.36, "inc", -4.95), ("LI", 0.66, 0.92, 0.32, "inc", -4.97),
         ("C", 0.78, 1.16, 0.42, "can", -4.98), ("PM1", 0.70, 0.84, 0.46, "pm", -4.88),
         ("PM2", 0.66, 0.80, 0.45, "pm", -4.85), ("M1", 1.02, 0.74, 0.55, "mol", -4.78),
         ("M2", 0.92, 0.70, 0.53, "mol", -4.74), ("M3", 0.85, 0.62, 0.50, "mol", -4.70)]
# side +1 = skull's left (+x), -1 = right (camera side after the yaw toward the board)
MISSING = {(1, "LI"), (-1, "PM1"), (1, "M3")}
RECEDED = {(-1, "LI"), (1, "PM2"), (-1, "M1")}          # alveolar bone eroded, root exposed
TILT = {"inc": 15.0, "can": 9.0, "pm": 4.0, "mol": 2.0}  # crown proclination toward labial (deg)


def _build_teeth():
    rng = np.random.default_rng(1234)
    teeth, sockets = [], []
    s = 0.0
    for name, w, h, tl, kind, cz in UPPER:
        sc = s + w / 2
        s += w + 0.035
        x, y, t, out = arch_at(sc)
        for side in (1, -1):
            dz = float(rng.uniform(-0.07, 0.07))
            yaw = float(rng.uniform(-6, 6))
            tilt = TILT[kind] + float(rng.uniform(-4, 4))
            c = np.array([side * x, y, cz + dz + 0.10], F32)
            e_md = nrm((side * t[0], t[1], 0))
            e_lab = nrm((side * out[0], out[1], 0))
            a = math.radians(tilt)
            up = nrm(math.cos(a) * np.array([0, 0, 1.0]) - math.sin(a) * e_lab)
            e_lab = nrm(e_lab - (e_lab @ up) * up)
            R = axis_angle(up, yaw)
            e_lab = R @ e_lab
            e_md = nrm(np.cross(up, e_lab))
            hv = h * 1.08 * float(rng.uniform(0.8, 1.25))                     # +-25 % crown length variation
            rec = dict(name=name, side=side, kind=kind, c=c, up=up, e_lab=e_lab, e_md=e_md, w=w, h=hv, tl=tl,
                       ext=0.0, cuts=[], wear=0.0)
            if (side, name) in MISSING:
                sockets.append(rec)
                continue
            if (side, name) in RECEDED:
                rec["ext"] = 0.22         # tooth stands proud of the eroded bone
            # damage (local m, l, a frame; a = along root axis, crown below a=0)
            if (side, name) == (-1, "C"):
                rec["cuts"].append(((0.35, 0.25, -0.9), 0.62 * h))           # chipped cusp (facet)
            if (side, name) == (-1, "CI"):
                rec["cuts"].append(((0.62, 0.05, -0.78), 0.82))              # diagonal broken corner
            if (side, name) == (1, "M1"):
                rec["cuts"].append(((0.0, 0.70, -0.70), 0.42))               # buccal half of crown sheared
            if (side, name) == (1, "CI"):
                rec["cuts"].append(((-0.4, 0.3, -0.85), 0.92))               # small incisal chip
            if kind == "mol":
                rec["wear"] = 0.10 + float(rng.uniform(0, 0.08))
            teeth.append(rec)
    return teeth, sockets


TEETH, SOCKETS = _build_teeth()
ALV_PTS, ALV_R = [], []
for _s in np.linspace(0.0, 6.55, 10):
    _x, _y, _t, _o = arch_at(_s)
    f = _s / 6.55
    ALV_PTS.append((_x - 0.25 * _o[0], _y - 0.25 * _o[1], -4.15 + 0.22 * f))
    ALV_R.append(0.70 + 0.16 * f)


def tooth_frame(P, tk):
    D = P - tk["c"]
    return D @ tk["e_md"], D @ tk["e_lab"], D @ tk["up"]


def tooth_sdf(P, tk):
    m, l, a = tooth_frame(P, tk)
    a = a + F32(tk["ext"])
    w, h, tl, kind = tk["w"], tk["h"], tk["tl"], tk["kind"]
    L = np.stack([m, l, a], 1).astype(F32)
    if kind == "inc":
        q = S.box(L, (0, 0, -h / 2), (w / 2 * 0.94, tl, h / 2), None, 0.21)
        lim = -tl - 0.62 * tl * a / h                                  # chisel: thin incisal edge
        q = np.maximum(q, (lim - l) / F32(math.sqrt(1 + (0.62 * tl / h) ** 2)))
        q = np.maximum(q, np.abs(m) - (w / 2 * (0.78 + 0.22 * np.clip(-a / (0.45 * h), 0, 1))))  # neck
    elif kind == "can":
        q = S.box(L, (0, 0, -h / 2), (w / 2 * 0.95, tl, h / 2), None, 0.2)
        q = np.maximum(q, ((-h + 0.85 * np.abs(m)) - a) * F32(0.76))   # pointed cusp
        q = np.maximum(q, np.abs(m) - (w / 2 * (0.8 + 0.2 * np.clip(-a / (0.45 * h), 0, 1))))
    elif kind == "pm":
        q = S.box(L, (0, 0, -h / 2), (w / 2 * 0.95, tl, h / 2), None, 0.22)
        q = S.ssub(q, S.capsule(L, (-w, 0, -h - 0.02), (w, 0, -h - 0.02), 0.09), 0.05)
    else:
        q = S.box(L, (0, 0, -h / 2), (w / 2 * 0.96, tl, h / 2), None, 0.24)
        q = S.ssub(q, S.capsule(L, (-w, 0, -h - 0.02), (w, 0, -h - 0.02), 0.085), 0.05)
        q = S.ssub(q, S.capsule(L, (0, -tl * 1.3, -h - 0.02), (0, tl * 1.3, -h - 0.02), 0.08), 0.05)
    if tk["wear"]:
        q = np.maximum(q, -(a + F32(h - tk["wear"])))               # flat occlusal wear facet
    if kind == "mol":
        r0 = min(w, 2 * tl) * 0.24
        root = np.minimum(S.round_cone(L, (-w * 0.22, 0, -0.05), (-w * 0.3, 0, 1.4), r0, 0.1),
                          S.round_cone(L, (w * 0.22, 0, -0.05), (w * 0.3, 0, 1.4), r0, 0.1))
    else:
        root = S.round_cone(L, (0, 0, -0.05), (0, 0, 1.6), min(w / 2, tl) * 0.8, 0.11)
    q = S.smin(q, root, 0.08)
    for nloc, off in tk["cuts"]:
        nn = nrm(nloc)
        q = np.maximum(q, (L @ nn) - F32(off))                        # remove region L.n > off
    q = q + F32(0.025) * S.fbm(P * F32(4.0), 1.0, 2, seed=77)      # enamel wear irregularity
    return q


def teeth_h(Q):
    d = np.full(len(Q), 10.0, F32)
    for tk in TEETH:
        cm = tk["c"] + tk["up"] * F32(0.2)
        m = ball(Q, cm, 2.2)
        if m.any():
            d[m] = np.minimum(d[m], tooth_sdf(Q[m], tk))
    return d


def tooth_rot(tk):
    return np.stack([tk["e_md"], tk["e_lab"], tk["up"]], 1).astype(F32)


# ---- anatomy -------------------------------------------------------------------------------
def vault_h(Q):
    Qw = S.warp(Q, 0.30, 0.21, seed=11, octaves=2)
    Qf = fold(Qw)
    v = S.ellipsoid(Qw, (0, 1.0, 4.5), (6.7, 8.2, 7.3))
    v = S.smin(v, S.ellipsoid(Qw, (0, -2.7, 5.0), (5.6, 6.0, 6.2)), 1.5)        # frontal
    v = S.smin(v, S.ellipsoid(Qw, (0, 6.3, 2.6), (4.9, 3.2, 4.0)), 1.2)         # occipital bulge
    v = S.smin(v, S.ellipsoid(Qf, (5.2, 3.0, 7.3), (2.0, 3.2, 2.5)), 1.1)       # parietal eminences (house shape)
    v = S.smin(v, S.ellipsoid(Qw, (0, 8.6, 3.2), (2.4, 1.2, 1.6)), 1.0)         # occipital squama bulge
    v = S.smin(v, S.ellipsoid(Qf, (2.3, -6.9, 7.4), (2.0, 1.2, 1.8)), 1.2)      # frontal eminences
    v = S.smax(v, -(Qw[:, 2] + 2.9), 1.2)                                       # cranial base
    v = S.ssub(v, S.ellipsoid(Qf, (7.3, -2.4, 1.6), (2.7, 3.3, 3.4)), 1.2)      # temporal fossae
    v = S.ssub(v, S.ellipsoid(Qw, (0, 9.8, -4.0), (6.5, 4.2, 4.0)), 1.0)       # nuchal plane (less ball-like)
    tplane = np.maximum(F32(5.9) - Qf[:, 0], S.ellipsoid(Qf, (6.3, -2.0, 3.3), (2.6, 4.3, 3.6)))
    v = S.smax(v, -tplane, 0.75)                                               # flat temporal planes (soft edge)
    return v


def face_h(Q):
    Qf = fold(Q)
    f = S.ellipsoid(Q, (0, -8.55, 2.95), (1.2, 0.62, 0.85))                                   # glabella
    f = S.smin(f, S.polyline_tube(Qf, [(0.8, -8.7, 3.15), (2.8, -8.45, 3.55), (4.75, -7.5, 3.3)],
                                  [0.66, 0.64, 0.54]), 0.7)                                   # brow arches over each orbit
    f = S.smin(f, S.ellipsoid(Qf, (2.6, -8.2, 4.05), (1.9, 0.7, 1.05)), 0.8)                 # per-orbit forehead slope (dip at glabella)
    f = S.smin(f, S.polyline_tube(Qf, [(4.75, -7.5, 3.35), (5.25, -6.9, 1.9), (5.05, -6.6, -0.45)],
                                  [0.5, 0.52, 0.6]), 0.4)                                      # lateral rim
    f = S.smin(f, S.round_cone(Qf, (1.7, -8.35, -0.1), (4.8, -7.0, -0.35), 0.45, 0.58), 0.45)  # infraorbital
    f = S.smin(f, S.round_cone(Qf, (1.2, -8.45, 2.5), (1.6, -8.4, -0.1), 0.45, 0.45), 0.4)     # medial rim
    f = S.smin(f, S.round_cone(Q, (0, -8.4, 2.0), (0, -9.2, 0.3), 0.5, 0.38), 0.35)            # nasal bones
    f = S.smin(f, S.ellipsoid(Q, (0, -7.4, 0.6), (2.2, 1.3, 2.6)), 0.6)                        # nasal root
    f = S.smin(f, S.ellipsoid(Qf, (2.5, -6.9, -1.0), (2.2, 1.55, 1.75)), 0.8)                  # ant. maxilla
    f = S.smin(f, S.ellipsoid(Qf, (5.0, -6.2, -0.8), (1.4, 1.45, 1.35)), 0.5)                  # zygoma body
    f = S.smin(f, S.ellipsoid(Q, (0, -5.6, -2.6), (3.2, 3.3, 2.3)), 0.7)                       # maxilla body
    f = S.smin(f, S.ellipsoid(Q, (0, -8.0, -3.6), (1.9, 1.05, 1.3)), 0.6)                      # subnasal
    f = S.smin(f, S.round_cone(Qf, (4.4, -6.2, -1.4), (3.1, -5.6, -4.0), 0.6, 0.55), 0.6)      # key ridge
    f = S.smin(f, S.polyline_tube(Qf, ALV_PTS, ALV_R), 0.45)                                   # alveolar
    f = S.smin(f, S.ellipsoid(Q, (0, -3.0, -1.7), (2.4, 3.0, 1.9)), 0.8)                       # sphenoid
    f = S.smin(f, S.round_cone(Qf, (5.3, 2.0, -0.6), (5.0, 2.2, -2.5), 1.05, 0.62), 0.7)       # mastoid
    f = S.smin(f, S.ellipsoid(Qf, (5.7, 1.3, 0.25), (0.95, 1.7, 1.2)), 0.6)                    # ear root
    f = S.smin(f, S.polyline_tube(Qf, [(0, 9.15, 1.7), (2.6, 8.4, 1.4), (4.6, 6.9, 0.9)], [0.42, 0.33, 0.25]), 0.5)  # nuchal line
    f = S.smin(f, S.ellipsoid(Qf, (4.45, -5.9, 1.3), (0.8, 1.1, 2.0)), 0.6)                    # lateral orbit wall
    f = S.smin(f, S.polyline_tube(Qf, [(4.8, -7.1, 3.4), (5.35, -5.6, 4.6), (5.9, -3.0, 5.6), (6.3, 0.0, 6.0)],
                                  [0.42, 0.3, 0.2, 0.12]), 0.9)                               # temporal crest
    # alveolar juga: bone ridges over the roots of the front teeth
    for tk in TEETH:
        if tk["kind"] in ("mol", "pm") or tk["ext"] > 0:
            continue
        r = {"inc": 0.17, "can": 0.24}[tk["kind"]]
        a = tk["c"] + tk["up"] * F32(0.3) + tk["e_lab"] * F32(tk["tl"] * 0.55)
        b = tk["c"] + tk["up"] * F32(1.3) + tk["e_lab"] * F32(tk["tl"] * 0.35)
        m = seg_mask(Q, a, b, 1.2)
        if m.any():
            f[m] = S.smin(f[m], S.capsule(Q[m], a, b, r), 0.22)
    return f


def arch_tube(Q):
    """Zygomatic arches: flattened bars (1.7x taller than thick) standing off the temporal fossa."""
    Qs = fold(Q)
    Qs[:, 2] /= 1.7
    pts = [(5.65, -5.3, -0.8 / 1.7), (6.3, -3.3, -0.6 / 1.7), (6.32, -1.2, -0.45 / 1.7), (6.0, 0.5, -0.3 / 1.7)]
    return S.polyline_tube(Qs, pts, [0.34, 0.31, 0.31, 0.36])


def orbit_cav(Qs, side):
    """Orbit cavity in a mirrored (+x) frame. side -1 (camera side) sits higher, more oblique, larger."""
    hi = side < 0
    c = (3.1, -7.55, 1.62 + (0.26 if hi else 0.0))
    R = S.rot_matrix(0, 15.0 if hi else 10.0, 22.8)
    L = S.to_local(Qs, c, R)
    sz = 1.04 if hi else 1.0
    box = S.box(L, (0, 0.35, 0), (2.0 * sz, 0.75, 1.7 * sz), None, 0.95)
    ell = S.ellipsoid(L, (-0.15, 1.7, 0.3), (1.85 * sz, 1.45, 1.9 * sz))
    cone = S.round_cone(L, (-0.2, 1.6, 0.1), (-1.0, 4.8, 0.35), 1.45, 0.45)
    return S.smin(S.smin(box, ell, 0.5), cone, 0.6)


def anatomy(Q):
    """Returns (d_shell, d_outer, vault) before damage."""
    v = vault_h(Q)
    d = S.smin(v, face_h(Q), 0.7)
    d = S.smin(d, arch_tube(Q), 0.3)
    for side in (1, -1):
        m = (Q[:, 0] * side > 0) & ball(Q, (side * 3.1, -6.5, 1.6), 7.5)
        if m.any():
            Qs = Q[m].copy()
            Qs[:, 0] *= side
            d[m] = S.ssub(d[m], orbit_cav(Qs, side), 0.14)
    Qf = fold(Q)
    d = S.ssub(d, S.ellipsoid(Qf, (3.25, -8.05, 0.02), (1.3, 0.7, 0.3)), 0.25)             # worn lower rims
    nas = S.smin(S.ellipsoid(Qf, (0.6, -8.4, -1.95), (0.66, 1.5, 0.98)),
                 S.ellipsoid(Q, (0, -8.5, -0.85), (0.6, 1.5, 1.0)), 0.35)
    nas = S.smin(nas, S.ellipsoid(Q, (0, -5.6, -1.0), (1.25, 3.0, 1.9)), 0.5)
    d = S.ssub(d, nas, 0.12)
    d = np.minimum(d, S.box(Q, (0, -6.1, -1.0), (0.16, 1.5, 1.3), None, 0.06))               # septum
    d = S.smin(d, S.round_cone(Q, (0, -8.4, -2.95), (0, -9.3, -3.05), 0.2, 0.05), 0.12)       # nasal spine
    d = S.ssub(d, S.ellipsoid(Qf, (2.45, -8.75, -1.9), (0.8, 0.42, 0.7)), 0.4)               # canine fossa
    d = S.ssub(d, S.capsule(Qf, (6.8, 0.9, 0.05), (5.2, 0.9, 0.05), 0.42), 0.15)             # ear canal
    d = S.ssub(d, S.ellipsoid(Q, (0, 2.6, -2.7), (1.45, 1.75, 1.3)), 0.2)                     # foramen magnum
    for tk in SOCKETS:                                                                        # empty sockets
        cen = tk["c"] + tk["up"] * F32(0.25)
        m = ball(Q, cen, 2.0)
        if m.any():
            d[m] = S.ssub(d[m], S.ellipsoid(Q[m], cen, (tk["w"] / 2 * 0.8, tk["tl"] * 0.8, 0.6), tooth_rot(tk)), 0.12)
    for tk in TEETH:                                                                          # eroded alveolus
        if tk["ext"] > 0:
            cen = tk["c"] + tk["up"] * F32(0.35) + tk["e_lab"] * F32(tk["tl"] * 1.0)
            m = ball(Q, cen, 2.0)
            if m.any():
                d[m] = S.ssub(d[m], S.ellipsoid(Q[m], cen, (tk["w"] / 2 * 0.85, 0.32, 0.5), tooth_rot(tk)), 0.12)
    d_outer = d.copy()
    zfloor = F32(-1.9) + F32(5.9) * sstep(-0.5, -4.2, Q[:, 1])      # anterior cranial fossa sits ABOVE the orbits
    cav = np.maximum(v + F32(T_SHELL), -(Q[:, 2] - zfloor))
    d = np.maximum(d, -cav)                                                                    # hollow
    return d, d_outer, v


def outer_only(Q):
    return anatomy(Q)[1]


# ---- damage placement (computed once from the clean anatomy) ---------------------------------
def _vault_point(direction):
    return surf_hit(outer_only, C0, direction, 16.0)


def _surface_point(c, n):
    n = nrm(n)
    p = surf_hit(lambda P: -outer_only(P), np.asarray(c, F32) - 3.0 * n, n, 6.0)  # inside->outside of -d
    if p is None:
        return np.asarray(c, F32)
    return p


def _setup_damage():
    dmg = {}
    bdir = nrm((0.62, 0.30, 0.72))                      # upper LEFT parietal, slightly posterior
    B = _vault_point(bdir)
    n = grad(outer_only, B, 0.05)
    _, a, b = basis(n)
    dmg["B"], dmg["Bn"], dmg["Ba"], dmg["Bb"] = B, n, a, b
    sp = []
    rng = np.random.default_rng(5)
    for k in range(2):
        phi = 2.9 + k * 1.1 + rng.uniform(-0.25, 0.25)
        rho = 3.1 + rng.uniform(-0.2, 0.5)
        tgt = B + rho * (math.cos(phi) * a + math.sin(phi) * b)
        c = _vault_point(tgt - C0)
        cn = grad(outer_only, c, 0.05)
        sp.append(dict(c=c, n=cn, depth=float(rng.uniform(0.22, 0.4)),
                       radii=[float(rng.uniform(0.8, 1.4)) for _ in range(int(rng.integers(5, 7)))],
                       tilt=(float(rng.uniform(-0.2, 0.2)), float(rng.uniform(-0.2, 0.2))),
                       rot=float(rng.uniform(0, 6.28))))
    dmg["spalls"] = sp
    pieces = [dict(c=B, radii=[2.0, 2.4, 1.6, 2.3, 2.5, 1.7, 2.2, 1.9, 2.4], rot=0.4, seed=1)]
    for k in range(6):
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(1.3, 2.4)
        nk = int(rng.integers(4, 7))
        pieces.append(dict(c=B + dist * (math.cos(ang) * a + math.sin(ang) * b),
                           radii=[float(rng.uniform(0.7, 1.4)) for _ in range(nk)], rot=float(ang), seed=20 + k))
    dmg["breach_pieces"] = pieces
    rim = []
    for k in range(16):
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(2.4, 3.9)
        c = _vault_point(B + dist * (math.cos(ang) * a + math.sin(ang) * b) - C0)
        if c is None:
            continue
        nk = int(rng.integers(4, 6))
        rim.append(dict(c=c, n=grad(outer_only, c, 0.05), depth=float(rng.uniform(0.12, 0.32)),
                        radii=[float(rng.uniform(0.3, 0.75)) for _ in range(nk)], rot=float(rng.uniform(0, 6.3)),
                        seed=40 + k))
    dmg["rim_chips"] = rim
    cracks = []

    def add_vcrack(p0, p1, w0, D, warp, seed):
        o = _vault_point(p0 - C0)
        e = _vault_point(p1 - C0)
        if o is None or e is None:
            return None
        t = nrm(e - o)
        nc = nrm(np.cross(o - C0, t))
        L = float(np.linalg.norm(e - o)) * 1.05
        cracks.append(dict(o=o, t=t, nc=nc, L=L, w0=w0, D=D, warp=warp, seed=seed))
        return o, e
    angs = [12, 58, 112, 160, 205, 252, 300, 335]
    lens = [7.5, 5.0, 9.0, 6.0, 8.5, 4.5, 10.0, 5.5]
    for i, (ang, L) in enumerate(zip(angs, lens)):
        phi = math.radians(ang + rng.uniform(-8, 8))
        dirv = math.cos(phi) * a + math.sin(phi) * b
        res = add_vcrack(B + 2.4 * dirv, B + (2.4 + L) * dirv, 0.30, 1.2, 0.5, 100 + i)
        if res and i % 2 == 0:                                       # branch
            o, e = res
            mid = o + 0.45 * (e - o)
            br = math.radians(rng.choice([-1, 1]) * rng.uniform(28, 42))
            d2 = math.cos(phi + br) * a + math.sin(phi + br) * b
            add_vcrack(mid, mid + 0.42 * L * d2, 0.20, 0.5, 0.25, 200 + i)
    # long cracks elsewhere
    add_vcrack(np.array([-3.2, -2.8, 10.9]), np.array([-4.5, -7.3, 5.4]), 0.20, 0.45, 0.4, 301)    # frontal (lateral)
    add_vcrack(np.array([-1.2, 2.5, 11.8]), np.array([-6.6, 3.6, 3.6]), 0.20, 0.45, 0.35, 302)     # R parietal
    add_vcrack(np.array([2.6, 8.6, 6.5]), np.array([4.6, 6.6, 0.6]), 0.20, 0.45, 0.3, 303)          # occipital
    add_vcrack(np.array([-3.5, 7.8, 7.5]), np.array([-5.8, 5.6, 1.8]), 0.18, 0.4, 0.4, 304)         # back right
    add_vcrack(np.array([1.2, 9.0, 6.2]), np.array([-1.5, 9.4, 2.0]), 0.18, 0.4, 0.4, 305)          # occipital 2
    dmg["cracks"] = cracks
    # face cracks (o, t, plane normal given directly)
    fc = []
    o = _surface_point((-2.5, -8.3, -3.9), (0, -1, 0))
    e = _surface_point((-3.3, -8.0, -0.4), (0, -1, 0))
    t = nrm(e - o)
    fc.append(dict(o=o, t=t, nc=nrm(np.cross((0, -1, 0), t)), L=float(np.linalg.norm(e - o)) * 1.1,
                   w0=0.18, D=0.4, warp=0.2, seed=401))
    o = _surface_point((5.6, -6.2, -1.3), (1, -0.5, 0))
    e = _surface_point((4.9, -7.2, 1.5), (1, -0.6, 0.3))
    t = nrm(e - o)
    fc.append(dict(o=o, t=t, nc=nrm(np.cross((0.8, -0.6, 0), t)), L=float(np.linalg.norm(e - o)) * 1.1,
                   w0=0.16, D=0.4, warp=0.15, seed=402))
    dmg["fcracks"] = fc
    # chips: (approx surface point, outward normal, depth, radii, bevel)
    chips = [((3.6, -7.3, 4.1), (0.2, -0.45, 0.85), 0.24, [1.0, 1.3, 0.9, 1.2, 1.1], 32),     # L brow top
             ((-4.9, -7.1, 2.6), (-0.6, -0.55, 0.5), 0.28, [0.7, 0.9, 0.8, 0.6, 0.9], 30),     # R orbit rim
             ((0.12, -9.2, 0.35), (0.1, -0.6, -0.8), 0.32, [0.55, 0.7, 0.5, 0.65], 25),        # nasal bones
             ((-2.0, 9.2, 4.5), (-0.25, 1.0, 0.1), 0.34, [1.6, 1.9, 1.4, 1.7, 1.5, 1.8], 35),  # occipital
             ((5.6, -6.5, -1.9), (0.5, -0.5, -0.7), 0.38, [0.8, 1.0, 0.7, 0.9], 30),           # L zygoma
             ((-6.4, 3.4, 6.6), (-0.9, 0.15, 0.4), 0.24, [2.0, 1.7, 2.2, 1.8, 1.9], 40),       # R parietal
             ((-4.6, 6.6, 6.2), (-0.6, 0.7, 0.4), 0.2, [2.4, 2.0, 2.6, 2.1, 2.3, 2.2], 42),    # back scar 1
             ((-4.2, 7.4, 4.6), (-0.5, 0.85, 0.15), 0.34, [1.3, 1.1, 1.5, 1.2, 1.4], 36),       # back scar 2
             ((2.8, 8.4, 5.6), (0.35, 0.95, 0.2), 0.22, [1.5, 1.8, 1.3, 1.6], 38),              # occ. spall
             ((-1.5, 8.6, 7.5), (-0.15, 0.8, 0.6), 0.16, [2.2, 1.8, 2.5, 2.0, 2.3], 45),        # back terrace
             ((3.6, 7.0, 7.8), (0.45, 0.65, 0.6), 0.18, [1.8, 2.1, 1.6, 1.9, 2.0], 44),         # back terrace
             ((0.6, 9.5, 2.6), (0.05, 1.0, -0.1), 0.2, [1.4, 1.7, 1.3, 1.6], 40),               # occiput flake
             ((1.6, -8.3, -4.6), (0.2, -0.9, -0.3), 0.3, [0.7, 0.8, 0.6, 0.75], 30)]           # alveolar
    dmg["chips"] = []
    for i, (c, nn, dep, radii, bev) in enumerate(chips):
        p = _surface_point(c, nn)
        dmg["chips"].append(dict(c=p, n=nrm(nn), depth=dep, radii=radii, bevel=bev, seed=500 + i))
    # broken right zygomatic arch (camera side)
    p = _surface_point((-6.45, -3.7, -0.6), (-1, 0, 0))
    dmg["arch_break"] = dict(c=p, n=nrm((-1, 0.05, 0)), depth=1.3, radii=[0.95, 1.2, 0.85, 1.1, 1.0], bevel=4,
                             seed=600)
    return dmg


DMG = None


def skull_h(Q, Pw=None, detail=True):
    d, d_outer, v = anatomy(Q)
    if not detail:
        return d, d_outer
    g = DMG

    def cut(mask, R):
        if mask.any():
            d[mask] = np.maximum(d[mask], -R)
            d_outer[mask] = np.maximum(d_outer[mask], -R)

    B, n, a, b = g["B"], g["Bn"], g["Ba"], g["Bb"]
    m = ball(Q, B, 7.5)
    if m.any():
        Qm = Q[m]
        R = None
        for pc in g["breach_pieces"]:
            Rp = flake(Qm, pc["c"], n, 3.2, pc["radii"], bevel=-16, rot=pc["rot"], rough=0.2, seed=pc["seed"],
                       rough_f=2.1)
            R = Rp if R is None else np.minimum(R, Rp)
        cut(m, R)
    for rc in g["rim_chips"]:
        m = ball(Q, rc["c"], max(rc["radii"]) + 0.8)
        if m.any():
            cut(m, flake(Q[m], rc["c"], rc["n"], rc["depth"], rc["radii"], bevel=40, rot=rc["rot"], rough=0.03,
                         seed=rc["seed"]))
    for i, sp in enumerate(g["spalls"]):
        m = ball(Q, sp["c"], 3.0)
        if m.any():
            cut(m, flake(Q[m], sp["c"], sp["n"], sp["depth"], sp["radii"], bevel=35, tilt=sp["tilt"],
                         rot=sp["rot"], rough=0.05, seed=10 + i))
    for ch in g["chips"]:
        r = max(ch["radii"]) + 1.0
        m = ball(Q, ch["c"], r)
        if m.any():
            cut(m, flake(Q[m], ch["c"], ch["n"], ch["depth"], ch["radii"], bevel=ch["bevel"], rough=0.05,
                         seed=ch["seed"]))
    ab = g["arch_break"]
    m = ball(Q, ab["c"], 2.4)
    if m.any():
        cut(m, flake(Q[m], ab["c"], ab["n"], ab["depth"], ab["radii"], bevel=ab["bevel"], rot=0.25, rough=0.06,
                     seed=ab["seed"]))
    for ck in g["cracks"] + g["fcracks"]:
        e = ck["o"] + ck["t"] * F32(ck["L"])
        m = seg_mask(Q, ck["o"], e, 0.32 * ck["L"] + 1.2)
        if m.any():
            R = crack(Q[m], ck["o"], ck["t"], ck["nc"], ck["L"], ck["w0"], ck["D"], d_outer[m],
                      warp=ck["warp"], wf=1.0, seed=ck["seed"])
            d[m] = np.maximum(d[m], -R)
            d_outer[m] = np.maximum(d_outer[m], -R)
    # sutures: zig-zag grooves 0.16 cm (~2.5 cm at scale) wide
    vz = Q[:, 2] > 3.0
    if vz.any():
        Qv = Q[vz]
        do = d_outer[vz]
        x, y, z = Qv[:, 0], Qv[:, 1], Qv[:, 2]
        zz = S.fbm(Qv * F32(1.3), 1.0, 2, seed=61)
        dep = np.clip(1.0 + do / F32(0.16), 0, 1)
        hw = F32(0.085) * dep
        sag = np.abs(x + 0.14 * np.sin(y * 6.5) + 0.12 * zz) - hw
        sag = np.maximum(sag, np.maximum(-(y + 0.6), y - 7.3))
        sag = np.maximum(sag, -(z - 7.0))
        cor = np.abs((y + 0.6) - 0.42 * (z - 11.7) + 0.15 * np.sin(x * 6.0) + 0.12 * zz) - hw
        cor = np.maximum(cor, -(z - 3.8))
        xl = np.abs(x)
        lam = np.abs(-0.629 * xl + 0.517 * (y - 7.2) - 0.582 * (z - 8.4) + 0.14 * np.sin(z * 6.0) + 0.12 * zz) - hw
        lam = np.maximum(lam, np.maximum(-(y - 3.5), -(z - 0.8)))
        R = np.minimum(np.minimum(sag, cor), lam)
        d[vz] = np.maximum(d[vz], -R)
        d_outer[vz] = np.maximum(d_outer[vz], -R)
    # weathering: low-frequency undulation, fine ridged erosion, pitting, vertical rain runnels
    e = F32(0.10) * S.fbm(Q * F32(0.45), 1.0, 2, seed=71)
    e += F32(0.13) * S.fbm(Q * F32(0.85), 1.0, 2, seed=76) * sstep(2.0, 5.5, Q[:, 1])      # weathered back
    e += F32(0.055) * (S.ridged(Q * F32(1.25), 1.0, 3, seed=72) - F32(0.5))
    pit = S.fbm(Q * F32(2.7), 1.0, 2, seed=73)
    e += F32(0.09) * np.clip((pit - 0.30) / 0.25, 0, 1)
    if Pw is not None:
        Rn = S.ridged(Pw * np.array([1 / 0.09, 1 / 0.09, 1 / 0.7], F32), 1.0, 2, seed=74)
        upw = np.clip((Q[:, 2] - 3.5) / 3.0, 0, 1)
        e += F32(0.10) * sstep(0.80, 0.96, Rn) * upw
    d = d + e
    return d, d_outer + e


# =============================================================================================
# pose, world fields
# =============================================================================================
POSE_R = S.rot_matrix(PITCH, ROLL, 0.0)
POSE_T = np.zeros(3, F32)
TOOTH_Z = 0.03          # incisal edges just touch the rubble
ZCUT = -0.12


def to_h(Pw):
    return (S.to_local(Pw, POSE_T, POSE_R) / F32(SC)).astype(F32)


def h_to_w(Q):
    return (np.asarray(Q, F32) * F32(SC)) @ POSE_R.T + POSE_T


def _setup_pose():
    global POSE_T
    g = np.arange(-8.0, 8.01, 0.4, dtype=F32)
    gy = np.arange(-10.5, 10.51, 0.4, dtype=F32)
    gz = np.arange(-7.0, 12.51, 0.4, dtype=F32)
    P = np.stack(np.meshgrid(g, gy, gz, indexing='ij'), -1).reshape(-1, 3)
    ins = P[outer_only(P) < 0]
    W = (ins * F32(SC)) @ POSE_R.T
    tips = []
    for tk in TEETH:
        tips.append(tk["c"] - tk["up"] * F32(tk["h"] - tk["ext"]))
    tipsW = (np.array(tips, F32) * F32(SC)) @ POSE_R.T
    cx = 0.5 * (W[:, 0].min() + W[:, 0].max())
    cy = 0.5 * (W[:, 1].min() + W[:, 1].max())
    POSE_T = np.array([-cx, -cy, TOOTH_Z - tipsW[:, 2].min()], F32)
    log("pose T", POSE_T, "skull world bbox", (W.min(0) + POSE_T).round(2), (W.max(0) + POSE_T).round(2))


# ---- rubble heightfield (asset frame, metres) ------------------------------------------------
MAND_XY = np.array([-2.5, 1.7], F32)        # half-mandible: beside/behind the left flank (not a "denture strip" in front)


def ground_h(x, y):
    x = np.asarray(x, F32)
    y = np.asarray(y, F32)
    r2 = x * x + y * y
    h = 0.26 * np.exp(-r2 / 3.3 ** 2)
    h -= 0.30 * np.exp(-((x / 1.25) ** 2 + ((y + 1.35) / 0.85) ** 2))      # scoop under the face
    h += 0.72 * np.exp(-((x / 1.3) ** 2 + ((y - 0.9) / 1.5) ** 2)) * sstep(-1.0, 0.4, y)
    h += 0.16 * np.exp(-(((x - MAND_XY[0]) / 1.25) ** 2 + ((y - MAND_XY[1]) / 1.0) ** 2))
    h += 0.24 * np.exp(-(((np.abs(x) - 1.05) / 0.45) ** 2 + ((y - 0.2) / 0.6) ** 2))         # bury the mastoids
    P2 = np.stack([x * 0.55, y * 0.55, np.zeros_like(x)], 1).astype(F32)
    h += 0.08 * S.fbm(P2, 1.0, 3, seed=41)
    h += 0.035 * (S.ridged(P2 * 3.0, 1.0, 2, seed=43) - 0.5)
    h -= 0.40 * sstep(3.8, 5.3, np.sqrt(r2))
    return h.astype(F32)


def skull_world(Pw):
    Q = to_h(Pw)
    d, d_outer = skull_h(Q, Pw, detail=True)
    d = d * F32(SC)
    d_outer = d_outer * F32(SC)
    # sediment flare: skull blends into the ground just below the rubble surface (outside the skull only)
    near = (Pw[:, 2] < 1.6)
    if near.any():
        Pn = Pw[near]
        gfield = Pn[:, 2] - (ground_h(Pn[:, 0], Pn[:, 1]) - F32(0.035))
        gfield = np.maximum(gfield, np.maximum(d_outer[near] - F32(0.32), -d_outer[near]))
        d[near] = S.smin(d[near], gfield, 0.22)
    return np.maximum(d, -(Pw[:, 2] - F32(ZCUT)))


def skull_outer_world(Pw):
    return outer_only(to_h(Pw)) * F32(SC)


def teeth_world(Pw):
    return teeth_h(to_h(Pw)) * F32(SC)


# ---- half mandible (own human frame, origin = menton) ----------------------------------------
LOW = [("CI", 0.54, 0.90, 0.30, "inc", 3.05), ("LI", 0.60, 0.92, 0.31, "inc", 3.0),
       ("C", 0.70, 1.05, 0.40, "can", 2.98), ("PM1", 0.70, 0.85, 0.42, "pm", 2.9),
       ("PM2", 0.72, 0.82, 0.43, "pm", 2.85), ("M1", 1.12, 0.75, 0.52, "mol", 2.78),
       ("M2", 1.05, 0.72, 0.5, "mol", 2.72), ("M3", 1.0, 0.66, 0.48, "mol", 2.66)]
_lx = np.linspace(0, 3.6, 6000)
_ly = 0.25 + 0.5 * _lx ** 2
_ls = np.concatenate([[0], np.cumsum(np.hypot(np.diff(_lx), np.diff(_ly)))])


def low_arch(s):
    x = float(np.interp(s, _ls, _lx))
    y = 0.25 + 0.5 * x * x
    t = nrm((1.0, x, 0.0))
    return x, y, t, nrm((t[1], -t[0], 0.0))


def _build_low_teeth():
    rng = np.random.default_rng(99)
    out = []
    s = 0.0
    for name, w, h, tl, kind, cz in LOW:
        sc = s + w / 2
        s += w + 0.035
        if name in ("PM2", "M3"):
            continue                               # missing
        x, y, t, o = low_arch(sc)
        c = np.array([x, y, cz + float(rng.uniform(-0.06, 0.06))], F32)
        a = math.radians(TILT[kind] * 0.7 + float(rng.uniform(-3, 3)))
        up = nrm(-math.cos(a) * np.array([0, 0, 1.0]) - math.sin(a) * o)   # root points DOWN
        e_lab = nrm(o - (o @ up) * up)
        e_md = nrm(np.cross(up, e_lab))
        tk = dict(name=name, side=1, kind=kind, c=c, up=up, e_lab=e_lab, e_md=e_md, w=w, h=h, tl=tl, ext=0.0,
                  cuts=[], wear=0.12 if kind == "mol" else 0.0)
        if name == "C":
            tk["cuts"].append(((0.4, 0.3, -0.86), 0.65 * h))
        if name == "CI":
            tk["cuts"].append(((-0.75, 0.0, -0.66), 0.40))           # broken at the fracture edge
        out.append(tk)
    return out


LOW_TEETH = _build_low_teeth()
MAND_BASE = [(0, 0.05), (1.1, 0.35), (2.1, 1.05), (3.0, 2.1), (3.75, 3.4), (4.3, 4.9), (4.65, 6.3), (4.8, 7.3)]


def mand_h(Q):
    Qf = fold(Q)
    nb = len(MAND_BASE)
    base = [(x, y, 0.55 + 0.4 * i / (nb - 1)) for i, (x, y) in enumerate(MAND_BASE)]
    rb = [0.74 - 0.12 * i / (nb - 1) for i in range(nb)]
    alv = []
    for s in np.linspace(0, 6.3, 8):
        x, y, t, o = low_arch(s)
        alv.append((x, y, 2.45 - 0.2 * s / 6.3))
    alv.append((3.75, 5.9, 2.5))
    ra = [0.52] * 8 + [0.5]
    mid = [((bx + ax) / 2, (by + ay) / 2, 1.55) for (bx, by, _), (ax, ay, _) in zip(base, alv[:nb])]
    d = S.polyline_tube(Qf, base, rb)
    d = S.smin(d, S.polyline_tube(Qf, alv, ra), 0.9)
    d = S.smin(d, S.polyline_tube(Qf, mid, [0.62] * nb), 0.6)
    d = S.smin(d, S.ellipsoid(Q, (0, -0.1, 0.85), (1.5, 0.55, 0.85)), 0.5)               # chin
    d = S.smin(d, S.ellipsoid(Qf, (1.1, -0.05, 0.55), (0.55, 0.4, 0.4)), 0.3)            # mental tubercle
    # ramus
    d = S.smin(d, S.box(Qf, (4.75, 6.9, 3.6), (0.28, 1.45, 2.4), S.rot_matrix(-10, 0, 6), 0.25), 0.5)
    d = S.smin(d, S.round_cone(Qf, (4.85, 7.6, 0.9), (5.05, 8.1, 5.6), 0.5, 0.42), 0.4)
    d = S.smin(d, S.round_cone(Qf, (4.4, 5.0, 2.4), (4.55, 5.8, 6.3), 0.42, 0.12), 0.35)
    d = S.smin(d, S.ellipsoid(Qf, (5.05, 8.1, 6.0), (1.0, 0.5, 0.42), S.rot_matrix(0, 0, 15)), 0.3)   # condyle
    d = S.smin(d, S.ellipsoid(Qf, (4.85, 7.35, 1.0), (0.45, 0.9, 0.8)), 0.4)                       # gonion
    d = S.ssub(d, S.ellipsoid(Qf, (4.75, 7.0, 6.45), (0.95, 0.95, 0.95)), 0.2)                     # notch
    d = S.ssub(d, S.ellipsoid(Qf, (4.0, 6.6, 3.6), (0.5, 1.0, 1.4)), 0.4)                          # masseteric
    # break across the symphysis (keep the skull-left half, x > ~-0.35)
    cutx = -0.35 + 0.18 * (Q[:, 2] - 1.5) + 0.10 * S.fbm(Q * F32(1.4), 1.0, 2, seed=81)
    d = np.maximum(d, cutx - Q[:, 0])
    # teeth
    for tk in LOW_TEETH:
        m = ball(Q, tk["c"], 2.2)
        if m.any():
            d[m] = np.minimum(d[m], tooth_sdf(Q[m], tk))
    # sockets of the missing lower teeth
    s = 0.0
    for name, w, h, tl, kind, cz in LOW:
        sc = s + w / 2
        s += w + 0.035
        if name in ("PM2", "M3"):
            x, y, t, o = low_arch(sc)
            d = S.ssub(d, S.ellipsoid(Q, (x, y, cz - 0.25), (w / 2 * 0.8, tl * 0.8, 0.6)), 0.12)
    # damage: coronoid tip snapped, chin chip, body crack, weathering
    d = np.maximum(d, -flake(Q, (4.55, 5.85, 5.9), (0, 0, 1), 0.7, [0.9, 1.1, 0.8, 1.0], bevel=10, tilt=(0.3, -0.2),
                             rough=0.04, seed=82))
    d = np.maximum(d, -flake(Q, (0.6, -0.55, 0.9), (0.2, -1, -0.2), 0.3, [0.8, 0.9, 0.7, 0.85], bevel=30,
                             rough=0.04, seed=83))
    do = d.copy()
    d = np.maximum(d, -crack(Q, (2.2, 0.6, 2.6), nrm((0.4, 0.1, -1.0)), nrm((0.85, -0.5, 0.2)), 3.2, 0.24, 0.7, do,
                             warp=0.2, seed=84))
    d = d + F32(0.05) * (S.ridged(Q * F32(1.3), 1.0, 3, seed=85) - F32(0.5)) \
        + F32(0.07) * np.clip((S.fbm(Q * F32(2.6), 1.0, 2, seed=86) - 0.3) / 0.25, 0, 1)
    return d


MAND_PIVOT = np.array([2.6, 4.0, 2.0], F32)
_lat = nrm((0.84, -0.55, 0.0))
MAND_R = (S.rot_matrix(0, 0, -80.0) @ axis_angle((0.55, 0.84, 0.0), -78.0)).astype(F32)   # teeth face away
MAND_T = np.zeros(3, F32)


def _setup_mandible():
    global MAND_T
    g = np.arange(-1.5, 6.6, 0.3, dtype=F32)
    gy = np.arange(-1.5, 9.6, 0.3, dtype=F32)
    gz = np.arange(-0.5, 7.6, 0.3, dtype=F32)
    P = np.stack(np.meshgrid(g, gy, gz, indexing='ij'), -1).reshape(-1, 3)
    ins = P[mand_h(P) < 0]
    W = ((ins - MAND_PIVOT) * F32(SC)) @ MAND_R.T
    zmin = W[:, 2].min()
    gz0 = float(ground_h(MAND_XY[0:1], MAND_XY[1:2])[0])
    thick = W[:, 2].max() - zmin
    MAND_T = np.array([MAND_XY[0], MAND_XY[1], gz0 - zmin - 0.50 * thick], F32)
    log("mandible thick", round(float(thick), 2), "T", MAND_T)


def mand_to_h(Pw):
    return ((Pw - MAND_T) @ MAND_R) / F32(SC) + MAND_PIVOT


def mand_world(Pw):
    d = mand_h(mand_to_h(Pw)) * F32(SC)
    gfield = Pw[:, 2] - (ground_h(Pw[:, 0], Pw[:, 1]) - F32(0.03))
    gfield = np.maximum(gfield, np.maximum(d - F32(0.18), -d))
    d = S.smin(d, gfield, 0.1)
    return np.maximum(d, -(Pw[:, 2] - F32(ZCUT)))


def mand_outer_world(Pw):
    return mand_h(mand_to_h(Pw)) * F32(SC)


# ---- rubble apron ----------------------------------------------------------------------------
def _build_rocks():
    rng = np.random.default_rng(2024)
    rocks = []
    tries = 0
    while len(rocks) < 110 and tries < 3000:
        tries += 1
        th = rng.uniform(0, 2 * math.pi)
        e = 1.05 + 2.2 * rng.uniform(0, 1) ** 1.6
        x, y = 1.15 * e * math.cos(th), 1.6 * e * math.sin(th)
        if x * x + y * y > 4.9 ** 2:
            continue
        s = 0.05 + 0.32 * rng.uniform(0, 1) ** 2.2 * (1.2 if e < 1.5 else 0.8)
        if y < -0.9 and abs(x) < 1.5:
            s = min(s, 0.10)
        n = int(rng.integers(7, 10))
        N = rng.normal(size=(n, 3))
        N = np.concatenate([N, np.eye(3), -np.eye(3)])
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        N[:, 2] *= 0.8
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        off = s * rng.uniform(0.65, 1.1, n + 6)
        flat = rng.uniform(0.45, 0.9)
        rocks.append(dict(xy=(x, y), s=s, N=N.astype(F32), off=off.astype(F32), flat=flat,
                          sink=float(rng.uniform(-0.25, 0.25))))
    # heaved slabs leaning against the skull base (compression ring of the impact)
    for k in range(7):
        th = 2 * math.pi * k / 7 + rng.uniform(-0.25, 0.25)
        x, y = 1.35 * math.cos(th), 1.75 * math.sin(th)
        if y < -1.2:
            continue
        s = rng.uniform(0.28, 0.45)
        tilt = nrm((math.cos(th), math.sin(th), rng.uniform(1.2, 2.2)))
        Nl = [tilt, -tilt]
        _, a, b = basis(tilt)
        for j in range(6):
            ang = 2 * math.pi * j / 6 + rng.uniform(-0.3, 0.3)
            Nl.append(nrm(math.cos(ang) * a + math.sin(ang) * b))
        off = np.array([0.07, 0.07] + [s * rng.uniform(0.8, 1.2) for _ in range(6)], F32)
        rocks.append(dict(xy=(x, y), s=s, N=np.array(Nl, F32), off=off, flat=1.0, sink=0.1))
    for r in rocks:
        x, y = r["xy"]
        r["c"] = np.array([x, y, float(ground_h(np.array([x], F32), np.array([y], F32))[0])
                           + r["s"] * r["flat"] * r["sink"]], F32)
    return rocks


ROCKS = None
SHARDS = [((1.65, 1.05), 0.42, 0.15, 11), ((1.95, 0.05), 0.30, 0.12, 12), ((1.25, 1.95), 0.26, 0.11, 13),
          ((2.3, 0.85), 0.2, 0.09, 14)]


def shard(P, cxy, size, th, seed):
    rng = np.random.default_rng(seed)
    c = np.array([cxy[0], cxy[1], float(ground_h(np.array([cxy[0]], F32), np.array([cxy[1]], F32))[0]) + th * 0.25],
                 F32)
    R = S.rot_matrix(rng.uniform(-25, 25), rng.uniform(-25, 25), rng.uniform(0, 360))
    q = S.to_local(P, c, R)
    curv = 3.0
    shell = np.abs(np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2 + (q[:, 2] + curv) ** 2) - curv) - th / 2
    k = 6
    for i in range(k):
        ang = 2 * math.pi * i / k + rng.uniform(-0.3, 0.3)
        shell = np.maximum(shell, q[:, 0] * math.cos(ang) + q[:, 1] * math.sin(ang) - size * rng.uniform(0.7, 1.1))
    return shell


def rubble_world(Pw, part="all"):
    x, y, z = Pw[:, 0], Pw[:, 1], Pw[:, 2]
    h = ground_h(x, y)
    d = (z - h) * F32(0.8)
    if part in ("all", "rock"):
        for r in ROCKS:
            m = ball(Pw, r["c"], r["s"] * 1.6 + 0.05)
            if not m.any():
                continue
            q = Pw[m] - r["c"]
            q[:, 2] /= F32(r["flat"])
            dr = np.max(q @ r["N"].T - r["off"][None, :], axis=1)
            dr = np.maximum(dr, S.length(q) - F32(1.7 * r["s"])) * F32(r["flat"])
            d[m] = np.minimum(d[m], dr)
    dfr = np.full(len(Pw), 10.0, F32)
    for (cxy, size, th, seed) in SHARDS:
        m = ball(Pw, (cxy[0], cxy[1], 0.6), size * 1.6 + 0.8)
        if m.any():
            dfr[m] = np.minimum(dfr[m], shard(Pw[m], cxy, size, th, seed))
    d = np.minimum(d, dfr)
    d = d + F32(0.012) * (S.ridged(Pw * F32(4.0), 1.0, 2, seed=91) - F32(0.5))
    # exclude the skull and mandible volumes (rubble wraps them, never coats them)
    ms = (z < 1.7) & ((x / 1.7) ** 2 + (y / 2.1) ** 2 < 1.0)
    if ms.any():
        d[ms] = np.maximum(d[ms], -(skull_outer_world(Pw[ms]) + F32(0.03)))
    mm = ball(Pw, MAND_T, 1.6)
    if mm.any():
        d[mm] = np.maximum(d[mm], -(mand_outer_world(Pw[mm]) + F32(0.02)))
    d = np.maximum(d, -(z + F32(0.25)))
    if part == "frag":
        return dfr
    return d


# =============================================================================================
# Blender build
# =============================================================================================
def build():
    import bpy
    import cf_materials as M
    import cf_render as R
    global DMG, ROCKS
    log("setup damage / pose")
    DMG = _setup_damage()
    _setup_pose()
    _setup_mandible()
    ROCKS = _build_rocks()

    R.reset_scene()
    col = bpy.data.collections.new(ASSET)
    bpy.context.scene.collection.children.link(col)
    mat_bone = M.get("BoneStone")        # library defaults (surface agent owns moss/value tuning)
    mat_basalt = M.get("Basalt")

    vs = 1.6 if FAST else 1.0
    # --- skull bbox from the pose
    g = np.arange(-8.0, 8.01, 0.4, dtype=F32)
    P = np.stack(np.meshgrid(g, np.arange(-10.5, 10.51, 0.4, dtype=F32), np.arange(-7, 12.51, 0.4, dtype=F32),
                             indexing='ij'), -1).reshape(-1, 3)
    W = h_to_w(P[outer_only(P) < 0])
    bmin = W.min(0) - 0.36
    bmax = W.max(0) + 0.12
    bmax[0] += 0.24
    bmax[1] += 0.24
    bmin[2] = ZCUT - 0.02
    v, q = mesh_narrow(skull_world, bmin, bmax, 0.015 * vs, label="skull")
    sk = S.to_blender_mesh(ASSET, v, q, collection=col)
    del v, q
    decimate(sk, 104000 if not FAST else 60000)

    tips = np.array([h_to_w(tk["c"] - tk["up"] * F32(tk["h"])) for tk in TEETH], F32)
    roots = np.array([h_to_w(tk["c"] + tk["up"] * F32(1.6)) for tk in TEETH], F32)
    allp = np.concatenate([tips, roots])
    v, q = mesh_narrow(teeth_world, allp.min(0) - 0.12, allp.max(0) + 0.12, 0.0055 * vs, label="teeth")
    th = S.to_blender_mesh(ASSET + "_Teeth", v, q, collection=col)
    decimate(th, 16000 if not FAST else 9000)
    sk = join([sk, th])

    # --- mandible
    gm = np.stack(np.meshgrid(np.arange(-1.5, 6.6, 0.3, dtype=F32), np.arange(-1.5, 9.6, 0.3, dtype=F32),
                              np.arange(-0.5, 7.6, 0.3, dtype=F32), indexing='ij'), -1).reshape(-1, 3)
    Wm = ((gm[mand_h(gm) < 0] - MAND_PIVOT) * F32(SC)) @ MAND_R.T + MAND_T
    mmin = Wm.min(0) - 0.22
    mmax = Wm.max(0) + 0.1
    mmin[2] = ZCUT - 0.02
    v, q = mesh_narrow(mand_world, mmin, mmax, 0.009 * vs, label="mandible")
    md = S.to_blender_mesh(ASSET + "_Mandible", v, q, collection=col)
    decimate(md, 24000 if not FAST else 12000)

    # --- rubble apron
    v, q = mesh_narrow(rubble_world, (-5.5, -5.5, -0.3), (5.5, 5.5, 1.75), 0.03 * vs, label="rubble")
    rb = S.to_blender_mesh(ASSET + "_Rubble", v, q, collection=col)
    decimate(rb, 34000 if not FAST else 20000)

    # --- materials
    for o in (sk, md):
        o.data.materials.clear()
        o.data.materials.append(mat_bone)
    rb.data.materials.clear()
    rb.data.materials.append(mat_basalt)
    rb.data.materials.append(mat_bone)
    cen = np.empty(len(rb.data.polygons) * 3, F32)
    rb.data.polygons.foreach_get("center", cen)
    cen = cen.reshape(-1, 3)
    idx = (rubble_world(cen, part="frag") < 0.03).astype(np.int32)
    rb.data.polygons.foreach_set("material_index", idx)
    for o in (sk, md, rb):
        try:
            M.bake_curvature(o)
        except Exception as e:  # pragma: no cover
            log("curvature bake failed", o.name, e)
        o.data.shade_smooth()
        try:
            o.data.set_sharp_from_angle(angle=math.radians(52))
        except Exception as e:  # pragma: no cover
            log("sharp-from-angle unavailable:", e)
    # mandible origin -> its own ground-contact centre
    from mathutils import Matrix, Vector
    mn, mx = R.bounds([md])
    oc = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, max(mn.z, 0.0)))
    md.data.transform(Matrix.Translation(-oc))
    md.location = oc
    bpy.context.view_layer.update()

    info = save_asset([sk, md, rb])
    if not NO_RENDER:
        render_all(sk, md, rb, info)
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


def join(objs):
    import bpy
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    return objs[0]


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
    mn, mx = R.bounds([objs[0]])
    info["skull_bounds"] = ([round(v, 3) for v in mn], [round(v, 3) for v in mx])
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    os.makedirs(os.path.join(ASSET_DIR, "src"), exist_ok=True)
    shutil.copy(os.path.abspath(__file__), os.path.join(ASSET_DIR, "src", f"hero_skull_v{ver:03d}.py"))
    log("saved", path)
    info["breach_world"] = [round(float(v), 3) for v in h_to_w(DMG["B"])]
    return info


# ---- placements -------------------------------------------------------------------------------
RESEARCH = dict(centre=(-2.8, 9.5, 1.0), yaw=33.0)      # 33 deg toward the board (research 25-35); face ~18 deg off camera
CODEX = dict(origin=(-3.34, 7.13, -0.32), yaw=42.0)     # Codex pass12 foot point; face ~20 deg off its 20 mm camera axis


def placements(info, mode):
    yaw = RESEARCH["yaw"] if mode == "research" else CODEX["yaw"]
    cz = math.radians(yaw)
    Rz = np.array([[math.cos(cz), -math.sin(cz), 0], [math.sin(cz), math.cos(cz), 0], [0, 0, 1]])
    mn, mx = info["skull_bounds"]
    if mode == "research":
        cen = np.array([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2])
        L = np.array(RESEARCH["centre"]) - Rz @ cen
    else:
        L = np.array(CODEX["origin"], float)
    out = []
    for ob in info["objects"]:
        o = np.array(ob["origin"])
        loc = L + Rz @ o
        out.append(dict(source=ob["name"], name=ob["name"], location=[round(float(v), 4) for v in loc],
                        rotation_deg=[0.0, 0.0, yaw], scale=[1, 1, 1]))
    return out


def render_all(sk, md, rb, info):
    import bpy
    import cf_render as R
    import cf_materials as M
    from mathutils import Matrix, Vector
    sc = bpy.context.scene
    R.setup_world(sc)
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=80, fill_type='NGON', location=(0, 0, -0.06))
    gnd = bpy.context.active_object
    gnd.name = "CFCL_PreviewGround"
    gnd.data.materials.append(M.get("Basalt"))
    os.makedirs(REN_DIR, exist_ok=True)
    pre = os.path.join(REN_DIR, f"iter{ITER:02d}")
    paths = R.turntable([sk], pre, lens=50, res=(1100, 800), samples=40 if FAST else 56)
    B = Vector(info["breach_world"])
    outn = Vector(h_to_w(DMG["B"] + DMG["Bn"] * 10) - h_to_w(DMG["B"])).normalized()
    cams = [("closeup_breach", B + outn * 2.6 + Vector((0.6, 0.9, 0.9)), B, 32),
            ("closeup_face", Vector(h_to_w((-3.0, -8.0, -1.5))) + Vector((-1.7, -3.0, 0.35)),
             Vector(h_to_w((-3.0, -8.0, -1.5))), 40)]
    for name, loc, tgt, lens in cams:
        cam = R.camera("CFCL_Cam_" + name, tuple(loc), tuple(tgt), lens)
        paths.append(R.render_to(f"{pre}_{name}.png", cam))
    # hero / distance view: place asset at the research layout, board appended for scale
    pl = {p["name"]: p for p in placements(info, "research")}
    for o in (sk, md, rb):
        p = pl[o.name]
        o.location = p["location"]
        o.rotation_euler = (0, 0, math.radians(p["rotation_deg"][2]))
    gnd.location = (0, 0, pl[rb.name]["location"][2] - 0.06)
    try:
        R.append_board()
    except Exception as e:
        log("board append failed", e)
    R.setup_render(sc, "EEVEE", (1280, 720), 40 if FAST else 64)
    cam = R.camera("CFCL_Cam_Hero", (0, -1.31, 0.22), (0, 9, 1.5), 28)
    paths.append(R.render_to(f"{pre}_hero28mm.png", cam))
    # tighter look at the same placement (what a 2x crop of the hero shot sees)
    cam = R.camera("CFCL_Cam_HeroTele", (0, -1.31, 0.22), (-2.8, 9.5, 1.0), 75)
    paths.append(R.render_to(f"{pre}_hero75mm.png", cam))
    info["renders"] = [os.path.relpath(p, CL) for p in paths]


def write_meta(info):
    import cf_render as R
    meta = dict(asset=ASSET, version=info["version"], blend=info["blend"], iteration=ITER,
                units="metres, +Z up", scale_m_per_human_cm=SC,
                design="real adult skull cm (Frankfort frame) scaled uniformly; pitch 8 deg chin-down, roll 6 deg",
                origin="asset origin (0,0,0) = ground-contact centre of skull footprint; mandible origin = its own "
                       "ground-contact centre",
                objects=info["objects"],
                tris_total=sum(o["tris"] for o in info["objects"]),
                tris_skull_plus_mandible=sum(o["tris"] for o in info["objects"] if not o["name"].endswith("Rubble")),
                breach_world=info.get("breach_world"),
                renders=info.get("renders", []),
                placement_research=RESEARCH, placement_codex=CODEX)
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
