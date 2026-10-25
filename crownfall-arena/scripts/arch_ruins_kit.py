"""CFCL_Arch_RuinsKit - modular broken architecture of the altar's civilisation.

Run:  python lib/run_blender.py scripts/arch_ruins_kit.py --timeout 1800 -- --ver 1 [--norender] [--nosave]

Every piece is built stone by stone (arch_lib.make_block / lathe drums) with joints, chipped arrises,
jitter (size +-8 %, rotation +-2 deg), construction-specific damage and its own fallen parts lying where
gravity puts them.  Carving vocabulary = the altar's lozenge/chevron friezes + pyramidal nailheads.
Pieces (origin = ground-contact centre, +Z up, front = -Y):
  CFCL_Ruin_ColumnStanding   base + 4 offset fluted drums, top drum snapped; capital + 1 drum fallen at its foot
  CFCL_Ruin_ColumnToppled    base + 1 drum standing, the rest lying in a line (one drum split), capital at the end
  CFCL_Ruin_WallFragment     ashlar courses, carved string course, stepped settlement crack, collapsed end,
                             fallen blocks at its foot
  CFCL_Ruin_JambLeft/Right   pier + carved impost + springer + 2 inward-rotated voussoirs (open hinge joints) and
                             the fallen crown voussoirs at its base - sized for Codex's 3.0 m gate
  CFCL_Ruin_LancetArch       secondary 4.6 m pointed arch: both piers, crown + 2 voussoirs missing, lying at base
  CFCL_Ruin_StairFragment    broken flight of 5 steps with cheek walls, lower steps collapsed
  CFCL_Ruin_RingSegment      fallen carved halo/gate ring, half-buried, one segment fallen out in front
"""
import json
import math
import os
import sys
import time

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
for _p in (os.path.join(CL, "lib"), os.path.join(CL, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
import cf_render as R  # noqa: E402
import cf_materials as M  # noqa: E402
import arch_lib as A  # noqa: E402
from arch_lib import D2R, TAU, smoothstep  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = int(ARGV[ARGV.index("--ver") + 1]) if "--ver" in ARGV else 1
NORENDER = "--norender" in ARGV
NOSAVE = "--nosave" in ARGV
FAST = "--fast" in ARGV
ASSET = "CFCL_Arch_RuinsKit"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "arch")
TAG = f"kit_iter{VER:02d}"
T0 = time.time()
MOSS = 0.42


def log(*a):
    print(f"[arch_kit {time.time() - T0:6.1f}s]", *a, flush=True)


# =============================================================================== helpers
def blk(center, half, rot=(0, 0, 0), rb=0.03, step=0.3, chips=3, seed=0, noise_amp=0.003, jitter=True, **kw):
    rng = np.random.default_rng(seed)
    half = np.asarray(half, float)
    rot = np.asarray(rot, float)
    if jitter:
        rb = max(rb, 0.045)
        chips = chips + 2
        kw.setdefault("chip_scale", 1.4)
        kw.setdefault("rb_var", 0.85)
    if jitter:
        half = half * (1 + rng.uniform(-0.04, 0.04, 3))
        rot = rot + rng.uniform(-1.2, 1.2, 3) * np.array([0.3, 0.3, 1.0])
    Mx = A.M4(A.rot_euler(*rot), center)
    pc = A.make_block(half, rb=rb, step=step, chips=chips, rng=rng, mapping=A.map_affine(Mx), seed=seed,
                      noise_amp=noise_amp, **kw)
    pc.half = half
    pc.M = Mx
    return pc


def face_map(half, Mx, face):
    ex, ey, ez = half
    if face == "-y":
        def fm(u, v, h):
            return np.stack([u, -ey - h, v], 1)
        hu = ex
    elif face == "+y":
        def fm(u, v, h):
            return np.stack([-u, ey + h, v], 1)
        hu = ex
    elif face == "+x":
        def fm(u, v, h):
            return np.stack([ex + h, u, v], 1)
        hu = ey
    else:
        def fm(u, v, h):
            return np.stack([-ex - h, -u, v], 1)
        hu = ey
    aff = A.map_affine(Mx)

    def f(u, v, h):
        return aff(fm(np.asarray(u, float), np.asarray(v, float), np.asarray(h, float)))
    return f, hu


def frieze_on(pc, face, v0, v1, n_units, margin=0.05, scale=1.0, phases=(0, 1), fillets=True):
    f, hu = face_map(pc.half, pc.M, face)
    out = A.lozenge_frieze(-hu + margin, hu - margin, v0, v1, n_units, f, h=0.012 * scale, wb=0.018 * scale,
                           wt=0.009 * scale, nail_h=0.018 * scale, small_nails=True, embed=0.006, phases=phases)
    if fillets:
        for vv in (v0 - 0.022 * scale, v1 + 0.022 * scale):
            out.append(A.stroke([(-hu + margin * 0.6, vv), (hu - margin * 0.6, vv)], f, 0.012 * scale,
                                0.006 * scale, 0.01 * scale, 0.006))
    return out


def transform_all(pieces, Mx):
    for p in pieces:
        p.transform(Mx)
    return pieces


def lay_down(pieces, pos, yaw, roll_axis=(1, 0, 0), roll=90.0, tilt=0.0, ground=0.0, sink=0.03, rng=None):
    """Rigidly move pieces (as one body) so they lie on the ground at pos."""
    allv = np.concatenate([p.V for p in pieces])
    c = allv.mean(0)
    Mx = A.M4(None, -c)
    Mx = A.M4(A.rot_axis(roll_axis, roll)) @ Mx
    if tilt:
        Mx = A.M4(A.rot_axis((0, 1, 0), tilt)) @ Mx
    Mx = A.M4(A.rot_euler(0, 0, yaw), (pos[0], pos[1], 0)) @ Mx
    transform_all(pieces, Mx)
    mn = min(p.V[:, 2].min() for p in pieces)
    for p in pieces:
        p.translate((0, 0, ground - mn - sink))
    return pieces


# =============================================================================== columns
COL_R = 0.37


def drum(r, h, rot_deg, seed, flutes=16, fdepth=0.016, nseg=64, frac=None, chips=4):
    rng = np.random.default_rng(seed)
    cap = [0.82, 0.55, 0.28] if frac is not None else []
    prof = [(0, 0), (r - 0.014, 0), (r, 0.014), (r, 0.25 * h), (r, 0.5 * h), (r, 0.75 * h), (r, h - 0.014),
            (r - 0.014, h)] + [(r * f, h) for f in cap] + [(0, h)]

    def dfm(Rr, TH, Z, k):
        R0 = Rr.copy()                       # profile radius (decides cap vs side, before fluting)
        fr = ((TH + rot_deg * D2R) * flutes / TAU) % 1.0
        side = (R0 >= r - 1e-6) & (Z > 0.013) & (Z < h - 0.013)
        Rr = Rr - fdepth * (1 - (2 * fr - 1) ** 2) * side
        if frac is not None:
            zcol = np.minimum(frac(r * np.cos(TH), r * np.sin(TH)), h)      # break height of this column
            zin = np.minimum(frac(R0 * np.cos(TH), R0 * np.sin(TH)), h)
            cap = (R0 < r - 0.02) & (Z >= h - 1e-6)
            Z = np.where(cap, zin, Z * zcol / h)
        return Rr, Z
    pc = A.lathe(prof, nseg, deform=dfm)
    if frac is not None:   # the lathe pole is not deformed: drop it onto the break surface
        m = (np.hypot(pc.V[:, 0], pc.V[:, 1]) < 1e-6) & (pc.V[:, 2] > h - 1e-6)
        pc.V[m, 2] = min(h, float(np.atleast_1d(frac(np.array([0.0]), np.array([0.0])))[0]))
    for _ in range(chips):
        a = rng.uniform(0, TAU)
        top = rng.uniform() < 0.6
        z = h if top else 0.0
        if frac is not None and top:
            continue
        p0 = np.array([r * math.cos(a), r * math.sin(a), z])
        nv = A.normalize(np.array([math.cos(a), math.sin(a), 1.0 if top else -1.0]) + rng.normal(0, 0.25, 3))
        A.chip(pc.V, p0, nv, rng.uniform(0.015, 0.045), 0.14)
    pc.displace(0.003, 6.0, seed=seed)
    return pc


def column_base(seed):
    plinth = blk((0, 0, 0.11), (0.50, 0.50, 0.11), seed=seed, rb=0.03, chips=4, step=0.35)
    torus = A.lathe([(0, 0.22), (0.47, 0.22), (0.475, 0.235), (0.45, 0.27), (0.42, 0.285), (0.40, 0.30),
                     (0.39, 0.32), (0.385, 0.34), (0, 0.34)], 48)
    torus.displace(0.003, 6.0, seed=seed + 1)
    return [plinth, torus]


def capital(seed, r_neck=COL_R):
    rng = np.random.default_rng(seed)
    neck = A.lathe([(0, 0), (r_neck, 0), (r_neck, 0.09), (r_neck + 0.012, 0.095), (r_neck + 0.012, 0.11),
                    (r_neck + 0.05, 0.14), (r_neck + 0.11, 0.19), (r_neck + 0.15, 0.23), (r_neck + 0.16, 0.26),
                    (0, 0.26)], 56)
    out = [neck]
    out += A.lozenge_frieze(0, TAU * (r_neck + 0.001), 0.018, 0.075, 14, A.map_cyl(r_neck + 0.001, 0.0),
                            h=0.010, wb=0.014, wt=0.007, nail_h=0.012, phases=(0,), closed=True, embed=0.005)
    ab = blk((0, 0, 0.26 + 0.10), (0.56, 0.56, 0.10), seed=seed + 2, rb=0.025, chips=5, step=0.3, jitter=False,
             noise_amp=0.002)
    out.append(ab)
    for fc in ("-y", "+y", "+x", "-x"):
        out += frieze_on(ab, fc, -0.045, 0.045, 4, margin=0.06, scale=0.85)
    for p in out:
        p.displace(0.0, 1.0)
    return out


def snapped_top(seed, h, amp=0.10):
    def zf(x, y):
        return h - amp * 0.5 - 0.6 * amp * (x / COL_R) + 0.25 * amp * (y / COL_R) + 0.04 * A.fbm2(x, y, 3.5, 3, seed=seed)
    return zf


def build_column_standing():
    pcs = column_base(10)
    z = 0.34
    hs = [0.64, 0.58, 0.62, 0.55]
    rng = np.random.default_rng(11)
    for i, h in enumerate(hs):
        frac = snapped_top(30 + i, h, 0.22) if i == len(hs) - 1 else None
        d = drum(COL_R * (1 - 0.012 * i), h, rng.uniform(-9, 9), 20 + i, frac=frac)
        d.transform(A.M4(A.rot_euler(*rng.uniform(-0.5, 0.5, 2), 0), (rng.uniform(-0.012, 0.012),
                                                                       rng.uniform(-0.012, 0.012), z)))
        pcs.append(d)
        z += h + 0.004
    # the missing upper drum and the capital lie at its foot, where they fell (toward +x / -y)
    fallen_drum = drum(COL_R * 0.95, 0.6, 3, 40, frac=None, chips=6)
    lay_down([fallen_drum], (1.25, -0.55), 28, roll=90, rng=rng)
    cap = capital(50)
    lay_down(cap, (0.55, -1.45), -18, roll_axis=(1, 0.2, 0), roll=112, sink=0.06)
    shard = drum(COL_R * 0.95, 0.24, 5, 41, frac=lambda x, y: 0.2 + 0.05 * A.fbm2(x, y, 6, 2, seed=3), chips=2)
    lay_down([shard], (1.7, 0.25), 80, roll=72, sink=0.02)
    return pcs + [fallen_drum, shard] + cap


def build_column_toppled():
    pcs = column_base(60)
    rng = np.random.default_rng(61)
    d0 = drum(COL_R, 0.62, 0, 70, frac=snapped_top(71, 0.62, 0.16))
    d0.translate((0, 0, 0.34))
    pcs.append(d0)
    # remaining drums lie in a line where the shaft fell (direction +x), rolled apart a little
    x = 0.95
    for i, h in enumerate((0.6, 0.62, 0.57, 0.6)):
        if i == 2:   # this drum split on impact
            a = drum(COL_R, h * 0.55, 10, 80 + i, frac=lambda xx, yy: h * 0.55 - 0.02 + 0.04 * A.fbm2(xx, yy, 7, 2, seed=5))
            b = drum(COL_R, h * 0.45, 10, 90 + i, frac=lambda xx, yy: h * 0.45 - 0.02 + 0.04 * A.fbm2(xx, yy, 7, 2, seed=6))
            lay_down([a], (x + 0.18, rng.uniform(-0.1, 0.1)), 90 + rng.uniform(-8, 8), roll=90, sink=0.03)
            lay_down([b], (x + 0.62, 0.18), 75, roll=76, sink=0.02)
            pcs += [a, b]
            x += h + 0.22
            continue
        d = drum(COL_R, h, rng.uniform(0, 30), 80 + i)
        lay_down([d], (x + h / 2, rng.uniform(-0.12, 0.12)), 90 + rng.uniform(-10, 10), roll=90, sink=0.04)
        pcs.append(d)
        x += h + rng.uniform(0.04, 0.2)
    cap = capital(95)
    lay_down(cap, (x + 0.55, 0.1), 8, roll_axis=(0, 1, 0), roll=-96, sink=0.05)
    pcs += cap
    return pcs


# =============================================================================== wall
def build_wall():
    rng = np.random.default_rng(100)
    L, T = 4.4, 0.78
    courses = [0.52, 0.48, 0.50, 0.30, 0.46, 0.44, 0.47]   # course 4 = carved string course
    pcs = []
    fallen = []
    z = 0.0

    def top_limit(x):   # collapsed profile: high on the left, broken down to the right
        t = (x + L / 2) / L
        return 3.1 - 2.1 * smoothstep(0.35, 1.0, t) + 0.25 * A.fbm2(np.array([x * 0.7]), np.array([0.2]), 1.0, 2, seed=4)[0]
    crack_x0 = -0.9
    for ci, ch in enumerate(courses):
        string = (ci == 3)
        x = -L / 2 - (0.35 if ci % 2 else 0.0)
        while x < L / 2 - 0.05:
            ln = rng.uniform(0.62, 1.15) if not string else rng.uniform(0.9, 1.3)
            xa, xb = max(x, -L / 2), min(x + ln, L / 2)
            x += ln
            if xb - xa < 0.25:
                continue
            cx = 0.5 * (xa + xb)
            cz = z + ch / 2
            lim = top_limit(cx)
            depth = T + (0.08 if string else 0.0)
            seed = 1000 + ci * 50 + int((cx + 3) * 10)
            # stepped settlement crack: blocks right of the stepped line dropped and pushed out
            dx = 0.0
            dz = 0.0
            ox = 0.0
            if cx > crack_x0 + 0.42 * ci:
                dz = -0.032 - 0.008 * ci
                dx = 0.022
                if xa < crack_x0 + 0.42 * ci + 0.7:     # first stone right of the crack: joint opens
                    ox = 0.028
            if cz + ch / 2 > lim + 0.05:
                # this block is gone: it fell to the foot of the wall on the collapse side
                if rng.uniform() < 0.75:
                    fallen.append((xb - xa, ch, depth, cx, ci, seed))
                continue
            ftop = None
            if cz + ch / 2 > lim - 0.12:
                def ftop(xx, yy, ch=ch, seed=seed):
                    return ch / 2 - 0.10 - 0.08 * (xx > 0) + 0.04 * A.fbm2(xx, yy, 5, 2, seed=seed)
            rot = (0, 0, rng.uniform(-1.5, 1.5))
            b = blk((cx + dx * 0.5 + ox, rng.uniform(-0.015, 0.015) - dx, cz + dz), ((xb - xa) / 2 - 0.006, depth / 2,
                    ch / 2 - 0.005), rot=rot, seed=seed, rb=0.04, chips=int(rng.integers(3, 8)), chip_scale=1.5,
                    step=0.42, fracture_top=ftop, frac_step=0.16)
            pcs.append(b)
            if string and ftop is None:
                pcs += frieze_on(b, "-y", -0.06, 0.06, max(2, int((xb - xa) / 0.24)), margin=0.07)
        z += ch + 0.004
    # rubble + soil core between the faces: dark in every joint and behind the collapsed top (slot 2)
    zc_top = [top_limit(x) - 0.45 for x in np.linspace(-L / 2 + 0.1, L / 2 - 0.1, 9)]
    for i, x0 in enumerate(np.linspace(-L / 2 + 0.1, L / 2 - 0.1, 9)[:-1]):
        x1 = x0 + (L - 0.2) / 8
        ztop = max(0.3, min(zc_top[i], zc_top[i + 1]))
        core = A.make_block((0.5 * (x1 - x0) + 0.02, T / 2 - 0.09, ztop / 2), rb=0.02, step=0.3, chips=0,
                            rng=rng, mapping=A.map_affine(A.M4(None, (0.5 * (x0 + x1), 0, ztop / 2))), seed=170 + i,
                            noise_amp=0.02, noise_freq=4.0,
                            fracture_top=(lambda xx, yy, zt=ztop, s_=i: zt / 2 - 0.06 + 0.06 * A.fbm2(xx, yy, 4, 2, seed=s_)),
                            frac_step=0.4)
        pcs.append(core.set_mat(2))
    # fallen blocks lie on the ground in front/right of the collapsed end, some stacked on others
    gx = 1.2
    placed = []
    for i, (ln, ch, dp, cx, ci, seed) in enumerate(fallen[:12]):
        b = blk((0, 0, 0), (ln / 2, dp / 2, ch / 2), seed=seed + 7, rb=0.045, chips=7, chip_scale=1.6, step=0.3)
        roll_axis = (1, 0, 0) if rng.uniform() < 0.5 else (0, 1, 0)
        pos = (min(L / 2 + 0.2, cx) + rng.uniform(0.2, 1.4), -rng.uniform(0.6, 1.8) * (1 if i % 3 else -0.6))
        lay_down([b], pos, rng.uniform(0, 180), roll_axis=roll_axis, roll=rng.choice([0, 90, 0, 15]) + rng.uniform(-12, 12),
                 sink=0.03)
        # if it lands on an earlier block, rest on top of it
        for q in placed:
            qmn, qmx = q.V.min(0), q.V.max(0)
            bmn, bmx = b.V.min(0), b.V.max(0)
            if bmn[0] < qmx[0] and bmx[0] > qmn[0] and bmn[1] < qmx[1] and bmx[1] > qmn[1]:
                b.translate((0, 0, qmx[2] - bmn[2] - 0.05))
                b.transform(A.rot_about(b.V.mean(0), (0, 1, 0), rng.uniform(-12, 12)))
        placed.append(b)
        pcs.append(b)
    # rubble at the foot
    for i in range(14):
        sz = rng.uniform(0.06, 0.2)
        c = (rng.uniform(0.2, 2.6), -rng.uniform(0.45, 1.6), 0)
        pcs.append(A.rest_on(A.rubble_chunk(c, (sz, sz * 0.8, sz * 0.55), rng), 0.0, 0.03))
    return pcs


# =============================================================================== arches / jambs
def voussoir(cx, cz, r_in, r_out, a_lo, a_hi, depth, seed, gap=0.008, carve=True, chips=3):
    rm = 0.5 * (r_in + r_out)
    g = gap / rm * 0.5
    a0, a1 = (a_lo + g) * 1.0, (a_hi - g) * 1.0
    ex = 0.5 * (a1 - a0) * rm
    ey = 0.5 * (r_out - r_in) - gap * 0.5
    ez = 0.5 * depth
    mp = A.map_arch(cx, cz, r_in + gap * 0.5, r_out - gap * 0.5, a0, a1, 0.0, ex, ey)
    rng = np.random.default_rng(seed)
    pc = A.make_block((ex, ey, ez), rb=0.025, step=0.3, chips=chips, rng=rng, mapping=mp, seed=seed, noise_amp=0.0025)
    out = [pc]
    if carve:   # archivolt band on the front face (local z = -ez), near the intrados
        def fm(u, v, h):
            u, v, h = (np.asarray(a, float) for a in (u, v, h))
            return mp(np.stack([u, v, np.full_like(u, -ez) - h], 1))
        out += A.lozenge_frieze(-ex + 0.03, ex - 0.03, -ey + 0.07, -ey + 0.22, 2, fm, h=0.012, wb=0.018,
                                wt=0.009, nail_h=0.016, embed=0.006)
        out.append(A.stroke([(-ex + 0.02, -ey + 0.255), (ex - 0.02, -ey + 0.255)], fm, 0.012, 0.006, 0.01, 0.006))
    return out


def pier(x0, x1, depth, h, seed, damage=True):
    """Coursed pier between x0..x1 (front face at -depth/2)."""
    rng = np.random.default_rng(seed)
    out = []
    z = 0.0
    ci = 0
    while z < h - 0.05:
        ch = min(rng.uniform(0.42, 0.56), h - z)
        if ch < 0.2:
            out[-1].translate((0, 0, 0))
            break
        w = x1 - x0
        if ci % 2 == 0:
            parts = [(x0, x1, -depth / 2, depth / 2)]
        else:   # two stones per course, joint offset (bond)
            ys = rng.uniform(-0.1, 0.1)
            parts = [(x0, x1, -depth / 2, ys - 0.004), (x0, x1, ys + 0.004, depth / 2)] if rng.uniform() < 0.5 else \
                [(x0, x0 + w * 0.5 - 0.004, -depth / 2, depth / 2), (x0 + w * 0.5 + 0.004, x1, -depth / 2, depth / 2)]
        slump_ci = 1 + (seed % 3)
        for pi, (xa, xb, ya, yb) in enumerate(parts):
            sd = seed * 31 + ci * 7 + int(xa * 10) + 100
            b = blk((0.5 * (xa + xb), 0.5 * (ya + yb), z + ch / 2), ((xb - xa) / 2 - 0.004, (yb - ya) / 2 - 0.004,
                                                                     ch / 2 - 0.004),
                    seed=sd, rb=0.03, chips=int(rng.integers(2, 5)), step=0.3)
            if damage and ci == slump_ci and pi == 0:     # stone squeezed out of the face and slumped
                b.transform(A.rot_about(b.V.mean(0), (1, 0, 0), -3.5))
                b.translate((0, -0.045, -0.012))
            out.append(b)
        z += ch
        ci += 1
    return out, z


def build_half_arch(side, span, pier_h, seed, n_vous=5, keep=2, rot1=5.0, rot2=3.0, pier_w=0.75, depth=0.66,
                    T=0.55, fallen_spread=1.0, carve_impost=True):
    """One pier with impost, springer, `keep` inward-rotated voussoirs. side=-1 left, +1 right.
    Returns (standing, fallen, crown_xyz)."""
    rng = np.random.default_rng(seed)
    S = span
    xin = side * S / 2
    xout = side * (S / 2 + pier_w)
    standing, zt = pier(min(xin, xout), max(xin, xout), depth, pier_h, seed)
    # impost (carved band)
    imp_h = 0.24
    imp = blk((0.5 * (xin + xout) - side * 0.04, 0, zt + imp_h / 2), (pier_w / 2 + 0.08, depth / 2 + 0.05, imp_h / 2),
              seed=seed + 5, rb=0.02, chips=3, step=0.3, jitter=False, noise_amp=0.002)
    standing.append(imp)
    if carve_impost:
        standing += frieze_on(imp, "-y", -0.06, 0.06, 3, margin=0.06, phases=(0,))
    zs = zt + imp_h + 0.004
    # pointed (equilateral) arch: this half's intrados is centred on the opposite springing point
    cx = -xin
    cz = zs
    seg = 60.0 / n_vous
    vous = []
    for k in range(n_vous):
        if side < 0:
            a_hi, a_lo = 180 - k * seg, 180 - (k + 1) * seg
        else:
            a_lo, a_hi = k * seg, (k + 1) * seg
        vous.append(voussoir(cx, cz, S, S + T, a_lo * D2R, a_hi * D2R, depth, seed + 100 + k))
    kept = vous[:1 + keep]
    lost = vous[1 + keep:]
    # failing arch: the kept voussoirs above the springer rotate inward about the intrados hinge (joint opens)
    def hinge(k):
        ang = (180 - k * seg) if side < 0 else (k * seg)
        return np.array([cx + S * math.cos(ang * D2R), 0.0, cz + S * math.sin(ang * D2R)])
    rot_sign = 1.0 if side < 0 else -1.0
    Mh = A.rot_about(hinge(1), (0, 1, 0), rot_sign * rot1)
    for grp in kept[1:]:
        transform_all(grp, Mh)
    if keep >= 2:
        h2 = hinge(2)
        h2 = (Mh @ np.r_[h2, 1.0])[:3]
        M2 = A.rot_about(h2, (0, 1, 0), rot_sign * rot2)
        for grp in kept[2:]:
            transform_all(grp, M2)
    for grp in kept:
        standing += grp
    # fallen voussoirs (+ fragment of the crown) at the foot, inside the opening and in front
    fallen = []
    for i, grp in enumerate(lost):
        pos = (xin - side * rng.uniform(0.3, 0.9) * fallen_spread, -rng.uniform(0.2, 1.4) * fallen_spread)
        if i == len(lost) - 1 and rng.uniform() < 0.7:   # broke in two on impact: keep main block + chunk
            main = grp[0]
            chunk = A.rubble_chunk((0, 0, 0), (0.16, 0.12, 0.1), rng)
            lay_down([chunk], (pos[0] + 0.5 * side * -1, pos[1] - 0.3), rng.uniform(0, 180), roll=0, sink=0.02)
            fallen.append(chunk)
        lay_down(grp, pos, rng.uniform(-60, 60), roll_axis=(1, 0, 0), roll=90 + rng.uniform(-14, 14),
                 tilt=rng.uniform(-10, 10), sink=0.03)
        fallen += grp
    crown = np.array([0.0, 0.0, cz + S * math.sin(60 * D2R)])
    return standing, fallen, crown


def build_jamb(side):
    standing, fallen, crown = build_half_arch(side, 3.0, 2.05, 300 if side < 0 else 400, n_vous=5, keep=2,
                                              rot1=4.5 if side < 0 else 6.0, rot2=3.0)
    return standing + fallen, crown


def build_lancet():
    sl, fl, crown = build_half_arch(-1, 2.2, 1.9, 500, n_vous=5, keep=3, rot1=3.0, rot2=2.0, pier_w=0.62,
                                    depth=0.58, T=0.46, fallen_spread=0.8)
    sr, fr, _ = build_half_arch(1, 2.2, 1.9, 600, n_vous=5, keep=2, rot1=4.0, rot2=3.5, pier_w=0.62, depth=0.58,
                                T=0.46, fallen_spread=0.8)
    return sl + fl + sr + fr, crown


# =============================================================================== stair fragment
def build_stair_fragment():
    rng = np.random.default_rng(700)
    pcs = []
    rise, tread, hw = 0.18, 0.38, 0.85
    n = 6
    tops = {}
    for k in range(n):
        if k in (0, 1):     # lowest steps lost (collapsed); a broken stub remains of step 1
            if k == 1:
                pcs.append(blk((0.35, -k * tread - 0.15, 0.10), (0.45, 0.16, 0.10), seed=710, rb=0.03,
                               fracture_top=lambda x, y: 0.1 - 0.06 * (x < 0) + 0.02 * A.fbm2(x, y, 6, 2, seed=1)))
            continue
        y = -(n - 1 - k) * tread   # top step at y=0 going down toward -y
        zt = (k + 1) * rise
        tops[k] = zt
        xs = rng.uniform(-0.25, 0.25)
        for (xa, xb, sd) in ((-hw, xs - 0.012, 2 * k), (xs + 0.012, hw, 2 * k + 1)):
            c = (0.5 * (xa + xb), y + 0.03, zt - 0.2)
            st = blk(c, ((xb - xa) / 2 - 0.006, tread / 2 + 0.02, 0.2), seed=720 + sd, rb=0.03, chips=10,
                     chip_scale=0.55, step=0.2, chip_opts={"prefer": (0, (1, -1, 1))})
            # settled: 3-8 deg total about a random horizontal axis + twist, sunk/pushed 1-4 cm downhill
            ax = A.normalize(np.r_[rng.normal(0, 1, 2), 0])
            st.transform(A.rot_about((c[0], c[1], zt - 0.4), ax, rng.uniform(3.0, 6.5)))
            st.transform(A.rot_about(c, (0, 0, 1), rng.uniform(-2.5, 2.5)))
            st.translate((rng.uniform(-0.01, 0.01), -rng.uniform(0.01, 0.035), -rng.uniform(0.005, 0.03)))
            pcs.append(st)
    # landing slab at the top
    land = blk((0, 0.75, (n) * rise - 0.15), (hw + 0.05, 0.55, 0.15), seed=760, rb=0.03, chips=8, chip_scale=0.6,
               jitter=False)
    pcs.append(land)
    pcs += frieze_on(land, "-y", -0.055, 0.055, 6, margin=0.08, scale=0.9)     # the one carved course
    # core under the flight, broken off at the low end
    e = np.array([hw - 0.02, 1.1, 0.5])
    c = np.array([0, -1.0, 0.5])

    def ftop(x, y):
        yy = y + c[1]
        zline = (n - 1) * rise + rise * (yy / tread) - 0.25
        return np.clip(zline - c[2], -0.45, 0.5) + 0.02 * A.fbm2(x, y, 5, 2, seed=2)
    pcs.append(A.make_block(e, rb=0.02, step=0.3, chips=2, rng=rng, mapping=A.map_affine(A.M4(None, c)), seed=77,
                            fracture_top=ftop, frac_step=0.25, noise_amp=0.012).set_mat(2))   # soil/rubble core
    # one step stone has fallen downhill and lies tipped at the foot
    fb = blk((0, 0, 0), (0.42, tread / 2 + 0.02, 0.2), seed=777, rb=0.035, chips=10, chip_scale=0.6)
    lay_down([fb], (0.55, -(n - 1) * tread - 1.15), 24, roll_axis=(1, 0, 0), roll=28, tilt=9, sink=0.06)
    pcs.append(fb)
    # cheek walls with sloped coping; left one stands, right one broken with its coping fallen
    for side in (-1, 1):
        for j in range(3):
            if side == 1 and j == 0:
                continue
            ya = -(n - 1) * tread + j * 0.8
            c = (side * (hw + 0.16), ya + 0.4, 0.55 + j * 0.42 - 0.2)
            hz = 0.55 + j * 0.42 - 0.2 + 0.2
            pcs.append(blk((c[0], c[1], hz / 2), (0.15, 0.39, hz / 2), seed=780 + j * 2 + side, rb=0.03, chips=3))
    cop = blk((0, 0, 0), (0.17, 0.45, 0.12), seed=799, rb=0.03, chips=5)
    lay_down([cop], (hw + 0.6, -1.6), 35, roll=0, tilt=14, sink=0.04)
    pcs.append(cop)
    for i in range(10):
        sz = rng.uniform(0.05, 0.16)
        cc = (rng.uniform(-0.9, 1.3), rng.uniform(-2.6, -1.6), 0)
        pcs.append(A.rest_on(A.rubble_chunk(cc, (sz, sz * 0.8, sz * 0.55), rng), 0.0, 0.03))
    # moss/soil gathered in the angle at the back of each tread and along the cheek walls
    for k, zt in tops.items():
        y = -(n - 1 - k) * tread
        for xx in (-hw + 0.1, rng.uniform(-0.4, 0.4), hw - 0.1):
            if rng.uniform() < 0.7:
                pcs.append(pad((xx, y + tread / 2 - 0.02, zt - 0.01), rng.uniform(0.07, 0.16), rng.uniform(0.04, 0.07),
                               rng.uniform(0.025, 0.05), rng, sink=0.02))
    # recentre: origin at the base centre of the footprint
    allv = np.concatenate([p.V for p in pcs])
    mn, mx = allv.min(0), allv.max(0)
    for p in pcs:
        p.translate((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, 0))
    return pcs


# =============================================================================== ring segment
def build_ring():
    rng = np.random.default_rng(800)
    Ro, Ri, depth = 2.1, 1.62, 0.46
    cz = 1.2                # centre height: both ends of the arc run into the ground (half-buried)
    pcs = []
    seg = 22.5
    lost_k = 6              # one crown-side segment fell out
    fallen = []
    for k in range(0, 12):
        a_lo = -45 + k * seg
        a_hi = a_lo + seg
        grp = voussoir(0.0, cz, Ri, Ro, a_lo * D2R, a_hi * D2R, depth, 810 + k, gap=0.01, carve=False, chips=4)
        # the ring's own carving: a lozenge band in the middle of the front face
        rm = 0.5 * (Ri + Ro)
        mp = A.map_arch(0.0, cz, Ri + 0.005, Ro - 0.005, (a_lo * D2R) + 0.01 / rm, (a_hi * D2R) - 0.01 / rm, 0.0,
                        0.5 * (seg * D2R - 0.02 / rm) * rm, 0.5 * (Ro - Ri) - 0.005)
        ex = 0.5 * (seg * D2R - 0.02 / rm) * rm
        ey = 0.5 * (Ro - Ri) - 0.005

        def fm(u, v, h, mp=mp):
            u, v, h = (np.asarray(a, float) for a in (u, v, h))
            return mp(np.stack([u, v, np.full_like(u, -depth / 2) - h], 1))
        grp += A.lozenge_frieze(-ex + 0.04, ex - 0.04, -0.12, 0.12, 3, fm, h=0.014, wb=0.02, wt=0.01,
                                nail_h=0.02, embed=0.006)
        for vv in (-0.165, 0.165):
            grp.append(A.stroke([(-ex + 0.02, vv), (ex - 0.02, vv)], fm, 0.014, 0.007, 0.012, 0.006))
        if k == lost_k:
            fallen = grp
            continue
        pcs += grp
    # lean the ring back 9 deg about its ground line, then drop the fallen segment in front of it
    transform_all(pcs, A.rot_about((0, 0, 0), (1, 0, 0), -9.0))
    lay_down(fallen, (0.35, -1.25), 12, roll_axis=(1, 0, 0), roll=84, tilt=6, sink=0.04)
    pcs += fallen
    # clip: pieces entirely below ground are dropped; ring is half-buried (mesh continues under ground)
    pcs = [p for p in pcs if p.V[:, 2].max() > 0.02]
    for i in range(8):
        sz = rng.uniform(0.06, 0.18)
        c = (rng.uniform(-1.4, 1.6), rng.uniform(-1.6, -0.3), 0)
        pcs.append(A.rest_on(A.rubble_chunk(c, (sz, sz * 0.8, sz * 0.5), rng), 0.0, 0.03))
    return pcs




# =============================================================================== worldbuilding (v009)
def _ring_course(pcs, r_in, r_out, n, off, zb, zt, seed, dmg, riser=None, rng=None):
    """One circular course of sector stones; dmg(thm, rng) -> ok / tilt / sunk / missing / crack."""
    import arch_altar_dais as AD
    for k in range(n):
        tha = off + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        kind = dmg(thm, rng)
        if kind == "missing":
            continue
        crack = dict(pos=rng.uniform(-0.3, 0.3), gap=rng.uniform(0.008, 0.016), amp=0.03) if kind == "crack" else None
        st = AD.sector_stone(r_in, r_out, tha, thb, zb, zt, seed + k, gap=0.014, rb=0.03, step=0.6, step_z=0.6,
                             chips=5, chip_scale=0.9, prefer=(0, (1, 1, 1)), crack=crack, noise_amp=0.003)
        extra = riser(tha, thb) if riser is not None else []
        allp = st + extra
        rad, tan = AD.radial_tangent(thm)
        rm = 0.5 * (r_in + r_out)
        if kind == "tilt":
            AD.tilt_pieces(allp, (rm * rad[0], rm * rad[1], zb), tan, rng.uniform(6, 16), drop=rng.uniform(0.04, 0.12))
        elif kind == "sunk":
            AD.tilt_pieces(allp, (rm * rad[0], rm * rad[1], zb), A.normalize(np.r_[rng.normal(0, 1, 2), 0]),
                           rng.uniform(2, 6), drop=rng.uniform(0.05, 0.14))
        pcs += allp


def build_skull_shrine():
    """The terrace the skull was once enshrined on: three carved circular courses (top = skull contact, z=0),
    cracked and sunk on the impact side, a toppled ring of 8 short columns, sediment and moss."""
    rng = np.random.default_rng(9300)
    pcs = []

    def dmg(thm, rg):
        d = abs(((thm - 230.0 + 180) % 360) - 180)        # impact side (local 230 deg)
        x = rg.uniform()
        if d < 35:
            return "missing" if x < 0.30 else "tilt" if x < 0.65 else "crack"
        if d < 70:
            return "sunk" if x < 0.35 else "crack" if x < 0.6 else "ok"
        return "crack" if x < 0.15 else "ok"

    def dmg_top(thm, rg):
        return "crack" if abs(((thm - 230.0 + 180) % 360) - 180) < 30 else "ok"
    # the terrace RISES from the ground (z=0 = ground / skull contact); the skull smashed through its centre and
    # sits in the crater, so the top course is a broken ring (inner edge r 1.75) around it
    def dmg_crater(thm, rg):
        d = abs(((thm - 230.0 + 180) % 360) - 180)
        x = rg.uniform()
        if d < 40:
            return "missing" if x < 0.4 else "tilt"
        return "tilt" if x < 0.35 else "crack" if x < 0.7 else "ok"
    _ring_course(pcs, 1.75, 2.30, 8, 7.0, 0.20, 0.48, 9310, dmg_crater, rng=rng)

    def riser_fret(r_out, zb, zt):
        def f(tha, thb):
            Rr = r_out - 0.007
            mp = A.map_cyl(Rr, 0.0)
            a0, a1 = tha * D2R, thb * D2R
            spn = (a1 - a0) * Rr
            return A.fret_band(a0 * Rr + 0.08 * spn, a1 * Rr - 0.08 * spn, zb + 0.05, zt - 0.06,
                               max(2, int(spn / 0.34)), mp, h=0.016, wb=0.016, wt=0.008, embed=0.008)
        return f

    def riser_loz(r_out, zb, zt):
        def f(tha, thb):
            Rr = r_out - 0.007
            mp = A.map_cyl(Rr, 0.0)
            a0, a1 = tha * D2R, thb * D2R
            spn = (a1 - a0) * Rr
            return A.lozenge_frieze(a0 * Rr + 0.08 * spn, a1 * Rr - 0.08 * spn, zb + 0.05, zt - 0.05,
                                    max(2, int(spn / 0.3)), mp, h=0.016, wb=0.018, wt=0.009, nail_h=0.022, embed=0.008)
        return f
    _ring_course(pcs, 2.30, 2.75, 10, 0.0, 0.02, 0.32, 9330, dmg, riser=riser_fret(2.75, 0.13, 0.32), rng=rng)
    _ring_course(pcs, 2.75, 3.25, 10, 11.0, -0.25, 0.16, 9350, dmg, rng=rng)
    # ring of 8 short columns on the lowest tread (r 3.0), mostly toppled outward by the impact
    rr = 0.165
    for k in range(8):
        th = (22.5 + 45 * k) * D2R
        c = np.array([3.0 * math.cos(th), 3.0 * math.sin(th)])
        pcs.append(blk((c[0], c[1], 0.16 + 0.05), (0.21, 0.21, 0.05), rot=(0, 0, math.degrees(th)), seed=9400 + k,
                       rb=0.025, chips=4))
        standing = {0: 3, 3: 2, 5: 1, 6: 0}.get(k, 1)
        z = 0.26
        for d in range(standing):
            last = (d == standing - 1)
            h = 0.40
            fr = snapped_top(9410 + k, h, 0.14) if last else None
            dr = drum(rr, h, rng.uniform(0, 30), 9420 + 10 * k + d, flutes=8, fdepth=0.0, nseg=16, frac=fr, chips=3)
            dr.translate((c[0] + rng.uniform(-0.01, 0.01), c[1], z))
            pcs.append(dr)
            z += h + 0.004
        out_dir = np.array([math.cos(th), math.sin(th)])     # the missing drums lie where the column fell
        for d in range(min(1, max(0, 3 - standing))):
            dr = drum(rr, 0.40, rng.uniform(0, 30), 9500 + 10 * k + d, flutes=8, fdepth=0.0, nseg=16, chips=4)
            pos = c + out_dir * (0.62 + 0.45 * d + rng.uniform(-0.08, 0.08)) + rng.normal(0, 0.08, 2)
            lay_down([dr], pos, math.degrees(th) + 90 + rng.uniform(-25, 25), roll=90, sink=0.05, ground=0.0)
            pcs.append(dr)
    for i, k in enumerate(()):         # (capital dropped for budget)
        th = (22.5 + 45 * k) * D2R
        cap = capital(9600 + i, r_neck=0.37)
        for p in cap:
            p.transform(A.M4(np.eye(3) * 0.46))
        pos = np.array([math.cos(th), math.sin(th)]) * 4.1
        lay_down(cap, pos, rng.uniform(0, 180), roll_axis=(1, 0.3, 0), roll=100, sink=0.04, ground=0.0)
        pcs += cap
    for i in range(9):         # rubble thrown out on the impact side
        sz = rng.uniform(0.05, 0.16)
        th = (230 + rng.uniform(-45, 45)) * D2R
        r_ = rng.uniform(1.8, 3.8)
        z = 0.48 if r_ < 2.30 else (0.32 if r_ < 2.75 else (0.16 if r_ < 3.25 else 0.0))
        pcs.append(A.rest_on(A.rubble_chunk((r_ * math.cos(th), r_ * math.sin(th), 0), (sz, sz * 0.8, sz * 0.55), rng),
                             z, 0.02))
    pcs.append(skull_burial_mound())   # buries the lower face over the jaw line
    for i in range(8):         # sediment / moss cushions in the angle of every step
        th = rng.uniform(0, A.TAU)
        r_, z = (rng.uniform(2.76, 2.85), 0.16) if i % 2 else (rng.uniform(2.31, 2.40), 0.32)
        pcs.append(pad((r_ * math.cos(th), r_ * math.sin(th), z), rng.uniform(0.08, 0.2), rng.uniform(0.05, 0.1),
                       rng.uniform(0.03, 0.06), rng, sink=0.02))
    return pcs


def polar_drape(r0, r1, nr, nseg, height_fn, ground_fn=None, seed=0, edge_sink=0.04):
    """Heightfield sheet over polar grid r0..r1 (open inner edge, outer edge sunk below ground).
    height_fn(r, th)->h above ground; ground_fn(x, y)->z (default 0).  Returns Piece (material slot 2)."""
    rs = np.linspace(r0, r1, nr)
    th = np.linspace(0, A.TAU, nseg, endpoint=False)
    R_, T_ = np.meshgrid(rs, th, indexing='ij')
    X, Y = R_ * np.cos(T_), R_ * np.sin(T_)
    H = height_fn(R_, T_) + 0.035 * A.fbm2(X * 1.0, Y * 1.0, 2.2, 3, seed=seed)
    H[-1, :] = -edge_sink
    G = np.zeros_like(X) if ground_fn is None else np.vectorize(ground_fn)(X, Y)
    V = np.stack([X.ravel(), Y.ravel(), (G + H).ravel()], 1)
    F = []
    for i in range(nr - 1):
        for j in range(nseg):
            j2 = (j + 1) % nseg
            F.append([i * nseg + j, i * nseg + j2, (i + 1) * nseg + j2, (i + 1) * nseg + j][::-1])
    pc = A.Piece(V, F)
    return pc.set_mat(2)


def skull_burial_mound():
    """Sediment/rubble mound that buries the skull's lower face: rises over the jaw line at the front (-Y),
    lower at the sides/back, and spills over the inner edge of the terrace's top course."""
    def h(r, th):
        front = np.clip(-np.sin(th), 0, 1) ** 1.2
        Hth = 0.30 + 0.34 * front
        return Hth * (1 - A.smoothstep(1.15, 2.5, r))
    return polar_drape(0.0, 2.6, 11, 44, h, seed=31)


HAND_SCALE = 1.25


def hand_ground_fn():
    """Ground height of the hero hand's own mound (CFCL_Hero_Hand_Mound, x1.25 like the main build), sampled by
    BVH ray casts from the hand asset (read only; appended data is removed again before saving)."""
    import glob
    import bpy
    from mathutils.bvhtree import BVHTree
    files = sorted(glob.glob(os.path.join(CL, "assets", "CFCL_Hero_Hand", "CFCL_Hero_Hand_v*.blend")))
    if not files:
        return (lambda x, y: 0.0), "no hand blend found: ground = 0"
    with bpy.data.libraries.load(files[-1], link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == "CFCL_Hero_Hand_Mound"]
    obs = [o for o in dst.objects if o is not None]
    if not obs:
        return (lambda x, y: 0.0), "mound not found: ground = 0"
    ob = obs[0]
    Mw = np.array(ob.matrix_world)
    me = ob.data
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]
    V *= HAND_SCALE
    bvh = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(p.vertices) for p in me.polygons])
    mats = list(me.materials)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    for m in mats:
        if m is not None and m.users == 0:
            bpy.data.materials.remove(m)

    def ground(x, y):
        loc, nrm, idx, dist = bvh.ray_cast((float(x), float(y), 30.0), (0.0, 0.0, -1.0))
        return float(loc[2]) if loc is not None else 0.0
    return ground, os.path.basename(files[-1])


HAND_GROUND_SRC = ""


def build_hand_arcade():
    """The arcade the hand burst up through + the ruined pedestal that wraps its forearm base.  Everything rests on
    the hand's own mound surface (sampled), heaved outward; local x = arcade axis."""
    global HAND_GROUND_SRC
    ground, HAND_GROUND_SRC = hand_ground_fn()
    rng = np.random.default_rng(9700)
    pcs = []
    R_C, DH = 0.20, 0.45
    cs = R_C / 0.37

    def slope_tilt(x, y, d=0.25):
        gx = (ground(x + d, y) - ground(x - d, y)) / (2 * d)
        gy = (ground(x, y + d) - ground(x, y - d)) / (2 * d)
        return gx, gy
    # ---- arcade piers on the mound slope, heaved outward
    for side in (-1, 1):
        xo, xi = side * 3.5, side * 2.15
        for which, x in (("outer", xo), ("inner", xi)):
            z0 = ground(x, 0.0) - 0.06
            grp = [blk((x, 0, z0 + 0.06), (0.28, 0.28, 0.06), seed=9710 + int(5 * x + 50), rb=0.03, chips=4)]
            z = z0 + 0.12
            intact = (which == "outer" and side < 0)
            nd = 4 if which == "outer" else 3
            for d in range(nd):
                last = (d == nd - 1)
                fr = snapped_top(9720 + d + int(10 * x + 50), DH, 0.16) if (last and not intact) else None
                dr = drum(R_C, DH, rng.uniform(0, 30), 9730 + 10 * d + int(20 * x + 100), flutes=10, fdepth=0.013,
                          nseg=20, frac=fr, chips=4)
                dr.translate((x + rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012), z))
                grp.append(dr)
                z += DH + 0.004
            if intact:     # carved impost block carries the surviving arch spring
                imp = blk((x, 0, z + 0.09), (0.30, 0.26, 0.09), seed=9750, rb=0.02, chips=3, jitter=False,
                          noise_amp=0.002)
                grp.append(imp)
                grp += frieze_on(imp, "-y", -0.035, 0.035, 3, margin=0.04, scale=0.7, phases=(0,), fillets=False)
                zs = z + 0.185
                xm = 0.5 * (xo + xi)
                r_in = abs(xo - xi) / 2 - 0.05
                for k in range(3):
                    a_hi, a_lo = 180 - k * 20.0, 180 - (k + 1) * 20.0
                    grp += voussoir(xm, zs, r_in, r_in + 0.30, a_lo * D2R, a_hi * D2R, 0.40, 9760 + k, carve=True)
            gx, gy = slope_tilt(x, 0.0)
            heave = (13.0 if which == "inner" else 4.0) * side
            transform_all(grp, A.rot_about((x - side * 0.28, 0, z0), (0, 1, 0), heave + math.degrees(math.atan(gx)) * 0.5))
            pcs += grp
    # ---- ruined pedestal wrapping the forearm base: inner ring burst upward, outer carved course heaved
    import arch_altar_dais as AD
    for ring_i, (r_in, r_out, n, zt_off, tilt_rng, miss) in enumerate(((1.15, 1.6, 8, 0.30, (24, 40), 0.15),
                                                                         (1.62, 2.12, 10, 0.24, (6, 14), 0.2))):
        for k in range(n):
            tha = k * 360.0 / n + (18.0 if ring_i else 0.0)
            thb = tha + 360.0 / n
            if rng.uniform() < miss:
                continue
            thm = 0.5 * (tha + thb)
            rm = 0.5 * (r_in + r_out)
            cx, cy = rm * math.cos(thm * D2R), rm * math.sin(thm * D2R)
            gz = ground(cx, cy)
            st = AD.sector_stone(r_in, r_out, tha, thb, gz - 0.25, gz + zt_off, 9900 + 20 * ring_i + k, gap=0.02,
                                 rb=0.03, step=0.6, step_z=0.6, chips=6, chip_scale=0.9, prefer=(0, (1, 1, 1)),
                                 noise_amp=0.003)
            if ring_i == 1 and k % 2 == 0:
                Rr = r_out - 0.01
                mp = A.map_cyl(Rr, 0.0)
                a0, a1 = tha * D2R, thb * D2R
                spn = (a1 - a0) * Rr
                st += A.fret_band(a0 * Rr + 0.1 * spn, a1 * Rr - 0.1 * spn, gz + 0.03, gz + 0.16,
                                  max(2, int(spn / 0.26)), mp, h=0.018, wb=0.016, wt=0.008, embed=0.01)
            rad, tan = AD.radial_tangent(thm)
            piv = (r_out * rad[0], r_out * rad[1], gz - 0.25)
            AD.tilt_pieces(st, piv, tan, rng.uniform(*tilt_rng), drop=0.0)     # inner edge lifted: burst from below
            pcs += st
    # ---- sediment and rubble draped over the base (follows the mound surface)
    def h(r, th):
        return 0.30 * (1 - A.smoothstep(0.9, 2.4, r))
    pcs.append(polar_drape(0.7, 2.5, 9, 40, h, ground_fn=ground, seed=37))
    # ---- thrown drums, voussoir segment and rubble resting on the mound
    for i in range(4):
        ang = rng.uniform(0, A.TAU)
        r_ = rng.uniform(2.4, 3.8)
        pos = np.array([math.cos(ang), math.sin(ang)]) * r_
        if abs(pos[0]) > 1.7 and abs(pos[1]) < 0.5:
            pos[1] += 0.7 * (1 if pos[1] >= 0 else -1)
        dr = drum(R_C, DH, rng.uniform(0, 30), 9800 + i, flutes=10, fdepth=0.013, nseg=20, chips=5,
                  frac=snapped_top(9810 + i, DH, 0.18) if i % 3 == 0 else None)
        lay_down([dr], pos, math.degrees(ang) + 90 + rng.uniform(-30, 30), roll=90, sink=0.05,
                 ground=ground(pos[0], pos[1]))
        pcs.append(dr)
    seg = []
    for k in range(4):
        a_lo, a_hi = (40 + k * 20.0) * D2R, (40 + (k + 1) * 20.0) * D2R
        seg += voussoir(0.0, 0.0, 0.67, 0.97, a_lo, a_hi, 0.40, 9870 + k, carve=True)
    lay_down(seg, (-0.9, 2.75), 20, roll_axis=(1, 0, 0), roll=62, tilt=10, sink=0.08, ground=ground(-0.9, 2.75))
    pcs += seg
    for i in range(10):
        sz = rng.uniform(0.05, 0.16)
        ang = rng.uniform(0, A.TAU)
        r_ = rng.uniform(1.3, 3.8)
        c = (r_ * math.cos(ang), r_ * math.sin(ang), 0)
        pcs.append(A.rest_on(A.rubble_chunk(c, (sz, sz * 0.8, sz * 0.55), rng), ground(c[0], c[1]), 0.03))
    return pcs


# =============================================================================== moss / soil pads
def pad(center, rx, ry, th, rng, sink=0.04):
    """Domed moss/soil mound (material slot 1), partly sunk: reads as a cushion, never as a flat card."""
    pts = []
    for _ in range(26):
        a = rng.uniform(0, TAU)
        rr = math.sqrt(rng.uniform(0.0, 1.0))
        dome = th * math.sqrt(max(0.0, 1 - rr * rr)) * rng.uniform(0.75, 1.1)
        pts.append([rx * rr * math.cos(a), ry * rr * math.sin(a), dome])
    for _ in range(8):
        a = rng.uniform(0, TAU)
        pts.append([rx * math.cos(a), ry * math.sin(a), -sink])
    pc = A.convex_hull_piece(pts)
    pc.transform(A.M4(A.rot_euler(0, 0, rng.uniform(0, 360)), center))
    return pc.set_mat(1)


def add_moss(name, pcs):
    """Moss/soil banked where it would gather: in the angle at the foot of standing masonry and around fallen
    stones (domed, sunk).  Tops are left to the material's moss.  Deterministic per piece."""
    rng = np.random.default_rng(sum(ord(ch) * (i + 1) for i, ch in enumerate(name)))
    stones = [p for p in pcs if len(p.F) > 30]
    out = list(pcs)
    if not stones:
        return out
    allv = np.concatenate([p.V for p in stones])
    mn, mx = allv.min(0), allv.max(0)
    n = int(np.clip((mx[0] - mn[0]) * (mx[1] - mn[1]) * 0.7, 4, 12))
    feet = allv[allv[:, 2] < 0.04]
    if len(feet):
        for i in range(n):
            q = feet[rng.integers(len(feet))]
            out.append(pad((q[0] + rng.uniform(-0.08, 0.08), q[1] + rng.uniform(-0.08, 0.08), 0.0),
                           rng.uniform(0.14, 0.32), rng.uniform(0.10, 0.24), rng.uniform(0.05, 0.11), rng))
    return out

# =============================================================================== scene
PIECES = [
    ("CFCL_Ruin_ColumnStanding", build_column_standing),
    ("CFCL_Ruin_ColumnToppled", build_column_toppled),
    ("CFCL_Ruin_WallFragment", build_wall),
    ("CFCL_Ruin_JambLeft", lambda: build_jamb(-1)[0]),
    ("CFCL_Ruin_JambRight", lambda: build_jamb(1)[0]),
    ("CFCL_Ruin_LancetArch", lambda: build_lancet()[0]),
    ("CFCL_Ruin_StairFragment", build_stair_fragment),
    ("CFCL_Ruin_RingSegment", build_ring),
    ("CFCL_Ruin_SkullShrine", build_skull_shrine),
    ("CFCL_Ruin_HandArcade", build_hand_arcade),
]

# hero camera (research 6c) used to keep the haze column / eclipse clear
HERO_C = np.array([0.0, -1.31, 0.22])
HERO_PITCH = 2.0
ECLIPSE = (np.array([3.95, 20.0, 5.25]), 2.0)
HAZE = (0.42, 0.60, 0.0, 1.0)      # coordinator: keep everything out of screen x 0.42-0.60

# proposed placements (world metres; Z = approximate ground, snap to terrain on integration)
PLACEMENTS = [
    ("CFCL_Ruin_ColumnStanding", "Ruin_SkullSeat_ColumnStanding", (-4.7, 9.9, -0.40), (0, 0, 18), 1.0),
    ("CFCL_Ruin_WallFragment", "Ruin_SkullSeat_Wall", (-5.6, 12.4, -0.45), (0, 0, 32), 1.0),
    ("CFCL_Ruin_ColumnToppled", "Ruin_HandSeat_ColumnToppled", (5.2, 10.9, -0.20), (0, 0, -24), 1.0),
    ("CFCL_Ruin_StairFragment", "Ruin_HandSeat_Stair", (3.4, 8.0, -0.35), (0, 0, 8), 1.0),
    ("CFCL_Ruin_LancetArch", "Ruin_RightFlank_LancetArch", (9.6, 13.8, -0.5), (0, 0, -38), 1.0),
    ("CFCL_Ruin_RingSegment", "Ruin_LeftNear_RingSegment_OffHero", (-8.6, 2.6, -0.6), (0, 0, 70), 1.0),
    ("CFCL_Ruin_ColumnStanding", "Ruin_RightFlank_ColumnStanding", (7.4, 4.6, -0.5), (0, 0, -60), 0.9),
    ("CFCL_Ruin_WallFragment", "Ruin_LeftFlank_WallLow", (-7.2, 5.0, -0.5), (0, 0, 75), 0.85),
    # JambLeft/JambRight are NOT placed (Codex owns the gate); see README for the optional swap transform
    # v009 worldbuilding: why the monuments are there (origin = monument origin, same yaw)
    ("CFCL_Ruin_SkullShrine", "Ruin_SkullShrine_UnderSkull", (-2.85, 9.49, -0.38), (0, 0, 33), 1.0),
    ("CFCL_Ruin_HandArcade", "Ruin_HandArcade_AroundForearm", (4.5, 10.0, -0.35), (0, 0, -22), 1.0),
]


def project(P):
    f = np.array([0, math.cos(HERO_PITCH * D2R), math.sin(HERO_PITCH * D2R)])
    u = np.array([0, -math.sin(HERO_PITCH * D2R), math.cos(HERO_PITCH * D2R)])
    r = np.array([1.0, 0, 0])
    d = P - HERO_C
    z = d @ f
    tx = math.tan(math.atan(18.0 / 28.0))
    ty = 10.125 / 28.0
    x = (d @ r) / np.maximum(z, 1e-3) / tx
    y = (d @ u) / np.maximum(z, 1e-3) / ty
    return 0.5 + 0.5 * x, 0.5 - 0.5 * y, z


def hero_check(V):
    fx, fy, z = project(V)
    vis = z > 0.1
    if not vis.any():
        return dict(in_frame=False)
    fx, fy = fx[vis], fy[vis]
    box = [float(fx.min()), float(fx.max()), float(fy.min()), float(fy.max())]
    in_frame = box[1] > 0 and box[0] < 1 and box[3] > 0 and box[2] < 1
    hx = (box[0] < HAZE[1]) and (box[1] > HAZE[0]) and (box[2] < HAZE[3]) and (box[3] > HAZE[2])
    ec, er = ECLIPSE
    cx, cy, cz = project(ec[None, :])
    rad = (er / float(cz[0])) / math.tan(math.atan(18.0 / 28.0)) * 0.5
    m = 0.03
    nx = np.clip(float(cx[0]), box[0], box[1])
    ny = np.clip(float(cy[0]), box[2], box[3])
    ecl = math.hypot((nx - float(cx[0])), (ny - float(cy[0])) * 9 / 16) < rad + m
    # haze test on actual projected points (bbox is conservative)
    pts_h = int(np.sum((fx > HAZE[0]) & (fx < HAZE[1]) & (fy > HAZE[2]) & (fy < HAZE[3])))
    d = np.hypot(fx - float(cx[0]), (fy - float(cy[0])) * 9 / 16)
    pts_e = int(np.sum(d < rad + m))
    return dict(in_frame=bool(in_frame), frame_bbox=[round(b, 3) for b in box], bbox_hits_haze=bool(hx),
                bbox_near_eclipse=bool(ecl), verts_in_haze_column=pts_h, verts_within_eclipse_margin=pts_e)


# world-scale cameras of the main build (world = env*4.6 + (0,0,1.94)) expressed in env units
CAMS_ENV = {"god": np.array([0.0, -26.0, 30.0 - 1.94]) / 4.6, "hero": np.array([0.0, -30.0, 9.0 - 1.94]) / 4.6}


def board_occlusion(V, half=2.375, z_b=-0.42):
    """Vertices that would hide part of the board's top face from the god / hero cameras."""
    out = {}
    for nm, C in CAMS_ENV.items():
        dz = V[:, 2] - C[2]
        ok = (V[:, 2] > z_b) & (dz < -1e-6)
        t = np.where(ok, (z_b - C[2]) / np.where(ok, dz, -1.0), 0.0)
        H = C[None, :2] + t[:, None] * (V[:, :2] - C[None, :2])
        occ = ok & (t > 1.0) & (np.abs(H[:, 0]) <= half) & (np.abs(H[:, 1]) <= half)
        out["board_occluding_verts_" + nm] = int(occ.sum())
    return out


def main():
    R.reset_scene()
    scn = bpy.context.scene
    root = bpy.data.collections.new(ASSET)
    scn.collection.children.link(root)
    stone = M.get("AncientStone")       # shared name CFCL_AncientStone -> binds to the promoted material
    moss = M.get("Moss")
    soil = M.get("Basalt", moss=0.8)    # rubble/soil core seen through joints
    objs = {}
    x = 0.0
    lineup = {}
    meshes = {}
    for name, fn in PIECES:
        t0 = time.time()
        pcs = fn()
        acc = A.Acc()
        acc.add(pcs)
        allv = np.concatenate([p.V for p in pcs])
        w = allv[:, 0].max() - allv[:, 0].min()
        pcs = add_moss(name, pcs)
        acc = A.Acc()
        acc.add(pcs)
        ob = acc.build(name, root, [stone, moss, soil], sharp_deg=34)
        try:
            M.bake_curvature(ob)
        except Exception as e:
            log("curvature bake failed", name, e)
        x += w / 2 + 0.8
        ob.location = (x - (allv[:, 0].max() + allv[:, 0].min()) / 2, 0, 0)
        lineup[name] = list(ob.location)
        x += w / 2 + 0.8
        objs[name] = ob
        meshes[name] = allv
        log(name, "tris", R.tri_count([ob]), f"{time.time() - t0:.1f}s")
    bpy.context.view_layer.update()
    info = []
    for name, ob in objs.items():
        V = meshes[name]
        mn, mx = V.min(0), V.max(0)
        info.append(dict(name=name, dims=[round(float(v), 3) for v in (mx - mn)],
                         local_bounds_min=[round(float(v), 3) for v in mn],
                         local_bounds_max=[round(float(v), 3) for v in mx],
                         tris=R.tri_count([ob]), materials=[m.name for m in ob.data.materials if m]))
    # arrangement + hero-camera clearance
    placements = []
    checks = {}
    for src, nm, loc, rot, sc in PLACEMENTS:
        V = meshes[src] * sc
        Mx = A.M4(A.rot_euler(*rot), loc)
        Vw = V @ Mx[:3, :3].T + Mx[:3, 3]
        checks[nm] = hero_check(Vw)
        checks[nm].update(board_occlusion(Vw))
        placements.append(dict(source=src, name=nm, location=[float(v) for v in loc],
                               rotation_deg=[float(v) for v in rot], scale=[sc, sc, sc]))
    os.makedirs(ADIR, exist_ok=True)
    arr = dict(asset=ASSET, blend=f"{ASSET}_v{VER:03d}.blend", placements=placements)
    rep = dict(version=VER, objects=info, hero_checks=checks, lineup_locations=lineup)
    R.write_json(os.path.join(RDIR, f"{TAG}_report.json"), rep)
    log("hero checks", json.dumps(checks))
    if not NOSAVE:
        path = os.path.join(ADIR, f"{ASSET}_v{VER:03d}.blend")
        if os.path.exists(path):
            log("version exists, not overwriting", path)
        else:
            bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
            R.write_json(os.path.join(ADIR, "arrangement.json"), arr)
            log("saved", path)
    if NORENDER:
        return
    # ------------------------------------------------------------------ lineup renders
    R.setup_render(scn, "EEVEE", (1280, 720), 16 if FAST else 40)
    R.setup_world(scn)
    pc = bpy.data.collections.new("PREVIEW_ONLY")
    scn.collection.children.link(pc)
    R.standard_lights(scale=4.0, lava=False, collection=pc)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(x / 2, 0, -0.01))
    g = bpy.context.active_object
    g.name = "PREVIEW_Ground"
    for c in g.users_collection:
        c.objects.unlink(g)
    pc.objects.link(g)
    M.assign(g, "Basalt", moss=0.0)
    cx = x / 2
    R.render_to(os.path.join(RDIR, f"{TAG}_lineup.png"),
                R.camera("CAM_lineup", (cx, -cx * 1.75 - 3, cx * 0.42), (cx, 0, 1.0), 30, collection=pc))
    R.render_to(os.path.join(RDIR, f"{TAG}_lineup_back.png"),
                R.camera("CAM_lineup_b", (cx + 3, cx * 1.7 + 4, cx * 0.35), (cx, 0, 1.0), 30, collection=pc))
    shots = [("CFCL_Ruin_ColumnStanding", (-3.2, -4.2, 2.4), 1.3, 32), ("CFCL_Ruin_ColumnToppled", (1.0, -5.5, 3.0), 0.5, 30),
             ("CFCL_Ruin_WallFragment", (-2.0, -6.5, 2.6), 1.3, 32), ("CFCL_Ruin_JambLeft", (1.5, -6.0, 2.2), 1.8, 30),
             ("CFCL_Ruin_LancetArch", (-2.5, -6.5, 2.0), 2.0, 30), ("CFCL_Ruin_StairFragment", (-3.0, -4.0, 2.5), 0.6, 30),
             ("CFCL_Ruin_RingSegment", (-2.5, -5.5, 1.8), 1.4, 30), ("CFCL_Ruin_JambRight", (-1.5, -6.0, 2.2), 1.8, 30),
             ("CFCL_Ruin_SkullShrine", (-5.0, -7.5, 4.2), -0.3, 30), ("CFCL_Ruin_HandArcade", (3.0, -8.5, 3.6), 0.6, 30)]
    if FAST:
        shots = shots[:3]
    for name, off, tz, lens in shots:
        loc = np.array(lineup[name])
        R.render_to(os.path.join(RDIR, f"{TAG}_{name.replace('CFCL_Ruin_', '')}.png"),
                    R.camera("CAM_" + name, tuple(loc + np.array(off)), (loc[0], loc[1], tz), lens, collection=pc))
    log("done")


if __name__ == "__main__":
    main()
