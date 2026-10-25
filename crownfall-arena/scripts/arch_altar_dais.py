"""CFCL_Arch_AltarDais - carved altar drum around the board (+ optional seated-VR dais floor).

Run:  python lib/run_blender.py scripts/arch_altar_dais.py --timeout 1800 -- --ver 1 [--norender] [--fast]

Board contract (never violated, checked numerically every run):
  playing surface Z=0, board base bottom Z=-0.054, footprint +-0.38 m; drum top = exactly Z=-0.054,
  nothing inside the board volume, nothing above Z=0 within r<0.45, -Y hand approach open.
Layout (research/reference_study.md section 4d + coordinator revision):
  * drum: 3-step stepped drum, top O 1.24 m.  Course 1 = core stone (under board, the 4 lunettes) + 12 rim
    blocks of 30 deg; course 2 (offset 15 deg) carries the 49 mm lozenge/chevron frieze (relief 4-5 mm);
    course 3 carries a chevron band; recessed fluted body (knee room), torus base, octagonal plinth to Z=-0.76.
    Front-right block cracked with a 12 deg V-gap, rear-left rim block dropped 45 mm + tilted 8 deg outward,
    70% of chips on the outer lip, polished kneeling dips at -Y and +Y, offerings only in the lunettes,
    bronze cramps across the joints under the board's 4 corners (echo of its bronze corner bosses).
  * optional dais floor (separate object CFCL_Arch_DaisFloor): top Z=-0.76, r 3.66, radial paving,
    carved channel ring, cornice + frieze course, rubble core, collapse on the right-back edge,
    skull-side radial cracks stopping at the drum; stelae, broken chain, broken stair (separate objects).
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
from arch_lib import D2R, smoothstep  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(name, default, cast=str):
    return cast(ARGV[ARGV.index(name) + 1]) if name in ARGV else default


VER = _arg("--ver", 1, int)
NORENDER = "--norender" in ARGV
FAST = "--fast" in ARGV
ASSET = "CFCL_Arch_AltarDais"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "arch")
TAG = f"iter{VER:02d}"

Z_TOP = -0.054
FLOOR = -0.76
SLAB_B = -1.04
DAIS_B = -1.36
T0 = time.time()


def log(*a):
    print(f"[arch_altar {time.time() - T0:6.1f}s]", *a, flush=True)


def wrap180(a):
    return (a + 180.0) % 360.0 - 180.0


def angd(x, y):
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


# =============================================================================== materials
MOSS = 0.3      # research 3a: moss on 25-40% of top faces (cf_materials variant, not the shared default)


def mat_stone():
    # shared name CFCL_AncientStone so the integrator's promoted material binds to the altar as well
    return M.get("AncientStone")


def mat_polished():
    m = bpy.data.materials.get("CFCL_AncientStone_Polished")
    if m:
        return m
    m = M.get("AncientStone", moss=0.0).copy()
    m.name = "CFCL_AncientStone_Polished"
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for l in list(b.inputs["Roughness"].links):
        nt.links.remove(l)
    b.inputs["Roughness"].default_value = 0.42
    lk = b.inputs["Base Color"].links
    if lk:
        src = lk[0].from_socket
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Saturation"].default_value = 0.85
        hs.inputs["Value"].default_value = 1.15
        nt.links.new(src, hs.inputs["Color"])
        nt.links.new(hs.outputs["Color"], b.inputs["Base Color"])
    return m


def mat_wax():
    m = bpy.data.materials.get("CFCL_Arch_Wax")
    if m:
        return m
    m = bpy.data.materials.new("CFCL_Arch_Wax")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (0.20, 0.15, 0.085, 1.0)   # aged, smoke-darkened tallow
    b.inputs["Roughness"].default_value = 0.5
    if b.inputs.get("Subsurface Weight"):
        b.inputs["Subsurface Weight"].default_value = 0.35
    if b.inputs.get("Subsurface Radius"):
        b.inputs["Subsurface Radius"].default_value = (0.012, 0.008, 0.004)
    return m


# =============================================================================== generic stones
def sector_stone(r_in, r_out, tha_d, thb_d, zb, zt, seed, gap=0.012, rb=0.022, step=0.16, step_z=None,
                 chips=3, chip_scale=1.0, prefer=None, crack=None, noise_amp=0.0016, world_fn=None,
                 jag_out=None, dense=0.0):
    """Annular-sector stone. crack=dict(pos=-1..1 along x, gap, v_deg, amp) -> two matching halves.
    jag_out=fn(x,z) -> radial displacement of the outer face (fresh break)."""
    rng = np.random.default_rng(seed)
    tha, thb = tha_d * D2R, thb_d * D2R
    rm = 0.5 * (r_in + r_out)
    g_th = gap / rm * 0.5
    tha2, thb2 = tha + g_th, thb - g_th
    rin2, rout2 = r_in + gap * 0.5, r_out - gap * 0.5
    ex = 0.5 * (thb2 - tha2) * rm
    ey = 0.5 * (rout2 - rin2)
    ez = 0.5 * (zt - zb)
    e = np.array([ex, ey, ez])
    inner, outer = A.sector_curves(rin2, rout2, tha2, thb2)
    mp = A.map_patch(e, inner, outer, z0=0.5 * (zt + zb))
    copts = {"prefer": prefer} if prefer else None
    fn_out = [(1, 1, jag_out)] if jag_out is not None else None
    if crack is None:
        return [A.make_block(e, rb=rb, step=step, step_z=step_z, chips=chips, chip_scale=chip_scale, rng=rng,
                             mapping=mp, seed=seed, noise_amp=noise_amp, chip_opts=copts, world_fn=world_fn,
                             face_noise=fn_out, dense=dense)]
    xc = crack.get("pos", 0.0) * ex
    cg = crack.get("gap", 0.008)
    amp = crack.get("amp", 0.012)
    vt = math.tan(crack.get("v_deg", 0.0) * D2R / 2.0)
    vplan = math.tan(crack.get("plan_deg", 0.0) * D2R / 2.0)
    sd = seed * 7 + 3

    def g(a, b):  # a = local y, b = local z  (matching jagged crack surface)
        return amp * A.fbm2(a * 1.0, b * 1.0, 11.0, 3, seed=sd)

    def wv(a, b):  # wedge (V) half-width: grows outward (y) and upward (z)
        return 0.5 * cg + (b + ez) * vt + (a + ey) * vplan

    eA = e.copy()
    eA[0] = 0.5 * (xc + ex)
    cA = np.array([0.5 * (-ex + xc), 0, 0])
    eB = e.copy()
    eB[0] = 0.5 * (ex - xc)
    cB = np.array([0.5 * (xc + ex), 0, 0])
    pa = A.make_block(eA, rb=rb, step=step, step_z=step_z, chips=max(0, chips - 1), chip_scale=chip_scale, rng=rng,
                      mapping=mp, center=cA, seed=seed, noise_amp=noise_amp, chip_opts=copts, world_fn=world_fn,
                      face_noise=[(0, 1, lambda a, b: g(a, b) - wv(a, b))] + (fn_out or []), dense=dense)
    pb = A.make_block(eB, rb=rb, step=step, step_z=step_z, chips=max(0, chips - 1), chip_scale=chip_scale, rng=rng,
                      mapping=mp, center=cB, seed=seed + 1, noise_amp=noise_amp, chip_opts=copts, world_fn=world_fn,
                      face_noise=[(0, -1, lambda a, b: g(a, b) + wv(a, b))] + (fn_out or []), dense=dense)
    return [pa, pb]


def tilt_pieces(pieces, pivot, axis, ang, drop=0.0):
    M4 = A.rot_about(pivot, axis, ang)
    for p in pieces:
        p.transform(M4)
        p.translate((0, 0, -drop))
    return pieces


def radial_tangent(th_d):
    t = th_d * D2R
    return np.array([math.cos(t), math.sin(t), 0.0]), np.array([-math.sin(t), math.cos(t), 0.0])


# =============================================================================== DRUM
DRUM = dict(r_core=0.542, r1_in=0.545, r1=0.620, z1=-0.115, r2_in=0.42, r2=0.690, z2=-0.190,
            r3_in=0.42, r3=0.760, z3=-0.272)
DIPS = [(270.0, 0.583), (90.0, 0.583)]   # kneeling dips (theta deg, radius)


def dip_depth(P):
    d = np.zeros(len(P))
    r = np.hypot(P[:, 0], P[:, 1])
    th = (np.degrees(np.arctan2(P[:, 1], P[:, 0])) + 360) % 360
    for thc, rc in DIPS:
        dt = np.radians(np.abs(((th - thc + 180) % 360) - 180)) * rc
        dr = r - rc
        d += 0.0065 * np.exp(-(dt / 0.11) ** 2 - (dr / 0.034) ** 2)
    top = P[:, 2] > Z_TOP - 0.006
    return d * top


def dip_world(P):
    P = P.copy()
    P[:, 2] -= dip_depth(P)
    return P


def build_drum():
    t0 = time.time()
    stone = A.Acc()
    bronze = A.Acc()
    wax = A.Acc()
    pebble = A.Acc()
    bone = A.Acc()
    D = DRUM

    # ---- core stone (under the board + the four lunettes); top exactly Z_TOP, never displaced
    core = A.lathe([(0, Z_TOP), (0.20, Z_TOP), (0.38, Z_TOP), (0.46, Z_TOP), (0.536, Z_TOP),
                    (D["r_core"], Z_TOP - 0.005), (D["r_core"], D["z1"] + 0.002), (0.40, D["z1"] + 0.002),
                    (0.40, D["z3"]), (0, D["z3"])], 96)
    stone.add(core)

    # ---- course 1: 12 rim blocks, 30 deg, joints at k*30
    for k in range(12):
        tha, thb = k * 30.0, (k + 1) * 30.0
        thm = tha + 15.0
        seed = 100 + k
        crack = None
        wf = dip_world if any(abs(wrap180(thm - c)) < 40 for c, _ in DIPS) else None
        if 300.0 <= thm <= 330.0:          # front-right: V-crack
            crack = dict(pos=0.12, gap=0.005, v_deg=14.0, plan_deg=10.0, amp=0.010)
        pcs = sector_stone(D["r1_in"], D["r1"], tha, thb, D["z1"], Z_TOP, seed, gap=0.005, rb=0.009,
                           step=0.06, step_z=0.06, chips=4, chip_scale=0.55, prefer=(0, (1, 1, 1)),
                           crack=crack, noise_amp=0.0009, world_fn=wf)
        if 120.0 <= thm <= 150.0:          # rear-left: dropped 45 mm, tilted 8 deg outward
            rad, tan = radial_tangent(thm)
            piv = np.array([D["r1_in"] * rad[0], D["r1_in"] * rad[1], D["z1"]])
            tilt_pieces(pcs, piv, tan, 9.0, drop=0.052)
        if crack is not None and len(pcs) == 2:   # one half settled
            rad, tan = radial_tangent(thm)
            c = pcs[1].V.mean(0)
            tilt_pieces([pcs[1]], (c[0], c[1], D["z1"]), rad, 2.0, drop=0.004)
        # polished dips -> material slot 1
        for p in pcs:
            if wf is not None:
                cen = np.array([p.V[f].mean(0) for f in p.F])
                dd = dip_depth(np.c_[cen[:, :2], np.full(len(cen), Z_TOP)])
                up = np.array([np.cross(p.V[f[1]] - p.V[f[0]], p.V[f[2]] - p.V[f[0]])[2] > 0 for f in p.F])
                p.fm = [1 if (a > 0.0012 and u) else 0 for a, u in zip(dd, up)]
        stone.add(pcs)

    # ---- course 2: 12 blocks offset 15 deg, frieze on the riser (49 mm band, relief 4-5 mm)
    Rf = D["r2"] - 0.0025
    zc2 = 0.5 * (D["z1"] + D["z2"])
    for k in range(12):
        tha, thb = 15.0 + k * 30.0, 45.0 + k * 30.0
        thm = tha + 15.0
        seed = 200 + k
        gap = 0.012 if abs(wrap180(thb - 315.0)) < 1 or abs(wrap180(tha - 315.0)) < 1 else 0.005
        wf = None
        if 105.0 <= thm <= 165.0:          # crushed under the dropped rim block
            def wf(P, c=thm):
                th = (np.degrees(np.arctan2(P[:, 1], P[:, 0])) + 360) % 360
                r = np.hypot(P[:, 0], P[:, 1])
                w = np.exp(-(wrap180(th - 135.0) / 9.0) ** 2) * smoothstep(0.50, 0.66, r)
                top = P[:, 2] > D["z1"] - 0.01
                P = P.copy()
                P[:, 2] -= 0.028 * w * top * (0.7 + 0.3 * A.fbm3(P, 30.0, 2, 5))
                return P
        pcs = sector_stone(D["r2_in"], D["r2"], tha, thb, D["z2"], D["z1"], seed, gap=gap, rb=0.010,
                           step=0.08, step_z=0.08, chips=4, chip_scale=0.6, prefer=(0, (1, 1, 1)),
                           noise_amp=0.0009, world_fn=wf)
        stone.add(pcs)
        # carved panel: 75% of the block length, plain margins
        a0, a1 = tha * D2R, thb * D2R
        span = (a1 - a0) * Rf
        m = 0.125 * span
        mp = A.map_cyl(Rf, 0.0)
        u0, u1 = a0 * Rf + m, a1 * Rf - m
        rel = A.lozenge_frieze(u0, u1, zc2 - 0.0195, zc2 + 0.0195, 4, mp, h=0.0042, wb=0.0058, wt=0.0028,
                               nail_h=0.0052, nail_scale=0.52, small_nails=True, embed=0.0025)
        rel.append(A.stroke([(u0 - 0.004, zc2 - 0.0245), (u1 + 0.004, zc2 - 0.0245)], mp, 0.0035, 0.0018, 0.003,
                            0.0025))
        rel.append(A.stroke([(u0 - 0.004, zc2 + 0.0245), (u1 + 0.004, zc2 + 0.0245)], mp, 0.0035, 0.0018, 0.003,
                            0.0025))
        stone.add(rel)

    # ---- course 3: joints at k*30, chevron band on the riser, V-crack front-right
    Rc = D["r3"] - 0.0025
    zc3 = 0.5 * (D["z2"] + D["z3"])
    for k in range(12):
        tha, thb = k * 30.0, (k + 1) * 30.0
        thm = tha + 15.0
        seed = 300 + k
        crack = None
        if 300.0 <= thm <= 330.0:
            crack = dict(pos=0.0, gap=0.006, v_deg=14.0, plan_deg=9.0, amp=0.016)
        pcs = sector_stone(D["r3_in"], D["r3"], tha, thb, D["z3"], D["z2"], seed, gap=0.005, rb=0.012,
                           step=0.09, step_z=0.09, chips=5, chip_scale=0.7, prefer=(0, (1, 1, 1)),
                           crack=crack, noise_amp=0.001)
        if crack is not None and len(pcs) == 2:
            rad, tan = radial_tangent(thm)
            c = pcs[1].V.mean(0)
            tilt_pieces([pcs[1]], (c[0], c[1], D["z3"]), rad, -2.5, drop=0.006)
        stone.add(pcs)
        a0, a1 = tha * D2R, thb * D2R
        span = (a1 - a0) * Rc
        m = 0.12 * span
        mp = A.map_cyl(Rc, 0.0)
        u0, u1 = a0 * Rc + m, a1 * Rc - m
        if crack is not None:   # crack splits the panel: two shorter runs
            uc = 0.5 * (u0 + u1)
            spans = [(u0, uc - 0.03), (uc + 0.03, u1)]
        else:
            spans = [(u0, u1)]
        for (ua, ub) in spans:
            n = max(1, int(round((ub - ua) / 0.085)))
            stone.add(A.lozenge_frieze(ua, ub, zc3 - 0.020, zc3 + 0.020, n, mp, h=0.0045, wb=0.0065, wt=0.003,
                                       nail_h=0.0055, phases=(0,), embed=0.0025))

    # ---- body: ovolo soffit, cavetto neck, fluted shaft (knee room) - cut into 6 jointed stones
    def flutes(Rr, TH, Z, k):
        sh = (Z < -0.44) & (Z > -0.596)
        fr = (TH * 24 / A.TAU) % 1.0
        depth = 0.011 * (1 - (2 * fr - 1) ** 2) * smoothstep(-0.596, -0.575, Z) * (1 - smoothstep(-0.465, -0.445, Z))
        return Rr - depth * sh, Z
    body_prof = [(0, D["z3"] - 0.002), (0.70, D["z3"] - 0.002), (0.6939, -0.3046), (0.6766, -0.3306),
                 (0.6506, -0.3479), (0.62, -0.354), (0.60, -0.356), (0.585, -0.360), (0.565, -0.370),
                 (0.548, -0.384), (0.535, -0.401), (0.526, -0.42), (0.531, -0.425), (0.531, -0.435),
                 (0.523, -0.44), (0.520, -0.45), (0.517, -0.48), (0.514, -0.51), (0.511, -0.54),
                 (0.508, -0.57), (0.505, -0.59), (0.505, -0.598), (0.498, -0.604), (0, -0.604)]
    base_prof = [(0, -0.606), (0.500, -0.606), (0.507, -0.611), (0.5304, -0.616), (0.532, -0.622),
                 (0.5304, -0.628), (0.52, -0.634), (0.522, -0.640), (0.532, -0.648), (0.55, -0.654),
                 (0.57, -0.657), (0.6123, -0.662), (0.615, -0.672), (0.6123, -0.682), (0.595, -0.692),
                 (0.58, -0.694), (0, -0.694)]
    rngb = np.random.default_rng(404)

    def jointed(prof, n, off_deg, nseg_total, deform, chip_pts, seed):
        gap = 0.0045
        for k in range(n):
            a0 = (off_deg + k * 360.0 / n) * D2R
            a1 = (off_deg + (k + 1) * 360.0 / n) * D2R
            g = gap / 0.6 * 0.5
            pc = A.lathe_sector(prof, a0 + g, a1 - g, max(4, nseg_total // n), deform=deform)
            for (rr, zz) in chip_pts:          # chipped arrises at the joints (outer lip first)
                for aa, sgn in ((a0 + g, 1), (a1 - g, -1)):
                    if rngb.uniform() < 0.55:
                        p0 = np.array([rr * math.cos(aa), rr * math.sin(aa), zz])
                        rad = np.array([math.cos(aa), math.sin(aa), 0])
                        tan = np.array([-math.sin(aa), math.cos(aa), 0]) * sgn
                        nv = A.normalize(rad + 0.9 * (-tan) + rngb.normal(0, 0.25, 3))
                        A.chip(pc.V, p0, nv, rngb.uniform(0.008, 0.022), 0.07)
            pc.displace(0.0012, 9.0, seed=seed + k)
            stone.add(pc)
    jointed(body_prof, 6, 7.0, 120, flutes, [(0.70, D["z3"] - 0.002), (0.531, -0.43)], 410)
    jointed(base_prof, 4, 52.0, 112, None, [(0.615, -0.672)], 420)
    plinth = A.lathe([(0, -0.696), (0.645, -0.696), (0.66, -0.704), (0.66, -0.752), (0.652, -0.760),
                      (0, -0.760)], 8, th0=22.5 * D2R)
    stone.add(plinth)

    # ---- bronze cramps across the course-2 joints under the board's corners (45/135/225/315)
    for thc in (45.0, 135.0, 225.0, 315.0):
        rad, tan = radial_tangent(thc)
        c = rad * (D["r2"] + 0.001) + np.array([0, 0, zc2])
        up = np.array([0, 0, 1.0])
        hw = 0.013
        plate = []
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            plate.append(c + tan * sx * hw + up * sz * hw)
        plate = np.array(plate)
        V = np.concatenate([plate - rad * 0.004, plate + rad * 0.003, [c + rad * 0.009]])
        F = [[0, 1, 2, 3][::-1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
             [4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 4, 8]]
        p = A.Piece(V, F).fix_orientation()
        if thc == 315.0:   # cramp torn by the opened joint
            p.transform(A.rot_about(c, rad, 9.0))
        bronze.add(p)

    # ---- offerings in the lunettes (never on the board, max height Z<=-0.004)
    rng = np.random.default_rng(77)

    def lunette_xy(side, t, n):
        # side: unit normal of board edge (E/N/W/S); t tangential, n distance from centre
        nx, ny = side
        return np.array([nx * n - ny * t, ny * n + nx * t])

    def candle(xy, h, r, seed):
        """Guttered stub: low, wide, lopsided melted rim and crater; wax flowed out at the foot."""
        rg = np.random.default_rng(seed)
        a0 = rg.uniform(0, A.TAU)
        prof = [(0, Z_TOP), (r * 1.45, Z_TOP), (r * 1.25, Z_TOP + 0.12 * h), (r * 1.05, Z_TOP + 0.35 * h),
                (r, Z_TOP + 0.7 * h), (r * 0.92, Z_TOP + h), (r * 0.62, Z_TOP + 0.86 * h),
                (r * 0.3, Z_TOP + 0.7 * h), (0, Z_TOP + 0.68 * h)]

        def dfm(Rr, TH, Z, k):
            j = 1 + 0.16 * A.fbm2(np.cos(TH) * 3 + seed, np.sin(TH) * 3, 1.5, 2, seed=seed)
            lop = (Z > Z_TOP + 0.5 * h) * (0.32 * h * (np.cos(TH - a0) - 1.0))
            return Rr * j, Z + lop
        pc = A.lathe(prof, 12, deform=dfm)
        pc.translate((xy[0], xy[1], 0))
        for _ in range(2):          # runs of wax down the side
            a = a0 + rg.uniform(-0.6, 0.6)
            dpt = np.array([xy[0] + r * 1.02 * math.cos(a), xy[1] + r * 1.02 * math.sin(a)])
            drip = A.lathe([(0, Z_TOP), (0.004, Z_TOP + 0.001), (0.003, Z_TOP + 0.8 * h), (0, Z_TOP + 0.85 * h)], 6)
            drip.translate((dpt[0], dpt[1], 0))
            wax.add(drip)
        return pc

    def pool(xy, r, seed):
        def dfm(Rr, TH, Z, k):
            return Rr * (1 + 0.35 * A.fbm2(np.cos(TH) * 2 + seed, np.sin(TH) * 2, 1.3, 2, seed=seed)), Z
        pc = A.lathe([(0, Z_TOP + 0.0032), (r * 0.8, Z_TOP + 0.003), (r, Z_TOP + 0.0012), (r * 1.02, Z_TOP - 0.001),
                      (0, Z_TOP - 0.001)], 18, deform=dfm)
        pc.translate((xy[0], xy[1], 0))
        return pc

    def pebble_piece(c, s, seed):
        rg = np.random.default_rng(seed)
        pts = rg.normal(0, 1, (14, 3))
        pts = A.normalize(pts) * np.array([s, s * rg.uniform(0.7, 0.95), s * rg.uniform(0.45, 0.65)])
        pc = A.convex_hull_piece(pts)
        pc.transform(A.M4(A.rot_euler(0, 0, rg.uniform(0, 360))))
        pc.translate(c)
        return pc

    def cairn(xy, seed):
        """Low two-tier pebble cairn: 3-4 flat pebbles in a ring, one capstone. Wide, never tall."""
        rg = np.random.default_rng(seed)
        nb = int(rg.integers(3, 5))
        for i in range(nb):
            a = A.TAU * i / nb + rg.uniform(-0.3, 0.3)
            p = pebble_piece((xy[0] + 0.012 * math.cos(a), xy[1] + 0.012 * math.sin(a), 0),
                             rg.uniform(0.010, 0.014), seed + i)
            A.rest_on(p, Z_TOP, sink=0.001)
            pebble.add(p)
        p = pebble_piece((xy[0], xy[1], 0), 0.009, seed + 9)
        A.rest_on(p, Z_TOP + 0.007, sink=0.0)
        pebble.add(p)

    def bone_frag(xy, length, ang, seed):
        L = length
        prof = [(0, -L / 2), (0.006, -L / 2 + 0.002), (0.0075, -L / 2 + 0.008), (0.0045, -L / 2 + 0.018),
                (0.004, 0), (0.0045, L / 2 - 0.016), (0.0072, L / 2 - 0.007), (0.0055, L / 2 - 0.001), (0, L / 2)]
        pc = A.lathe(prof, 8)
        pc.transform(A.M4(A.rot_euler(90, 0, ang)))
        pc.translate((xy[0], xy[1], 0))
        A.rest_on(pc, Z_TOP, sink=0.0015)
        bone.add(pc)

    # (critic pass02 S3/A10) nothing in the lunettes any more: offerings stand on the flat hub stone at the
    # BACK foot of the drum (Z=-0.76), between the plinth faces and the hub edge, hidden from the seated and
    # hero sightlines by the drum itself.  Guttered stubs 3-6 cm with drips, small pebble cairns, bone bits.
    FZ = FLOOR

    def at(th_deg, rr):
        return np.array([rr * math.cos(th_deg * D2R), rr * math.sin(th_deg * D2R)])

    def stub(xy, h, r, seed):
        pc = candle(xy, h, r, seed)
        pc.translate((0, 0, FZ - Z_TOP))
        return pc
    nwax0 = len(wax.pieces)
    for th_c, items in ((45.0, [(-3.0, 0.67, 0.052, 0.016), (2.5, 0.655, 0.034, 0.014), (5.5, 0.675, 0.024, 0.012)]),
                        (90.0, [(-4.0, 0.66, 0.060, 0.018), (0.5, 0.67, 0.041, 0.015), (4.0, 0.655, 0.030, 0.013),
                                (-1.5, 0.68, 0.022, 0.011)]),
                        (135.0, [(-2.0, 0.665, 0.045, 0.016), (3.0, 0.67, 0.032, 0.013)])):
        for j, (dth, rr, h, r) in enumerate(items):
            wax.add(stub(at(th_c + dth, rr), h, r, int(th_c) * 10 + j))
    for p in wax.pieces[nwax0:]:      # drips were built at the lunette level by candle(): drop them too
        if p.V[:, 2].min() > Z_TOP - 0.01:
            p.translate((0, 0, FZ - Z_TOP))

    def cairn_floor(xy, seed):
        rg = np.random.default_rng(seed)
        nb = int(rg.integers(3, 5))
        for i in range(nb):
            a = A.TAU * i / nb + rg.uniform(-0.3, 0.3)
            q = pebble_piece((xy[0] + 0.016 * math.cos(a), xy[1] + 0.016 * math.sin(a), 0),
                             rg.uniform(0.013, 0.019), seed + i)
            A.rest_on(q, FZ, sink=0.002)
            pebble.add(q)
        q = pebble_piece((xy[0], xy[1], 0), 0.012, seed + 9)
        A.rest_on(q, FZ + 0.012, sink=0.0)
        pebble.add(q)
    cairn_floor(at(78.0, 0.67), 31)
    cairn_floor(at(102.0, 0.67), 32)
    for k, (thb, rr, L, ang) in enumerate(((96.0, 0.675, 0.07, 20), (84.0, 0.68, 0.05, 110), (128.0, 0.675, 0.045, -30))):
        bone_frag(at(thb, rr), L, ang, 41 + k)
        bone.pieces[-1].translate((0, 0, FZ - Z_TOP))
    log("drum built", f"{time.time() - t0:.1f}s")
    return stone, bronze, wax, pebble, bone


# =============================================================================== DAIS FLOOR
COL_C, COL_HW = 15.0, 30.0       # collapse centre angle / half width (deg), right-back edge
SKULL_TH = 106.0                 # skull direction (deg) - radial cracks come from there
STELAE = [  # name, theta, r, shaft height, lean   (critic pass02: markers <= 1.2 m, one snapped)
    ("A", 135.0, 3.08, 0.74, 0.0),
    ("B", 45.0, 3.08, 0.62, 3.5),
    ("C", 215.0, 3.10, 0.56, 0.0),
    ("D", 325.0, 3.10, 1.00, 0.0),   # snapped: stump stands, its top lies beside it
]


def r_break(th):
    d = abs(wrap180(th - COL_C))
    if d >= COL_HW:
        return 99.0
    t = 1.0 - d / COL_HW
    nz = 0.12 * float(A.fbm2(np.array([th * 0.07]), np.array([0.3]), 1.0, 2, seed=11)[0])
    return 3.62 - 1.55 * (t ** 0.75) + nz


def protected(r_in, r_out, tha, thb):
    """Player corridor, stele footprints, chain zone and stair landing are kept intact."""
    pts = []
    for r in np.linspace(r_in, r_out, 4):
        for th in np.linspace(tha, thb, 5):
            pts.append((r * math.cos(th * D2R), r * math.sin(th * D2R)))
    pts = np.array(pts)
    if np.any((np.abs(pts[:, 0]) < 1.0) & (pts[:, 1] < 0.35)):
        return True
    for _n, th, r, _h, _l in STELAE:
        c = np.array([r * math.cos(th * D2R), r * math.sin(th * D2R)])
        if np.any(np.linalg.norm(pts - c, axis=1) < 0.62):
            return True
    if np.any((np.abs(pts[:, 0]) < 1.4) & (pts[:, 1] > 1.6) & (pts[:, 1] < 2.6)):   # chain lies here
        return True
    thm = 0.5 * (tha + thb)
    if abs(wrap180(thm - 90)) < 22 and r_out > 2.7:      # stair landing
        return True
    if r_in < 1.3 and abs(wrap180(thm - 90)) < 50:      # offerings + floor-ring chains behind the drum
        return True
    return False


def damage_kind(rng, thm, rm, prot):
    if prot:
        return "ok"
    a = abs(wrap180(thm - 270.0))
    d = max(smoothstep(60, 150, a), 0.45 * smoothstep(40, 90, a))
    d *= 0.65 + 0.35 * smoothstep(1.2, 3.3, rm)
    x = rng.uniform()
    if x < 0.13 * d:
        return "missing"
    if x < 0.33 * d:
        return "tilt"
    if x < 0.48 * d:
        return "sunk"
    if x < 0.75 * d:
        return "crack"
    return "ok"


def floor_ring(acc, rub, r_in, r_out, n, off, zt, zb, seed0, step=0.18, rb=0.024, relief=None, ringname=""):
    stats = {}
    for k in range(n):
        tha = off + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        rm = 0.5 * (r_in + r_out)
        seed = seed0 + k
        rng = np.random.default_rng(seed)
        rbk = r_break(thm)
        prot = protected(r_in, r_out, tha, thb)
        if r_in > rbk - 0.08:
            stats["gone"] = stats.get("gone", 0) + 1
            continue
        kind = damage_kind(rng, thm, rm, prot)
        if abs(wrap180(thm - SKULL_TH)) < 24 and not prot and kind in ("ok", "sunk"):
            kind = "crack"
        jag = None
        rout_eff = r_out
        if r_out > rbk:     # straddles the collapse: outer part snapped off (fresh jagged break)
            rout_eff = max(r_in + 0.18, rbk + rng.uniform(-0.05, 0.05))
            sd = seed

            def jag(a, b, sd=sd):
                return 0.05 * A.fbm2(a * 1.0, b * 1.0, 6.0, 3, seed=sd) - 0.02
            kind = "edge"
        if kind == "missing":
            stats["missing"] = stats.get("missing", 0) + 1
            for j in range(rng.integers(2, 5)):
                th = rng.uniform(tha + 3, thb - 3) * D2R
                mg = min(0.1, 0.3 * (r_out - r_in))
                rr = rng.uniform(r_in + mg, r_out - mg)
                sz = rng.uniform(0.05, 0.14) * min(1.0, (r_out - r_in) / 0.4)
                rub.add(A.rest_on(A.rubble_chunk((rr * math.cos(th), rr * math.sin(th), 0),
                                                 (sz, sz * 0.8, sz * 0.5), rng), SLAB_B - 0.02, 0.02))
            # one broken fragment of the slab lying tilted in the hole
            if rng.uniform() < 0.6:
                frag = sector_stone(r_in + 0.05, r_in + 0.05 + 0.35 * (r_out - r_in), tha + 0.2 * (thb - tha),
                                    tha + 0.6 * (thb - tha), zb, zb + 0.6 * (zt - zb), seed + 900, step=step,
                                    rb=rb, chips=3)
                rad, tan = radial_tangent(thm)
                cen = frag[0].V.mean(0)
                tilt_pieces(frag, cen, tan, rng.uniform(-25, 25), drop=0.0)
                A.rest_on(frag[0], SLAB_B - 0.02)
                acc.add(frag)
            continue
        crack = None
        if kind == "crack":
            vdeg = 0.0
            if abs(wrap180(thm - SKULL_TH)) < 24:
                crack = dict(pos=rng.uniform(-0.25, 0.25), gap=rng.uniform(0.006, 0.012), amp=0.03, v_deg=vdeg)
            else:
                crack = dict(pos=rng.uniform(-0.35, 0.35), gap=rng.uniform(0.005, 0.01), amp=0.03)
        pcs = sector_stone(r_in, rout_eff, tha, thb, zb, zt, seed, gap=0.014, rb=rb * rng.uniform(0.7, 1.3),
                           step=step, step_z=0.3, chips=int(rng.integers(2, 5)), chip_scale=1.0,
                           prefer=(0, (1, 1, 1)), crack=crack, noise_amp=0.002, jag_out=jag)
        extra = []
        if relief is not None:
            extra = relief(tha, thb)
        rad, tan = radial_tangent(thm)
        allp = pcs + extra
        if kind == "ok" and not prot:
            ax = A.normalize(np.r_[rng.normal(0, 1, 2), 0])
            tilt_pieces(allp, (rm * rad[0], rm * rad[1], zb), ax, rng.uniform(0, 0.8), drop=rng.uniform(-0.004, 0.006))
        elif kind == "tilt":
            ax = A.normalize(np.r_[rng.normal(0, 1, 2), 0])
            tilt_pieces(allp, (rm * rad[0], rm * rad[1], zb), ax, rng.uniform(3, 8), drop=rng.uniform(0.03, 0.09))
        elif kind == "sunk":
            ax = A.normalize(np.r_[rng.normal(0, 1, 2), 0])
            tilt_pieces(allp, (rm * rad[0], rm * rad[1], zb), ax, rng.uniform(0.5, 2.5), drop=rng.uniform(0.04, 0.11))
        elif kind == "crack" and len(pcs) == 2:
            ax = A.normalize(np.r_[rng.normal(0, 1, 2), 0])
            c = pcs[1].V.mean(0)
            tilt_pieces([pcs[1]], (c[0], c[1], zb), ax, rng.uniform(0.6, 2.2), drop=rng.uniform(0.0, 0.025))
        elif kind == "edge":
            piv = (r_in * rad[0], r_in * rad[1], zb)
            tilt_pieces(allp, piv, tan, rng.uniform(6.0, 16.0), drop=rng.uniform(0.0, 0.03))
            if rng.uniform() < 0.5:
                rub.add(A.rest_on(A.rubble_chunk(((rout_eff - 0.1) * rad[0], (rout_eff - 0.1) * rad[1], 0),
                                                 (0.08, 0.06, 0.05), rng), zt - 0.01, 0.0))
        stats[kind] = stats.get(kind, 0) + 1
        acc.add(allp)
    log(f"ring {ringname}: {stats}")


def build_floor():
    t0 = time.time()
    flo = A.Acc()
    rub = A.Acc()
    # hub under the drum plinth
    flo.add(A.lathe([(0, FLOOR), (0.70, FLOOR), (0.735, FLOOR - 0.012), (0.735, SLAB_B), (0, SLAB_B)], 48))
    floor_ring(flo, rub, 0.74, 1.50, 14, 270 - 360 / 28, FLOOR, SLAB_B, 1000, step=0.28, ringname="A")
    floor_ring(flo, rub, 1.50, 1.62, 24, 0.0, FLOOR, SLAB_B, 1100, step=0.3, rb=0.03, ringname="Bi")

    def chan_relief(tha, thb):
        Rr = 1.62 + 0.007
        mp = A.map_annulus(Rr, FLOOR - 0.055)
        a0, a1 = tha * D2R, thb * D2R
        u0, u1 = a0 * Rr + 0.03, a1 * Rr - 0.03
        return A.lozenge_frieze(u0, u1, 0.025, 0.205, 2, mp, h=0.012, wb=0.016, wt=0.008, nail_h=0.016,
                                nail_scale=0.5, small_nails=True, embed=0.004)
    floor_ring(flo, rub, 1.62, 1.86, 16, 270.0, FLOOR - 0.055, SLAB_B, 1200, step=0.3, rb=0.02,
               relief=chan_relief, ringname="Bc")
    floor_ring(flo, rub, 1.86, 1.98, 24, 7.5, FLOOR, SLAB_B, 1300, step=0.3, rb=0.03, ringname="Bo")
    floor_ring(flo, rub, 1.98, 2.74, 20, 263.0, FLOOR, SLAB_B, 1400, step=0.3, ringname="C1")
    floor_ring(flo, rub, 2.74, 3.40, 26, 271.0, FLOOR, SLAB_B, 1500, step=0.3, ringname="C2")

    # cornice ring (projecting lip + ovolo) and the carved frieze course under it
    prof = [(3.40, FLOOR), (3.625, FLOOR), (3.66, FLOOR - 0.03), (3.66, FLOOR - 0.10), (3.645, FLOOR - 0.135),
            (3.615, FLOOR - 0.165), (3.575, FLOOR - 0.185), (3.535, FLOOR - 0.192), (3.535, SLAB_B),
            (3.40, SLAB_B)]
    rng = np.random.default_rng(1600)
    n = 36
    for k in range(n):
        tha = 4.0 + k * 10.0
        thb = tha + 10.0
        thm = (tha + 5.0) % 360
        if abs(wrap180(thm - 90.0)) < 19.0:      # stair opening
            continue
        if r_break(thm) < 3.62:
            continue
        if 160 < thm < 200 and rng.uniform() < 0.25:   # a lost cornice stone on the left
            continue
        g = 0.006 / 3.5
        pc = A.sweep_sector(prof, (tha * D2R) + g, (thb * D2R) - g, 4, end_chamfer=0.012)
        rad, tan = radial_tangent(thm)
        for end in (tha, thb):
            if rng.uniform() < 0.6:
                re, te = radial_tangent(end)
                p0 = np.array([3.66 * re[0], 3.66 * re[1], FLOOR])
                nvec = A.normalize(re + np.array([0, 0, 1.0]) + (te if end == tha else -te) * 0.9
                                   + rng.normal(0, 0.2, 3))
                A.chip(pc.V, p0, nvec, rng.uniform(0.015, 0.045), 0.12)
        dmg = abs(wrap180(thm - 270)) > 60
        if dmg and rng.uniform() < 0.18:
            tilt_pieces([pc], (3.40 * rad[0], 3.40 * rad[1], SLAB_B), tan, rng.uniform(3, 7),
                        drop=rng.uniform(0.01, 0.04))
        pc.displace(0.0015, 7.0, seed=k)
        flo.add(pc)
    # frieze course
    n = 28
    for k in range(n):
        tha = 3.0 + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        if abs(wrap180(thm - 90.0)) < 16.0:
            continue
        if r_break(thm) < 3.55:
            continue
        seed = 1700 + k
        pcs = sector_stone(3.0, 3.52, tha, thb, DAIS_B + 0.004, SLAB_B - 0.004, seed, gap=0.012, rb=0.02,
                           step=0.26, step_z=0.3, chips=3, prefer=(0, (1, 1, -1)), noise_amp=0.002)
        Rr = 3.52 - 0.006
        mp = A.map_cyl(Rr, 0.0)
        a0, a1 = tha * D2R, thb * D2R
        span = (a1 - a0) * Rr
        u0, u1 = a0 * Rr + 0.1 * span, a1 * Rr - 0.1 * span
        rel = A.lozenge_frieze(u0, u1, -1.285, -1.115, 3, mp, h=0.012, wb=0.016, wt=0.008, nail_h=0.018,
                               small_nails=False, embed=0.004)
        rel.append(A.stroke([(u0, -1.30), (u1, -1.30)], mp, 0.009, 0.005, 0.008, 0.004))
        rel.append(A.stroke([(u0, -1.10), (u1, -1.10)], mp, 0.009, 0.005, 0.008, 0.004))
        flo.add(pcs + rel)

    # rubble core (visible in holes and in the collapse)
    def core_def(Rr, TH, Z, k):
        th = np.degrees(TH) % 360
        rc = np.array([min(3.02, r_break(t) - 0.12) for t in th])
        side = Rr > 0.99
        jit = 0.06 * A.fbm2(np.cos(TH) * 3.0, np.sin(TH) * 3.0 + Z * 2.0, 2.0, 3, seed=5) * (rc < 3.0)
        Rw = Rr * rc + jit * side
        top = Z > SLAB_B - 0.05
        Zw = Z + top * 0.018 * A.fbm2(Rw * np.cos(TH), Rw * np.sin(TH), 3.0, 3, seed=6)
        return Rw, Zw
    zt = SLAB_B - 0.022
    core = A.lathe([(0, zt), (0.35, zt), (0.6, zt), (0.8, zt), (0.92, zt), (1.0, zt), (1.0, zt - 0.06),
                    (1.0, -1.17), (1.0, -1.25), (1.0, -1.31), (0.985, DAIS_B), (0, DAIS_B)], 180, deform=core_def)
    rub.add(core)
    # rubble along the collapse lip
    for i in range(18):
        th = COL_C + rng.uniform(-COL_HW * 0.8, COL_HW * 0.8)
        rr = r_break(th) - rng.uniform(0.02, 0.25)
        sz = rng.uniform(0.04, 0.16)
        c = (rr * math.cos(th * D2R), rr * math.sin(th * D2R), 0)
        rub.add(A.rest_on(A.rubble_chunk(c, (sz, sz * 0.8, sz * 0.55), rng), SLAB_B - 0.02, 0.01))
    log("floor built", f"{time.time() - t0:.1f}s")
    return flo, rub


# =============================================================================== STELAE + CHAIN
CHAIN_R = 1.08                                  # floor-ring chain anchors (radius, (theta, dir) pairs, sweep deg)
CHAIN_SPEC = ((62.0, 1.0), (118.0, -1.0))
CHAIN_SWEEP = 18.0
STAIR_R = 3.40                                  # radius where the stair leaves the dais
STELE_PLINTH = (0.33, 0.31)
FALL_ANGLE = math.degrees(math.atan2(-0.8, -0.6))   # stele D's fallen top: inward, away from the player


def stele_frame(th, r):
    return A.M4(A.rot_euler(0, 0, th - 90.0), (r * math.cos(th * D2R), r * math.sin(th * D2R), FLOOR))


def build_stelae():
    stones = {}
    bronze = A.Acc()
    anchors = {}
    for name, th, r, H, lean in STELAE:
        rng = np.random.default_rng(int(th * 10))
        acc = A.Acc()
        w, d, tap = 0.40, 0.32, 0.80
        if name == "C":
            w, d = 0.34, 0.28
        plinth = A.make_block((STELE_PLINTH[0], STELE_PLINTH[1], 0.11), rb=0.035, rb_var=0.9, step=0.12, chips=9,
                              chip_scale=0.7,
                              rng=rng, center=(0, 0, 0.11), seed=int(th), noise_amp=0.003)
        local = [plinth]
        ez = H / 2
        zc = 0.22 + ez
        mp = A.map_taper(ez, tap, tap, then=lambda W, zc=zc: W + np.array([0, 0, zc]))
        broken = (name == "D")
        zbreak = -ez + 0.42 if broken else None

        def zf_parent(x, y):
            return zbreak + 0.10 * x / w + 0.05 * y / d + 0.035 * A.fbm2(x, y, 9.0, 3, seed=9)
        if broken:
            hs = 0.5 * (zbreak + 0.08 + ez)                           # stump half height (generous)
            cs = -ez + hs
            stump = A.make_block((w / 2, d / 2, hs), rb=0.03, rb_var=0.9, step=0.08, step_z=0.1, chips=8,
                                 chip_scale=0.7, rng=rng,
                                 mapping=mp, center=(0, 0, cs), seed=7, noise_amp=0.0018,
                                 fracture_top=lambda x, y: zf_parent(x, y) - cs, frac_step=0.06)
            local.append(stump)
            hf = 0.5 * (ez - (zbreak - 0.08))
            cf = ez - hf
            top = A.make_block((w / 2, d / 2, hf), rb=0.03, rb_var=0.9, step=0.08, step_z=0.1, chips=8,
                               chip_scale=0.7, rng=rng,
                               mapping=mp, center=(0, 0, cf), seed=8, noise_amp=0.0018,
                               fracture_bottom=lambda x, y: zf_parent(x, y) - cf, frac_step=0.06)
        else:
            # stacked shaft stones (joints avoid the carved bands), each slightly turned/offset on its bed
            cuts = []          # short markers: single stones
            edges = [0.0] + cuts + [H]
            stone_tf = []
            for si in range(len(edges) - 1):
                za = -ez + edges[si] + (0.003 if si > 0 else 0.0)
                zb_ = -ez + edges[si + 1] - (0.003 if si < len(edges) - 2 else 0.0)
                hs_, cs_ = 0.5 * (zb_ - za), 0.5 * (za + zb_)
                st = A.make_block((w / 2, d / 2, hs_), rb=0.03, rb_var=0.9, step=0.08, step_z=0.1, chips=10,
                                  chip_scale=0.75,
                                  rng=rng, mapping=mp, center=(0, 0, cs_), seed=int(th) + 1 + si, noise_amp=0.0018,
                                  chip_opts={"skip_bottom": False})
                Tj = A.M4(A.rot_euler(0, 0, rng.uniform(-0.7, 0.7)),
                          (rng.uniform(-0.003, 0.003), rng.uniform(-0.003, 0.003), 0))
                st.transform(Tj)
                stone_tf.append((za + zc, zb_ + zc, Tj))
                local.append(st)
        # carved bands on the four faces (lozenge frieze, same vocabulary as the drum)
        bands = [(-ez + 0.16, -ez + 0.32)] if broken else [(ez - 0.30, ez - 0.14)]
        faces = [((w / 2), lambda u, v, h, hw=d / 2: np.stack([-u, np.full_like(u, hw) + h, v], 1)),
                 ((w / 2), lambda u, v, h, hw=d / 2: np.stack([u, -(np.full_like(u, hw) + h), v], 1)),
                 ((d / 2), lambda u, v, h, hw=w / 2: np.stack([np.full_like(u, hw) + h, u, v], 1)),
                 ((d / 2), lambda u, v, h, hw=w / 2: np.stack([-(np.full_like(u, hw) + h), -u, v], 1))]
        rel_parts = []
        for (vb, vt) in bands:
            for half, f in faces:
                fm = (lambda f: (lambda u, v, h: f(np.asarray(u, float), np.asarray(v, float),
                                                   np.asarray(h, float))))(f)
                mpf = A.compose(fm, mp)
                rel_parts += A.lozenge_frieze(-half + 0.03, half - 0.03, vb + 0.02, vt - 0.02, 2, mpf, h=0.008,
                                              wb=0.011, wt=0.0055, nail_h=0.011, small_nails=True, embed=0.003)
                rel_parts.append(A.stroke([(-half + 0.02, vb), (half - 0.02, vb)], mpf, 0.007, 0.0035, 0.006, 0.003))
                rel_parts.append(A.stroke([(-half + 0.02, vt), (half - 0.02, vt)], mpf, 0.007, 0.0035, 0.006, 0.003))
        if broken:
            top_rel = [p for p in rel_parts if p.V[:, 2].min() > zbreak + zc + 0.05]
            rel_parts = [p for p in rel_parts if p.V[:, 2].max() < zbreak + zc - 0.06]
        if not broken:
            for p in rel_parts:
                zm = p.V[:, 2].mean()
                for (za, zb_, Tj) in stone_tf:
                    if za <= zm <= zb_:
                        p.transform(Tj)
                        break
        local += rel_parts
        # bronze pyramidion (echo of the board's pyramidal corner bosses) + collar
        btop = []
        hw, hd = w / 2 * tap + 0.012, d / 2 * tap + 0.012
        zt = 0.22 + H
        col = A.make_block((hw, hd, 0.035), rb=0.004, step=0.2, center=(0, 0, zt + 0.02), seed=3, noise_amp=0)
        pyr_h = 0.55 * 2 * hw
        V = np.array([[-hw, -hd, zt + 0.055], [hw, -hd, zt + 0.055], [hw, hd, zt + 0.055], [-hw, hd, zt + 0.055],
                      [0, 0, zt + 0.055 + pyr_h]])
        pyr = A.Piece(V, [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]).fix_orientation()
        btop = [col, pyr]
        Mw = stele_frame(th, r)
        if lean:
            lean_dir = np.array([1.0, 0, 0])   # local +x (toward smaller theta for B -> toward the collapse)
            Ml = A.rot_about((-0.33, 0, 0), np.cross([0, 0, 1.0], lean_dir), lean)
        else:
            Ml = np.eye(4)
        for p in local:
            p.transform(Ml).transform(Mw)
            acc.add(p)
        if broken:
            # fallen top: lies on the floor pointing tangentially away, rolled, pyramidion knocked off
            fall = [top] + top_rel
            Mf = A.M4(A.rot_euler(0, 0, 0))
            Mf = A.rot_about((0, 0, zc + zbreak), (0, 1, 0), 86.0)
            for p in fall:
                p.transform(Mf)
                p.transform(A.rot_about((0, 0, 0), (1, 0, 0), 9.0))
            mn = min(p.V[:, 2].min() for p in fall)
            minx = min(p.V[:, 0].min() for p in fall)
            fall_rot = A.M4(A.rot_euler(0, 0, FALL_ANGLE))  # local direction the snapped top fell
            for p in fall:
                p.translate((0.58 - minx, 0.0, -mn + 0.0))
                p.transform(fall_rot)
                p.transform(Mw)
                acc.add(p)
            for p in btop:
                p.transform(A.rot_about((0, 0, zt + 0.06), (0.3, 1, 0.2), 118.0))
            mn = min(p.V[:, 2].min() for p in btop)
            cxy = np.mean(np.concatenate([p.V for p in btop]), 0)
            for p in btop:
                p.translate((0.58 + 2 * hf + 0.30 - cxy[0], 0.28 - cxy[1], -mn))
                p.transform(fall_rot)
                p.transform(Mw)
                bronze.add(p)
        else:
            for p in btop:
                p.transform(Ml).transform(Mw)
                bronze.add(p)
        if False:   # (pass02 critic) no chains on the stelae any more
            sx = 1.0 if name == "A" else -1.0
            hz = 1.45
            f = 1 + (tap - 1) * ((hz - 0.22) / H)
            fx = sx * (w / 2 * f)
            staple = A.make_block((0.012, 0.045, 0.03), rb=0.003, step=0.2, center=(fx + sx * 0.012, 0, hz),
                                  seed=5, noise_amp=0)
            ring = A.chain_link((fx + sx * 0.05, 0, hz - 0.055), (0, 0, 1.0), (0, 1.0, 0), 0.15, 0.15, 0.018)
            for p in (staple, ring):
                p.transform(Ml).transform(Mw)
                bronze.add(p)
            bot = np.array([fx + sx * 0.05, 0, hz - 0.055 - 0.075, 1.0])
            anchors[name] = (Mw @ Ml @ bot)[:3]
        stones[name] = acc
    # the rite was bound: two bronze rings leaded into the floor behind the drum, their chains lie toward the
    # drum and end in sheared links.  Behind the drum = hidden from the seated and hero views (critic S1/A1).
    rng = np.random.default_rng(5)
    for th0, sgn in CHAIN_SPEC:
        rad, tan = radial_tangent(th0)
        c = rad * CHAIN_R + np.array([0, 0, FLOOR])
        plate = A.make_block((0.05, 0.05, 0.008), rb=0.004, step=0.2, center=tuple(c + np.array([0, 0, 0.002])),
                             seed=int(th0), noise_amp=0)
        ring = A.chain_link(c + np.array([0, 0, 0.012]), tan, (0, 0, 1.0), 0.13, 0.13, 0.016)
        bronze.add([plate, ring])
        pts = []
        for i in range(12):
            t = i / 11.0
            th = th0 + sgn * CHAIN_SWEEP * t
            rr = CHAIN_R - 0.22 * t + 0.03 * math.sin(t * 6.0)
            pts.append([rr * math.cos(th * D2R), rr * math.sin(th * D2R), FLOOR + 0.03])
        bronze.add(A.chain_along(np.array(pts), Lc=0.13, Wc=0.075, rw=0.015, floor_fn=lambda x, y: FLOOR,
                                 broken_end=True, rng=rng))
    return stones, bronze


# =============================================================================== STAIR
def build_stair():
    acc = A.Acc()
    rng = np.random.default_rng(2024)
    rise, tread, half_w = 0.17, 0.36, 0.98
    y0 = STAIR_R
    # step 0: back edge follows the dais arc
    thl = math.degrees(math.atan2(math.sqrt(STAIR_R ** 2 - half_w ** 2), -half_w))
    thr = 180 - thl
    e0 = np.array([half_w, 0.5 * tread, 0.15])

    def inner(s):
        th = (thl + s * (thr - thl)) * D2R
        return np.stack([(STAIR_R + 0.005) * np.cos(th), (STAIR_R + 0.005) * np.sin(th)], 1)

    def outer(s):
        return np.stack([-half_w + 2 * half_w * s, np.full_like(s, y0 + tread)], 1)
    z_t = FLOOR - rise
    mp0 = A.map_patch(e0, inner, outer, z0=z_t - 0.15)
    acc.add(A.make_block(e0, rb=0.025, step=0.2, chips=4, rng=rng, mapping=mp0, seed=1, noise_amp=0.002,
                         chip_opts={"prefer": (0, (1, 1, 1))}))
    tops = {}
    for k in range(1, 6):
        ya, yb = y0 + tread * k - 0.06, y0 + tread * (k + 1)
        zt = FLOOR - rise * (k + 1)
        tops[k] = zt
        xsplit = rng.uniform(-0.25, 0.25)
        for (xa, xb, sd) in ((-half_w, xsplit - 0.006, 10 * k), (xsplit + 0.006, half_w, 10 * k + 1)):
            e = np.array([0.5 * (xb - xa), 0.5 * (yb - ya), 0.20])
            c = np.array([0.5 * (xa + xb), 0.5 * (ya + yb), zt - 0.20])
            crack = None
            pcs = []
            if k == 4 and sd % 2 == 0:
                rngk = np.random.default_rng(sd)
                # crack across the tread
                pos = 0.1
                pa = A.make_block(np.array([e[0], e[1] * 0.55, e[2]]), rb=0.022, step=0.2, chips=3, rng=rngk,
                                  center=(0, -e[1] * 0.45, 0), seed=sd, noise_amp=0.002,
                                  face_noise=[(1, 1, lambda a, b: 0.02 * A.fbm2(a, b, 8, 3, seed=4) - 0.005)],
                                  mapping=A.map_affine(A.M4(None, c)))
                pb = A.make_block(np.array([e[0], e[1] * 0.45, e[2]]), rb=0.022, step=0.2, chips=3, rng=rngk,
                                  center=(0, e[1] * 0.55, 0), seed=sd + 1, noise_amp=0.002,
                                  face_noise=[(1, -1, lambda a, b: 0.02 * A.fbm2(a, b, 8, 3, seed=4) + 0.005)],
                                  mapping=A.map_affine(A.M4(None, c)))
                tilt_pieces([pb], (c[0], yb, zt - 0.40), (1, 0, 0), -4.0, drop=0.02)
                pcs = [pa, pb]
            else:
                pcs = [A.make_block(e, rb=0.03, rb_var=0.9, step=0.2, chips=10, chip_scale=0.6, rng=rng,
                                    center=(0, 0, 0), seed=sd, mapping=A.map_affine(A.M4(None, c)), noise_amp=0.002,
                                    chip_opts={"prefer": (0, (1, 1, 1))})]
                # settled stone: 2-5 deg about a random horizontal axis, sunk up to 2 cm
                ax = A.normalize(np.r_[rng.normal(0, 1, 2), 0])
                tilt_pieces(pcs, (c[0], c[1], zt - 0.4), ax, rng.uniform(2.0, 5.0), drop=rng.uniform(0.0, 0.02))
            if k == 5:    # lost support: front dropped
                tilt_pieces(pcs, (c[0], ya, zt), (1, 0, 0), -11.0 - 3 * (sd % 2), drop=0.03)
            acc.add(pcs)
    # stair core under the steps (broken off with a jagged end)
    ez = 0.85
    e = np.array([half_w + 0.01, 1.05, ez])
    c = np.array([0, y0 + 1.05 + 0.02, -2.0])

    def ftop(x, y):
        yy = y + c[1]
        zline = FLOOR - rise * ((yy - y0) / tread + 1.0) - 0.22
        return zline - c[2] + 0.02 * A.fbm2(x, y, 6, 2, seed=3) - 0.12 * smoothstep(5.2, 5.6, yy)
    acc.add(A.make_block(e, rb=0.02, step=0.25, chips=3, rng=rng, center=(0, 0, 0), seed=77,
                         mapping=A.map_affine(A.M4(None, c)), fracture_top=ftop, frac_step=0.30,
                         face_noise=[(1, 1, lambda a, b: 0.12 * A.fbm2(a, b, 3, 3, seed=8))], noise_amp=0.004))
    # cheek walls (parapets) - right one broken, its coping fallen onto the steps
    for side in (-1, 1):
        for j in range(3):
            if side == 1 and j == 2:
                continue
            ya, yb = STAIR_R + 0.10 + 0.72 * j, STAIR_R + 0.10 + 0.72 * (j + 1) - 0.01
            ztop = FLOOR + 0.08 - 0.34 * j
            for course, (h, inset) in enumerate(((0.36, 0.0), (0.42, 0.02))):
                zt = ztop - course * 0.37
                e = np.array([0.14 - inset * 0.5, 0.5 * (yb - ya) - 0.004, 0.5 * h - 0.004])
                c = np.array([side * (half_w + 0.15), 0.5 * (ya + yb) + (0.18 if course else 0), zt - 0.5 * h])
                ftp = None
                if side == -1 and j == 2 and course == 0:
                    def ftp(x, y):
                        return 0.5 * h - 0.004 - 0.14 * smoothstep(-0.2, 0.36, y) + 0.03 * A.fbm2(x, y, 7, 2, seed=2)
                acc.add(A.make_block(e, rb=0.02, step=0.2, chips=3, rng=rng, seed=500 + 10 * j + course + side,
                                     mapping=A.map_affine(A.M4(None, c)), fracture_top=ftp, frac_step=0.08,
                                     noise_amp=0.002))
    # the fallen coping block of the lost right parapet, resting across steps 3-4
    e = np.array([0.14, 0.34, 0.17])
    blk = A.make_block(e, rb=0.02, step=0.2, chips=5, rng=rng, seed=900, noise_amp=0.002,
                       fracture_top=lambda x, y: 0.17 - 0.06 * smoothstep(0.0, 0.34, y) + 0.02 * A.fbm2(x, y, 7, 2, seed=1))
    blk.transform(A.M4(A.rot_euler(14, -6, 62), (0.52, y0 + tread * 3.3, 0)))
    A.rest_on(blk, tops[3] + 0.0, sink=0.03)
    acc.add(blk)
    for i in range(7):
        sz = rng.uniform(0.04, 0.12)
        k = int(rng.integers(2, 5))
        c = (rng.uniform(-0.8, 0.9), y0 + tread * (k + 0.6), 0)
        acc.add(A.rest_on(A.rubble_chunk(c, (sz, sz * 0.8, sz * 0.5), rng), tops[k], 0.01))
    return acc


# =============================================================================== checks
def board_clearance(objs):
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    bx = [(-0.38, -0.38, Z_TOP + 1e-4), (0.38, -0.38, Z_TOP + 1e-4), (0.38, 0.38, Z_TOP + 1e-4),
          (-0.38, 0.38, Z_TOP + 1e-4), (-0.38, -0.38, 0.0068), (0.38, -0.38, 0.0068), (0.38, 0.38, 0.0068),
          (-0.38, 0.38, 0.0068)]
    bf = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    box = BVHTree.FromPolygons(bx, bf)
    n = 48
    cv = [(0.45 * math.cos(A.TAU * i / n), 0.45 * math.sin(A.TAU * i / n), z) for z in (1e-5, 3.0) for i in range(n)]
    cf = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n))[::-1],
                                                                         tuple(range(n, 2 * n))]
    cyl = BVHTree.FromPolygons(cv, cf)
    rep = {"objects": {}}
    tot_in = tot_above = tot_ovb = tot_ovc = 0
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        V = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", V)
        V = V.reshape(-1, 3)
        Mw = np.array(o.matrix_world)
        V = V @ Mw[:3, :3].T + Mw[:3, 3]
        inbox = int(np.sum((np.abs(V[:, 0]) <= 0.38) & (np.abs(V[:, 1]) <= 0.38) & (V[:, 2] > Z_TOP + 1e-5)
                           & (V[:, 2] < 0.0068)))
        above = int(np.sum((np.hypot(V[:, 0], V[:, 1]) < 0.45) & (V[:, 2] > 0.0)))
        bvh = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(p.vertices) for p in me.polygons])
        ovb = len(bvh.overlap(box))
        ovc = len(bvh.overlap(cyl))
        o.evaluated_get(dg).to_mesh_clear()
        rep["objects"][o.name] = dict(verts_in_board_volume=inbox, verts_above_z0_r045=above,
                                      tri_overlaps_board_box=ovb, tri_overlaps_r045_cylinder=ovc)
        tot_in += inbox
        tot_above += above
        tot_ovb += ovb
        tot_ovc += ovc
    rep.update(total_verts_in_board_volume=tot_in, total_verts_above_z0_r045=tot_above,
               total_tri_overlaps_board_box=tot_ovb, total_tri_overlaps_r045_cyl=tot_ovc)
    return rep


def drum_top_report(drum):
    me = drum.data
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    r = np.hypot(V[:, 0], V[:, 1])
    under = (r < 0.537)
    top_under = V[under & (V[:, 2] > -0.06)]
    return dict(drum_max_z=float(V[:, 2].max()),
                drum_max_z_under_board_footprint=float(top_under[:, 2].max()) if len(top_under) else None,
                drum_min_z_of_top_under_board=float(top_under[:, 2].min()) if len(top_under) else None,
                board_base_bottom_z=Z_TOP,
                flush_gap_m=float(Z_TOP - top_under[:, 2].max()) if len(top_under) else None,
                drum_top_radius_m=float(r[V[:, 2] > Z_TOP - 0.004].max()))


# =============================================================================== scene / save / render
def build_all():
    R.reset_scene()
    scn = bpy.context.scene
    root = bpy.data.collections.new(ASSET)
    scn.collection.children.link(root)
    cdrum = bpy.data.collections.new(ASSET + "_Drum")
    cfloor = bpy.data.collections.new(ASSET + "_Floor")
    root.children.link(cdrum)
    root.children.link(cfloor)
    stone, bronze, wax, pebble, bone = build_drum()
    objs = {}
    objs["drum"] = stone.build("CFCL_Arch_AltarDrum", cdrum, [mat_stone(), mat_polished()], sharp_deg=34)
    objs["drum_bronze"] = bronze.build("CFCL_Arch_AltarDrum_Bronze", cdrum, "Bronze", sharp_deg=30)
    objs["off_wax"] = wax.build("CFCL_Arch_AltarOffering_Wax", cdrum, mat_wax(), sharp_deg=60)
    objs["off_peb"] = pebble.build("CFCL_Arch_AltarOffering_Pebbles", cdrum, M.get("AncientStone", moss=0.0), sharp_deg=50)
    objs["off_bone"] = bone.build("CFCL_Arch_AltarOffering_Bones", cdrum, "BoneStone", sharp_deg=60)
    flo, rub = build_floor()
    objs["floor"] = flo.build("CFCL_Arch_DaisFloor", cfloor, mat_stone(), sharp_deg=34)
    objs["rubble"] = rub.build("CFCL_Arch_DaisRubble", cfloor, mat_stone(), sharp_deg=34)
    st, sb = build_stelae()
    for nm, acc in st.items():
        objs["stele_" + nm] = acc.build(f"CFCL_Arch_Stele_{nm}", cfloor, mat_stone(), sharp_deg=34)
    objs["stele_bronze"] = sb.build("CFCL_Arch_SteleBronze_Chain", cfloor, "Bronze", sharp_deg=40)
    objs["stair"] = build_stair().build("CFCL_Arch_DaisStair", cfloor, mat_stone(), sharp_deg=34)
    for k, o in objs.items():
        if not k.startswith("off_"):
            try:
                M.bake_curvature(o)
            except Exception as e:
                log("curvature bake failed", o.name, e)
    log("objects built")
    return root, cdrum, cfloor, objs


def measure(objs):
    out = []
    for k, o in objs.items():
        mn, mx = R.bounds([o])
        out.append(dict(name=o.name, dims=[round(v, 4) for v in (mx - mn)],
                        bounds_min=[round(v, 4) for v in mn], bounds_max=[round(v, 4) for v in mx],
                        tris=R.tri_count([o]), materials=[m.name for m in o.data.materials if m]))
    return out


def save_asset(root, objs, checks, topr):
    os.makedirs(ADIR, exist_ok=True)
    path = os.path.join(ADIR, f"{ASSET}_v{VER:03d}.blend")
    if os.path.exists(path):
        log("WARNING version exists, not overwriting:", path)
        return path, False
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    log("saved", path)
    return path, True


def preview_rig():
    sc = bpy.context.scene
    R.setup_render(sc, "EEVEE", (1280, 720), 16 if FAST else 40)
    R.setup_world(sc)
    pc = bpy.data.collections.new("PREVIEW_ONLY")
    sc.collection.children.link(pc)
    R.standard_lights(scale=2.5, collection=pc)

    def rock_def(Rr, TH, Z, k):
        th = np.degrees(TH) % 360
        cut = np.array([min(1.0, (r_break(t) - 0.35) / 3.55) for t in th])
        f = 1 + 0.10 * A.fbm2(np.cos(TH) * 2, np.sin(TH) * 2 + Z * 0.3, 1.0, 3, seed=2)
        return Rr * f * np.where(Z > -3.0, cut, np.maximum(cut, 0.85)), Z
    rk = A.lathe([(0, DAIS_B - 0.01), (3.55, DAIS_B - 0.01), (3.7, -1.7), (3.3, -2.8), (2.4, -4.5), (1.0, -6.5),
                  (0, -7.0)], 64, deform=rock_def)
    acc = A.Acc()
    acc.add(rk)
    o = acc.build("PREVIEW_PlaceholderRock", pc, "Basalt", sharp_deg=50)
    return pc


def cam_render(name, loc, target, lens, ortho=None, res=(1280, 720)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    cam = R.camera("CFCL_ARCH_CAM_" + name, loc, target, lens)
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    p = os.path.join(RDIR, f"{TAG}_{name}.png")
    R.render_to(p, cam)
    return p


def main():
    root, cdrum, cfloor, objs = build_all()
    checks = board_clearance(list(objs.values()))
    topr = drum_top_report(objs["drum"])
    info = measure(objs)
    tri_drum = sum(i["tris"] for i in info if i["name"].startswith("CFCL_Arch_Altar"))
    tri_all = sum(i["tris"] for i in info)
    log("checks", json.dumps({k: v for k, v in checks.items() if k != "objects"}))
    log("top", json.dumps(topr))
    log("tris drum", tri_drum, "all", tri_all)
    if "--nosave" in ARGV:
        path, ok = "(not saved)", False
    else:
        path, ok = save_asset(root, objs, checks, topr)
    report = dict(version=VER, blend=os.path.basename(path), saved=ok, tris_drum_group=tri_drum, tris_total=tri_all,
                  board_clearance=checks, drum_top=topr, objects=info)
    R.write_json(os.path.join(RDIR, f"{TAG}_report.json"), report)
    if NORENDER:
        return
    # ------------------------------------------------------------------ renders (board appended AFTER save)
    preview_rig()
    R.append_board()
    renders = []
    renders.append(cam_render("a_seated", (0, -0.85, 0.55), (0, 0, 0), 32))
    renders.append(cam_render("b_low34", (-1.6, -2.2, 0.9), (0, 0, -0.2), 28))
    renders.append(cam_render("hero28", (0, -1.31, 0.22), (0, 0.8, 0.22 + 2.1 * math.tan(2 * D2R)), 28))
    renders.append(cam_render("d_carving", (0.95, -0.72, -0.06), (0.52, -0.43, -0.17), 50))
    renders.append(cam_render("d_drum_front", (0.0, -1.55, -0.18), (0, 0, -0.33), 40))
    renders.append(cam_render("e_rearleft", (-1.05, 1.05, 0.05), (-0.42, 0.42, -0.2), 40))
    renders.append(cam_render("e_vcrack", (1.12, -1.12, -0.02), (0.53, -0.53, -0.17), 45))
    if not FAST:
        renders.append(cam_render("c_top", (0, 0.95, 14.0), (0, 0.95, 0), 50, ortho=9.8, res=(900, 900)))
        renders.append(cam_render("f_dais34", (6.2, -6.0, 3.6), (0, 0.5, -0.9), 30))
        renders.append(cam_render("g_dais_back", (-4.6, 7.2, 2.4), (0, 1.0, -0.9), 30))
        renders.append(cam_render("h_collapse", (2.0, -0.6, 0.35), (2.6, 1.6, -0.95), 30))
    log("renders", renders)


if __name__ == "__main__":
    main()
