"""CFCL_Arch_FarRuins - low-poly, pale, low-contrast distant ruin silhouettes (30-80 m) of the same
civilisation, so the background reads as a larger fallen court.  <= 8k tris each.

Run:  python lib/run_blender.py scripts/arch_far_ruins.py --timeout 1200 -- --ver 1 [--norender] [--nosave]

Silhouette first: broken stepped tops, real window/arch openings (fog shows through), collapsed spans,
fallen members lying where they fell.  Coarse masonry courses only (no carving: it would alias at 50 m).
Pieces (origin = ground-contact centre, +Z up):
  CFCL_Far_GreatArch      12 m pointed arch on coursed piers, right half collapsed after 5 voussoirs
  CFCL_Far_TowerSquare    24 m stepped square tower, lancet openings, top broken diagonally
  CFCL_Far_TowerRound     18 m round tower shell, breached on one side, stepped broken crown
  CFCL_Far_Colonnade      stylobate + 7 columns at different broken heights, 2-bay architrave, 1 fallen column
  CFCL_Far_BridgeRuin     3-span bridge on tall piers, middle span collapsed, broken pier heads
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
from arch_lib import D2R, TAU  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = int(ARGV[ARGV.index("--ver") + 1]) if "--ver" in ARGV else 1
NORENDER = "--norender" in ARGV
NOSAVE = "--nosave" in ARGV
ASSET = "CFCL_Arch_FarRuins"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "arch")
TAG = f"far_iter{VER:02d}"
T0 = time.time()


def log(*a):
    print(f"[arch_far {time.time() - T0:6.1f}s]", *a, flush=True)


def far_material():
    m = bpy.data.materials.get("CFCL_Arch_FarStone")
    if m:
        return m
    m = M.get("AncientStone", moss=0.12, scale=4.0).copy()
    m.name = "CFCL_Arch_FarStone"
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    lk = b.inputs["Base Color"].links
    if lk:
        src = lk[0].from_socket
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Saturation"].default_value = 0.40     # low contrast, pale, desaturated
        hs.inputs["Value"].default_value = 1.85
        nt.links.new(src, hs.inputs["Color"])
        nt.links.new(hs.outputs["Color"], b.inputs["Base Color"])
    # aerial-perspective lift: a faint haze-coloured emission raises the shadow side so the silhouettes stay
    # low-contrast at 30-80 m even before fog (remove if the scene fog already does this)
    if b.inputs.get("Emission Color") is not None:
        for l in list(b.inputs["Emission Color"].links):
            nt.links.remove(l)
        b.inputs["Emission Color"].default_value = (0.36, 0.36, 0.33, 1.0)
        for l in list(b.inputs["Emission Strength"].links):
            nt.links.remove(l)
        b.inputs["Emission Strength"].default_value = 0.35
    # flatten micro-relief: weaken any bump so distant faces do not sparkle
    for n in nt.nodes:
        if n.type == 'BUMP':
            n.inputs["Strength"].default_value = n.inputs["Strength"].default_value * 0.3
    return m


def B(center, half, rot=(0, 0, 0), seed=0, rb=0.22, step=6.0, chips=5, **kw):
    seed = abs(int(seed)) + 1
    rng = np.random.default_rng(seed)
    half = np.asarray(half, float) * (1 + rng.uniform(-0.03, 0.03, 3))
    Mx = A.M4(A.rot_euler(*rot), center)
    rb = min(rb, 0.45 * float(np.min(half)))
    return A.make_block(half, rb=rb, step=step, chips=chips, chip_scale=kw.pop("chip_scale", 5.0), rng=rng,
                        mapping=A.map_affine(Mx), seed=seed, noise_amp=0.0, rb_var=0.9, **kw)


def jag(seed, amp, base, slope=(0.0, 0.0), freq=0.35):
    def f(x, y):
        return base + slope[0] * x + slope[1] * y + amp * A.fbm2(x, y, freq, 2, seed=seed)
    return f


# =============================================================================== pieces
def great_arch():
    pcs = []
    S, T, D = 12.0, 1.6, 3.0           # span, ring thickness, depth
    pw, ph = 3.2, 10.0
    for side in (-1, 1):
        xin, xout = side * S / 2, side * (S / 2 + pw)
        z = 0.0
        k = 0
        while z < ph - 0.1:
            ch = min(1.25 + 0.15 * ((k * 7) % 3), ph - z)
            pcs.append(B((0.5 * (xin + xout), 0, z + ch / 2), (pw / 2 - 0.03, D / 2 - 0.03, ch / 2 - 0.03),
                         seed=10 * side + k, rot=(0, 0, 0.6 * ((k % 3) - 1))))
            z += ch
            k += 1
        pcs.append(B((0.5 * (xin + xout) - side * 0.2, 0, ph + 0.35), (pw / 2 + 0.35, D / 2 + 0.25, 0.35),
                     seed=50 + side))
    zs = ph + 0.7
    n = 9
    seg = 60.0 / n
    for side in (-1, 1):
        keep = n - 1 if side < 0 else 5
        cx = -side * S / 2
        for k in range(keep):
            if side < 0:
                a_hi, a_lo = 180 - k * seg, 180 - (k + 1) * seg
            else:
                a_lo, a_hi = k * seg, (k + 1) * seg
            rm = S + T / 2
            g = 0.03 / rm
            ex = 0.5 * ((a_hi - a_lo) * D2R - 2 * g) * rm
            ey = T / 2 - 0.03
            mp = A.map_arch(cx, zs, S + 0.03, S + T - 0.03, a_lo * D2R + g, a_hi * D2R - g, 0.0, ex, ey)
            p = A.make_block((ex, ey, D / 2 - 0.03), rb=0.1, step=6.0, chips=0, mapping=mp, seed=100 + k, noise_amp=0)
            if side < 0 and k >= keep - 2:      # the last left voussoirs have sagged inward
                p.transform(A.rot_about((cx + S * math.cos(a_hi * D2R), 0, zs + S * math.sin(a_hi * D2R)),
                                        (0, 1, 0), 2.5 * (k - keep + 3)))
            pcs.append(p)
    # fallen voussoirs of the right half at its foot
    rng = np.random.default_rng(7)
    for i in range(4):
        p = B((S * 0.2 + i * 1.7, -2.5 - rng.uniform(0, 2.5), 0.8), (1.0, 0.8, 1.4),
              rot=(rng.uniform(-20, 20), 90 + rng.uniform(-15, 15), rng.uniform(0, 180)), seed=200 + i)
        A.rest_on(p, 0.0, 0.25)
        pcs.append(p)
    return pcs


def tower_round():
    pcs = []
    Ro, Ri = 3.0, 2.25
    n = 14
    rng = np.random.default_rng(40)
    courses = [(0.0, 3.0), (3.0, 6.5), (6.5, 10.0), (10.0, 13.5), (13.5, 16.0), (16.0, 18.0)]
    for k in range(n):
        th0 = k * 360.0 / n
        th1 = th0 + 360.0 / n
        thm = 0.5 * (th0 + th1)
        # break height: stepped crown, deep breach facing ~-60 deg
        breach = abs(((thm - 300 + 180) % 360) - 180)
        hmax = 18.0 - 3.0 * (0.5 + 0.5 * math.sin(thm * D2R * 2.0)) - 9.0 * max(0, 1 - breach / 50.0)
        hmax += rng.uniform(-0.8, 0.8)
        for ci, (z0, z1) in enumerate(courses):
            if z0 > hmax - 0.5:
                break
            zt = min(z1, hmax)
            off = (360.0 / n) * 0.5 * (ci % 2)
            a0, a1 = (th0 + off + 0.25) * D2R, (th1 + off - 0.25) * D2R
            prof = [(Ri, z0 + 0.03), (Ro, z0 + 0.03), (Ro, zt - 0.03), (Ri, zt - 0.03)]
            pcs.append(A.sweep_sector(prof, a0, a1, 3, end_chamfer=0.08))
    # corbel ring band (partial, where wall survives)
    for k in range(n):
        th0 = k * 360.0 / n
        if abs((((th0 + 13) - 300 + 180) % 360) - 180) < 60:
            continue
        pcs.append(A.sweep_sector([(Ro - 0.1, 9.6), (Ro + 0.35, 9.6), (Ro + 0.35, 10.1), (Ro - 0.1, 10.1)],
                                  (th0 + 0.3) * D2R, (th0 + 360.0 / n - 0.3) * D2R, 3, end_chamfer=0.05))
    for i in range(7):
        p = B((math.cos(-60 * D2R) * (Ro + rng.uniform(1.0, 4.0)) + rng.uniform(-1, 1),
               math.sin(-60 * D2R) * (Ro + rng.uniform(1.0, 4.0)) + rng.uniform(-1, 1), 0.5),
              rng.uniform(0.4, 0.9, 3), rot=rng.uniform(-30, 30, 3), seed=400 + i)
        A.rest_on(p, 0.0, 0.15)
        pcs.append(p)
    return pcs


def colonnade():
    pcs = []
    L, Wd = 24.0, 4.2
    rng = np.random.default_rng(50)
    # stylobate (3 long stones, broken off at the +x end)
    for i, (xa, xb) in enumerate(((-12, -4.2), (-4.15, 3.6), (3.65, 10.8))):
        ft = jag(60 + i, 0.15, 0.6, slope=(-0.08 if i == 2 else 0, 0)) if i == 2 else None
        pcs.append(B(((xa + xb) / 2, 0, 0.6), ((xb - xa) / 2, Wd / 2, 0.6), seed=500 + i, fracture_top=ft,
                     frac_step=1.5))
    heights = [11.0, 11.0, 11.0, 7.2, 4.1, 8.6, 2.6]
    xs = np.linspace(-10.5, 8.8, 7)
    for i, (x, h) in enumerate(zip(xs, heights)):
        z = 1.2
        dh = 1.8
        nd = int(math.ceil(h / dh))
        for d in range(nd):
            hh = min(dh, h - d * dh)
            frac = None
            if d == nd - 1 and h < 11.0:
                frac = (lambda hh=hh, s=i: (lambda xx, yy: hh - 0.6 + 0.5 * xx / 0.8 + 0.15 * A.fbm2(xx, yy, 1.2, 2, seed=s)))()
            drum = A.lathe([(0, 0), (0.78, 0), (0.80, 0.04), (0.80, hh - 0.04), (0.78, hh)] +
                           ([(0.5, hh), (0.2, hh)] if frac else []) + [(0, hh)], 10,
                           deform=(lambda Rr, TH, Z, k, f=frac, hh=hh:
                                   (Rr, np.where(Rr < 0.77, f(Rr * np.cos(TH), Rr * np.sin(TH)), np.minimum(Z, f(Rr * np.cos(TH), Rr * np.sin(TH)))) if f else Z)),
                           th0=rng.uniform(0, 0.6))
            drum.translate((x + rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), z))
            pcs.append(drum)
            z += hh + 0.02
        if h >= 11.0:   # capital block
            pcs.append(B((x, 0, z + 0.4), (1.15, 1.15, 0.4), seed=520 + i))
    # architrave over the first two bays
    zt = 1.2 + 11.0 + 0.06 + 0.8
    pcs.append(B(((xs[0] + xs[1]) / 2, 0, zt + 0.55), ((xs[1] - xs[0]) / 2 + 1.1, 1.05, 0.55), seed=540))
    pcs.append(B(((xs[1] + xs[2]) / 2 + 0.3, 0, zt + 0.55), ((xs[2] - xs[1]) / 2 + 0.7, 1.05, 0.55), seed=541,
                 fracture_top=None))
    # fallen column lying in front of the broken ones, its architrave piece broken beside it
    for d in range(4):
        drum = A.lathe([(0, 0), (0.8, 0), (0.8, 1.75), (0, 1.75)], 10)
        drum.transform(A.M4(A.rot_euler(90 + rng.uniform(-4, 4), 0, 70 + rng.uniform(-6, 6)),
                            (6.0 + d * 1.0 * math.cos(-20 * D2R), -4.5 + d * 1.8 * math.sin(-20 * D2R), 0)))
        A.rest_on(drum, 0.0, 0.1)
        pcs.append(drum)
    p = B((3.0, -5.5, 0.5), (2.4, 1.0, 0.55), rot=(0, 8, 25), seed=560)
    A.rest_on(p, 0.0, 0.2)
    pcs.append(p)
    return pcs


def bridge():
    pcs = []
    rng = np.random.default_rng(70)
    span, pw, Dp = 10.0, 3.0, 4.6
    pier_x = [-1.5 * span - pw, -0.5 * span - pw / 2, 0.5 * span + pw / 2, 1.5 * span + pw]
    pier_x = [-16.5, -6.5, 6.5, 16.5]
    deck_z = 14.0
    top = []
    for i, x in enumerate(pier_x):
        h = deck_z - (0.0 if i in (0, 3) else rng.uniform(1.5, 3.5))
        z = -6.0
        while z < h - 0.2:
            ch = min(3.4, h - z)
            ft = jag(80 + i, 0.4, ch / 2 - 0.4, slope=(0.3, 0)) if z + ch >= h - 0.1 and i in (1, 2) else None
            pcs.append(B((x, 0, z + ch / 2), (pw / 2 - 0.04 * (z / 20), Dp / 2, ch / 2 - 0.03), seed=600 + i * 20 + int(z),
                         fracture_top=ft, frac_step=1.2))
            z += ch
        top.append(z)
    # arches: outer two spans standing (pointed), middle span collapsed
    for a, (xa, xb) in enumerate(((pier_x[0], pier_x[1]), (pier_x[2], pier_x[3]))):
        S = (xb - xa) - pw
        cxm = 0.5 * (xa + xb)
        zs = deck_z - 0.866 * (S + 1.17) + 0.05     # extrados crown meets the deck
        n = 4
        seg = 60.0 / n
        for side in (-1, 1):
            cx = cxm - side * S / 2
            for k in range(n):
                if side < 0:
                    a_hi, a_lo = 180 - k * seg, 180 - (k + 1) * seg
                else:
                    a_lo, a_hi = k * seg, (k + 1) * seg
                rm = S + 0.6
                g = 0.03 / rm
                ex = 0.5 * ((a_hi - a_lo) * D2R - 2 * g) * rm
                mp = A.map_arch(cx, zs, S + 0.03, S + 1.17, a_lo * D2R + g, a_hi * D2R - g, 0.0, ex, 0.55)
                pcs.append(A.make_block((ex, 0.55, Dp / 2 - 0.1), rb=0.08, step=8.0, chips=0, mapping=mp, seed=700 + k,
                                        noise_amp=0))
        # spandrel walls fill the haunches between the piers, the arch back and the deck
        for side in (-1, 1):
            xp = (xa + pw / 2) if side < 0 else (xb - pw / 2)
            for j, (f0, f1, fz) in enumerate(((0.0, 0.18, 0.607), (0.18, 0.36, 0.78))):
                x0 = xp + (-side) * f0 * S
                x1 = xp + (-side) * f1 * S
                z0_sp = zs + fz * S
                if z0_sp >= deck_z - 0.2:
                    continue
                pcs.append(B((0.5 * (x0 + x1), 0, 0.5 * (z0_sp + deck_z)),
                             (abs(x1 - x0) / 2, Dp / 2 - 0.15, 0.5 * (deck_z - z0_sp)),
                             seed=740 + a * 4 + j * 2 + (side > 0), rb=0.08))
        # deck + parapet over the standing spans
        pcs.append(B((cxm, 0, deck_z + 0.4), ((xb - xa) / 2 + 0.2, Dp / 2 + 0.2, 0.4), seed=750 + a, rb=0.1))
        for s in (-1, 1):
            ft = jag(760 + a + s, 0.2, 0.3, slope=(0.08 * (1 if a == 0 else -1), 0))
            pcs.append(B((cxm, s * (Dp / 2 - 0.1), deck_z + 1.2), ((xb - xa) / 2, 0.3, 0.45), seed=770 + a * 3 + s,
                         fracture_top=ft, frac_step=3.0))
    # broken deck stubs cantilevering into the collapsed middle span
    for s, x in ((-1, pier_x[1]), (1, pier_x[2])):
        p = B((x - s * 2.2, 0, deck_z + 0.4), (2.0, Dp / 2, 0.4), seed=790 + s,
              face_noise=[(0, -s, lambda a, b: 0.4 * A.fbm2(a, b, 0.6, 2, seed=5))])
        p.transform(A.rot_about((x, 0, deck_z), (0, 1, 0), 4.0 * s))
        pcs.append(p)
    return pcs


# =============================================================================== v005: monumental ruin silhouettes
def tower_square():
    """Stepped tower read as a ruin, not a box: stepped corner buttresses, setbacks, the front-left corner of the
    upper stages collapsed (walls end jagged, debris fan below), the upper shaft settling 2 deg toward the breach,
    a broken crown of two uneven stubs and one leaning chunk."""
    pcs = []
    t = 0.9
    stages = [(0.0, 6.0, 6.0), (6.0, 11.5, 5.6), (11.5, 16.5, 5.2), (16.5, 21.0, 4.8), (21.0, 24.0, 4.4)]
    rng = np.random.default_rng(31)
    lean = A.rot_about((0, 0, 11.5), (1.0, -0.6, 0), 2.2)
    for si, (z0, z1, w) in enumerate(stages):
        h = z1 - z0
        hw = w / 2
        stage = []
        if si < 2:
            stage.append(B((0, 0, z0 + h / 2), (hw, hw, h / 2 - 0.05), seed=si, step=8.0))
            for sx in (-1, 1):            # stepped corner buttresses (two setbacks)
                for sy in (-1, 1):
                    for k, (o, s_, hh) in enumerate(((0.55, 0.85, 0.85), (0.35, 0.6, 0.55))):
                        zc = z0 + h * hh / 2 if k == 0 else z0 + h * 0.85 + h * 0.3 / 2
                        hz = h * hh / 2 if k == 0 else h * 0.15
                        stage.append(B((sx * (hw + o - 0.25), sy * (hw + o - 0.25), zc), (s_, s_, hz),
                                       seed=40 + si * 10 + k + (sx > 0) * 2 + (sy > 0) * 4, step=8.0))
        else:
            top_f = None
            if si == len(stages) - 1:
                top_f = jag(30, 0.35, h / 2 - 0.4, slope=(-0.35, 0.25))
            for wall in range(4):
                ang = wall * 90.0
                Rz = A.rot_euler(0, 0, ang)
                # the front (-y, wall 0) and left (-x, wall 3) walls are broken away toward their shared corner
                tf = top_f
                if si >= 3 and wall in (0, 3):
                    tf = jag(33 + wall, 0.3, h / 2 - (1.4 if si == 3 else 1.8), slope=((0.5 if wall == 0 else -0.5), 0.0))
                if wall % 2 == 0:
                    ow = 1.1 if si < 4 else 1.4
                    for sgn in (-1, 1):
                        if wall == 0 and sgn < 0 and si >= 3:
                            continue          # the collapsed corner
                        cxl = sgn * (ow / 2 + (hw - ow / 2) / 2)
                        c = Rz @ np.array([cxl, -hw + t / 2, z0 + h / 2])
                        stage.append(B(c, ((hw - ow / 2) / 2 - 0.03, t / 2, h / 2 - 0.05), rot=(0, 0, ang),
                                       seed=100 + si * 10 + wall * 2 + (sgn > 0), fracture_top=tf, frac_step=1.6))
                    if si in (2, 3) and not (wall == 0 and si == 3):
                        for sgn in (-1, 1):   # pointed head
                            c = Rz @ np.array([sgn * ow / 4, -hw + t / 2, z1 - 0.9])
                            stage.append(B(c, (ow / 4 + 0.15, t / 2 - 0.02, 0.85), rot=(0, sgn * -28, ang),
                                           seed=150 + si * 10 + wall + sgn))
                else:
                    span = hw - t
                    xs = (0.0, span) if not (wall == 3 and si >= 3) else (0.9, span - 0.9)
                    c = Rz @ np.array([xs[0], -hw + t / 2, z0 + h / 2])
                    stage.append(B(c, (xs[1], t / 2, h / 2 - 0.05), rot=(0, 0, ang), seed=180 + si * 10 + wall,
                                   fracture_top=tf, frac_step=1.6))
            if si == len(stages) - 1:     # a crown chunk leaning out over the void, about to fall
                chunk = B((hw - 0.6, hw - 0.4, z1 + 0.9), (0.7, 0.45, 1.0), seed=360, step=8.0)
                chunk.transform(A.rot_about((hw, hw - 0.4, z1), (0.3, 1.0, 0), 16.0))
                stage.append(chunk)
        if si in (1, 3):                  # string courses (the upper one broken off on the collapsed side)
            if si == 1:
                stage.append(B((0, 0, z1 + 0.15), (hw + 0.3, hw + 0.3, 0.2), seed=60 + si, step=8.0))
            else:
                stage.append(B((0.7, 0.7, z1 + 0.15), (hw - 0.4, hw - 0.4, 0.2), seed=60 + si, step=8.0))
        if si >= 2:
            transform_all(stage, lean)
        pcs += stage
    for i in range(10):                   # debris fan below the collapsed corner, biggest blocks nearest
        d = rng.uniform(0.5, 7.0)
        a = math.radians(225 + rng.uniform(-35, 35))
        s_ = (1.4 - 0.1 * d) * rng.uniform(0.6, 1.0)
        p = B((math.cos(a) * (3.5 + d), math.sin(a) * (3.5 + d), 1.0), (s_, s_ * 0.8, s_ * 0.6),
              rot=rng.uniform(-35, 35, 3), seed=300 + i, step=8.0)
        A.rest_on(p, 0.0, 0.25)
        pcs.append(p)
    return pcs


def transform_all(pieces, Mx):
    for p in pieces:
        p.transform(Mx)
    return pieces


def tower_round_v5():
    pcs = tower_round()
    rng = np.random.default_rng(41)
    for k, ang in enumerate((40.0, 130.0, 215.0)):       # stepped buttress ribs (not on the breach side)
        a = math.radians(ang)
        for j, (z0, z1, d, wdt) in enumerate(((0.0, 7.0, 0.55, 0.55), (7.0, 10.5, 0.38, 0.4))):
            c = (math.cos(a) * (3.0 + d * 0.8), math.sin(a) * (3.0 + d * 0.8), 0.5 * (z0 + z1))
            pcs.append(B(c, (d, wdt, 0.5 * (z1 - z0)), rot=(0, 0, ang), seed=420 + 3 * k + j, step=8.0))
    seg = A.sweep_sector([(2.25, 0.0), (3.0, 0.0), (3.0, 2.6), (2.25, 2.6)], math.radians(150), math.radians(176), 3,
                         end_chamfer=0.08)
    seg.translate((0, 0, 15.2))
    seg.transform(A.rot_about((math.cos(math.radians(163)) * 3.0, math.sin(math.radians(163)) * 3.0, 15.2),
                              (-math.sin(math.radians(163)), math.cos(math.radians(163)), 0), 11.0))
    pcs.append(seg)
    return pcs


def great_arch_v5():
    pcs = great_arch()
    S, pw = 12.0, 3.2
    for side in (-1, 1):                 # stepped buttresses against the outer faces of the piers
        x_out = side * (S / 2 + pw)
        for j, (h, d) in enumerate(((7.5, 1.3), (4.0, 0.8))):
            pcs.append(B((x_out + side * (d - 0.2), 0, h / 2 + (0 if j == 0 else 7.5 - 0.2)), (d, 1.2, h / 2),
                         seed=520 + j + (side > 0) * 2, step=8.0))
    blk_ = B((S / 2 + pw / 2 + 0.6, 0.0, 11.5), (1.0, 1.1, 0.9), seed=530, step=8.0)   # pier-top block sliding off
    blk_.transform(A.rot_about((S / 2 + pw, 0, 10.7), (0, 1, 0), -18.0))
    pcs.append(blk_)
    return pcs


def colonnade_v5():
    pcs = colonnade()
    rng = np.random.default_rng(51)
    # one column leaning 9 deg against the architrave's broken end, and a split architrave block propped diagonally
    z = 1.2
    stack = []
    for d in range(4):
        dr = A.lathe([(0, 0), (0.78, 0), (0.8, 0.04), (0.8, 1.74), (0.78, 1.78), (0, 1.78)], 10)
        dr.translate((9.6, -1.6, z))
        stack.append(dr)
        z += 1.8
    transform_all(stack, A.rot_about((9.6, -1.6, 1.2), (1, 0.3, 0), -9.0))
    pcs += stack
    beam = B((4.5, -2.8, 2.2), (2.6, 0.95, 0.5), seed=560, step=8.0)
    beam.transform(A.rot_about((2.0, -2.8, 0.0), (0, 1, 0), -32.0))
    A.rest_on(beam, 0.0, 0.1)
    pcs.append(beam)
    return pcs


def bridge_v5():
    pcs = bridge()
    Dp = 4.6
    for i, x in enumerate((-6.5, 6.5)):           # cutwater buttresses on the upstream face of the inner piers
        for s in (-1,):
            pcs.append(B((x, s * (Dp / 2 + 0.6), 1.5), (1.05, 1.05, 7.0), rot=(0, 0, 45), seed=640 + 2 * i + (s > 0),
                         step=8.0))
    frag = B((-2.6, 0.0, 12.6), (1.6, 2.1, 0.4), seed=650, step=8.0)   # a deck slab hanging from its broken stub
    frag.transform(A.rot_about((-4.2, 0.0, 14.0), (0, 1, 0), 28.0))
    pcs.append(frag)
    return pcs



PIECES = [
    ("CFCL_Far_GreatArch", great_arch_v5),
    ("CFCL_Far_TowerSquare", tower_square),
    ("CFCL_Far_TowerRound", tower_round_v5),
    ("CFCL_Far_Colonnade", colonnade_v5),
    ("CFCL_Far_BridgeRuin", bridge_v5),
]

HERO_C = np.array([0.0, -1.31, 0.22])
HERO_PITCH = 2.0
ECLIPSE = (np.array([3.95, 20.0, 5.25]), 2.0)
HAZE = (0.42, 0.60, 0.0, 1.0)      # coordinator: keep everything out of screen x 0.42-0.60
PLACEMENTS = [
    ("CFCL_Far_GreatArch", "Far_GreatArch_Left", (-24.0, 46.0, -3.0), (0, 0, 18), 1.0),
    ("CFCL_Far_TowerSquare", "Far_TowerSquare_Right", (31.0, 54.0, -4.0), (0, 0, -12), 1.0),
    ("CFCL_Far_TowerRound", "Far_TowerRound_RightFar", (42.0, 74.0, -6.0), (0, 0, 40), 1.0),
    ("CFCL_Far_Colonnade", "Far_Colonnade_LeftFar", (-40.0, 62.0, -4.0), (0, 0, 28), 1.0),
    ("CFCL_Far_BridgeRuin", "Far_Bridge_UnderEclipse", (23.0, 78.0, -12.0), (0, 0, 62), 1.0),
]


def project(P):
    f = np.array([0, math.cos(HERO_PITCH * D2R), math.sin(HERO_PITCH * D2R)])
    u = np.array([0, -math.sin(HERO_PITCH * D2R), math.cos(HERO_PITCH * D2R)])
    d = P - HERO_C
    z = d @ f
    x = d[:, 0] / np.maximum(z, 1e-3) / (18.0 / 28.0)
    y = (d @ u) / np.maximum(z, 1e-3) / (10.125 / 28.0)
    return 0.5 + 0.5 * x, 0.5 - 0.5 * y, z


def hero_check(V):
    fx, fy, z = project(V)
    vis = z > 0.1
    fx, fy = fx[vis], fy[vis]
    inside = (fx > 0) & (fx < 1) & (fy > 0) & (fy < 1)
    ec, er = ECLIPSE
    cx, cy, cz = project(ec[None, :])
    rad = (er / float(cz[0])) / (18.0 / 28.0) * 0.5
    d = np.hypot(fx - float(cx[0]), (fy - float(cy[0])) * 9 / 16)
    return dict(verts_in_frame=int(inside.sum()),
                frame_bbox=[round(float(fx.min()), 3), round(float(fx.max()), 3), round(float(fy.min()), 3),
                            round(float(fy.max()), 3)],
                verts_in_haze_column=int(np.sum((fx > HAZE[0]) & (fx < HAZE[1]) & (fy > HAZE[2]) & (fy < HAZE[3]))),
                verts_within_eclipse_margin=int(np.sum(d < rad + 0.03)))


def main():
    R.reset_scene()
    scn = bpy.context.scene
    root = bpy.data.collections.new(ASSET)
    scn.collection.children.link(root)
    mat = far_material()
    objs, meshes, info, lineup = {}, {}, [], {}
    x = 0.0
    for name, fn in PIECES:
        pcs = fn()
        acc = A.Acc()
        acc.add(pcs)
        V = np.concatenate([p.V for p in pcs])
        mn, mx = V.min(0), V.max(0)
        # origin = ground contact centre: recentre xy, z=0 stays the ground
        ctr = np.array([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, 0.0])
        for p in pcs:
            p.translate(-ctr)
        V = V - ctr
        ob = acc.build(name, root, mat, sharp_deg=30)
        w = mx[0] - mn[0]
        x += w / 2 + 4
        ob.location = (x, 0, 0)
        lineup[name] = [x, 0, 0]
        x += w / 2 + 4
        objs[name] = ob
        meshes[name] = V
        info.append(dict(name=name, dims=[round(float(v), 2) for v in (V.max(0) - V.min(0))],
                         local_bounds_min=[round(float(v), 2) for v in V.min(0)],
                         local_bounds_max=[round(float(v), 2) for v in V.max(0)],
                         tris=R.tri_count([ob]), materials=[m.name for m in ob.data.materials if m]))
        log(name, "tris", info[-1]["tris"], "dims", info[-1]["dims"])
    checks, placements = {}, []
    for src, nm, loc, rot, sc in PLACEMENTS:
        Mx = A.M4(A.rot_euler(*rot), loc)
        Vw = meshes[src] * sc @ Mx[:3, :3].T + Mx[:3, 3]
        checks[nm] = hero_check(Vw)
        placements.append(dict(source=src, name=nm, location=[float(v) for v in loc], rotation_deg=[float(v) for v in rot],
                               scale=[sc, sc, sc]))
    log("hero checks", json.dumps(checks))
    R.write_json(os.path.join(RDIR, f"{TAG}_report.json"), dict(version=VER, objects=info, hero_checks=checks,
                                                                   lineup_locations=lineup))
    if not NOSAVE:
        os.makedirs(ADIR, exist_ok=True)
        path = os.path.join(ADIR, f"{ASSET}_v{VER:03d}.blend")
        if not os.path.exists(path):
            bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
            R.write_json(os.path.join(ADIR, "arrangement.json"),
                         dict(asset=ASSET, blend=os.path.basename(path), placements=placements))
            log("saved", path)
    if NORENDER:
        return
    R.setup_render(scn, "EEVEE", (1280, 720), 32)
    R.setup_world(scn, fog_density=0.0)
    pc = bpy.data.collections.new("PREVIEW_ONLY")
    scn.collection.children.link(pc)
    R.standard_lights(scale=20.0, lava=False, collection=pc)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(x / 2, 0, -0.05))
    g = bpy.context.active_object
    for c in g.users_collection:
        c.objects.unlink(g)
    pc.objects.link(g)
    M.assign(g, "Basalt", moss=0.0)
    cx = x / 2
    R.render_to(os.path.join(RDIR, f"{TAG}_lineup.png"),
                R.camera("CAM_far_lineup", (cx, -cx * 1.9 - 10, 22), (cx, 0, 8), 30, collection=pc))
    R.render_to(os.path.join(RDIR, f"{TAG}_lineup_low.png"),
                R.camera("CAM_far_lineup_low", (cx + 10, -cx * 2.0, 3.0), (cx, 0, 9), 30, collection=pc))
    # silhouette check against a pale fog-like sky (how they will read at 30-80 m)
    sc = bpy.context.scene
    sc.world = None
    R.setup_world(sc, top=(0.30, 0.31, 0.29), horizon=(0.42, 0.42, 0.39), strength=1.0)
    g.hide_render = True
    R.render_to(os.path.join(RDIR, f"{TAG}_silhouette.png"),
                R.camera("CAM_far_sil", (cx, -cx * 2.6 - 20, 6.0), (cx, 0, 9), 35, collection=pc))
    log("done")


main()
