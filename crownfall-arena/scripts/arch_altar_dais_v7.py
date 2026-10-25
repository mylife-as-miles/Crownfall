"""CFCL_Arch_AltarDais v007 - the ceremonial ritual ring around the massive board (ENV UNITS).

User review of main v004: "the board trim and outer ring need more visual prestige; more carved detail /
symbolic motifs; the area just beyond the two front posts feels empty; the board should feel like the
throne-room floor of a forgotten cosmic game."  Palette: obsidian / ancient stone / crimson / ember gold.
No emblems, glyphs, heraldry or text - abstract geometric carving only (lozenge, chevron, stepped fret).

Board contract (same as v006): board square half 2.375, base Z=-0.76, top Z=-0.42; nothing inside the board
volume; nothing above Z=-0.42 within r<3.4.  World = env * 4.6 + (0,0,1.94).

Run:  python lib/run_blender.py scripts/arch_altar_dais_v7.py --timeout 2400 -- --ver 7 [--norender] [--nosave]
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
import arch_altar_dais as AD  # noqa: E402
import arch_altar_dais_board as BD  # noqa: E402
import arch_ruins_kit as KIT  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = int(ARGV[ARGV.index("--ver") + 1]) if "--ver" in ARGV else 7
NORENDER = "--norender" in ARGV
NOSAVE = "--nosave" in ARGV
FAST = "--fast" in ARGV
STONE_VALUE = float(ARGV[ARGV.index("--value") + 1]) if "--value" in ARGV else 0.62
ASSET = "CFCL_Arch_AltarDais"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "arch")
TAG = f"ring_iter{VER:02d}"
T0 = time.time()

B_HALF, B_BOT, B_TOP = BD.B_HALF, BD.B_BOT, BD.B_TOP
FLOOR, SLAB_B, DAIS_B = BD.FLOOR, BD.SLAB_B, BD.DAIS_B
R_KEEP = 3.4
BAST_C = 2.72
WS, WZ = 4.6, 1.94
r_break = BD.r_break
wrap180 = AD.wrap180
radial_tangent = AD.radial_tangent
tilt_pieces = AD.tilt_pieces
sector_stone = AD.sector_stone

# paired stelae on both processional axes (player -Y, opponent +Y); D is the snapped one
STELAE = [("A", 118.0, 4.12, 0.74, 0.0), ("B", 62.0, 4.12, 0.62, 3.0),
          ("C", 242.0, 4.12, 0.50, 0.0), ("D", 298.0, 4.12, 0.80, 0.0)]
CHAINS = ((81.0, 1.0), (99.0, -1.0), (261.0, 1.0), (279.0, -1.0))
JAMBS = (76.0, 104.0, 256.0, 284.0)
STAIR_AX = (90.0, 270.0)


def log(*a):
    print(f"[arch_v7 {time.time() - T0:6.1f}s]", *a, flush=True)


# =============================================================================== materials
def mat_ritual_stone():
    """Darker ancient stone (value x STONE_VALUE) with heat staining read from the POINT attribute cf_heat."""
    m = bpy.data.materials.get("CFCL_AncientStone_Ritual")
    if m:
        return m
    m = M.get("AncientStone").copy()
    m.name = "CFCL_AncientStone_Ritual"
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    lk = b.inputs["Base Color"].links
    src = lk[0].from_socket
    hs = nt.nodes.new("ShaderNodeHueSaturation")
    hs.inputs["Saturation"].default_value = 0.92
    hs.inputs["Value"].default_value = STONE_VALUE
    nt.links.new(src, hs.inputs["Color"])
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_type = 'GEOMETRY'
    at.attribute_name = "cf_heat"
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = 'MULTIPLY'
    mul.use_clamp = True
    mul.inputs[1].default_value = 0.85
    nt.links.new(at.outputs["Fac"], mul.inputs[0])
    soot = nt.nodes.new("ShaderNodeMix")
    soot.data_type = 'RGBA'
    nt.links.new(mul.outputs[0], soot.inputs[0])
    nt.links.new(hs.outputs["Color"], soot.inputs[6])
    soot.inputs[7].default_value = (0.030, 0.017, 0.011, 1.0)      # heat-blackened, faintly warm
    nt.links.new(soot.outputs[2], b.inputs["Base Color"])
    return m


def mat_glow():
    """CFCL_RitualInlayGlow: ember-gold inlay; Emission Strength 0 by default - the game pulses it."""
    m = bpy.data.materials.get("CFCL_RitualInlayGlow")
    if m:
        return m
    m = bpy.data.materials.new("CFCL_RitualInlayGlow")
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (0.040, 0.026, 0.016, 1.0)   # dark, smoke-blackened at rest (v009)
    b.inputs["Metallic"].default_value = 0.45
    b.inputs["Roughness"].default_value = 0.55
    b.inputs["Emission Color"].default_value = (0.888, 0.430, 0.068, 1.0)  # #f2b04a
    b.inputs["Emission Strength"].default_value = 0.0
    m["cfcl_runtime"] = "pulse Emission Strength 0 -> 3..6 (ember gold) during key game moments"
    return m


# =============================================================================== helpers
def strip_box(p0, p1, w, z_top, depth=0.006):
    """Thin flat inlay strip between two xy points, top at z_top."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    L = float(np.linalg.norm(d))
    ang = math.degrees(math.atan2(d[1], d[0]))
    c = (p0 + p1) / 2
    return A.make_block((L / 2, w / 2, depth / 2), rb=0.0, step=10.0, chips=0, noise_amp=0.0,
                        mapping=A.map_affine(A.M4(A.rot_euler(0, 0, ang), (c[0], c[1], z_top - depth / 2))), seed=1)


def arc_strip(r, w, tha, thb, z_top, depth=0.006, seg_deg=4.0):
    n = max(2, int(abs(thb - tha) / seg_deg))
    return A.sweep_sector([(r - w / 2, z_top - depth), (r + w / 2, z_top - depth), (r + w / 2, z_top),
                           (r - w / 2, z_top)], tha * D2R, thb * D2R, n, end_chamfer=0.001)


def arc_strip_safe(r, w, tha, thb, z_top, depth=0.006, margin=0.15):
    """Arc strip split into runs that avoid the collapsed edge (r_break) - never floats over the void."""
    out, run = [], None
    ths = np.arange(tha, thb + 1e-6, 2.0)
    for t in ths:
        ok = r_break(t % 360) > r + margin
        if ok and run is None:
            run = [t, t]
        elif ok:
            run[1] = t
        elif run is not None:
            if run[1] - run[0] >= 4.0:
                out.append(arc_strip(r, w, run[0], run[1], z_top, depth))
            run = None
    if run is not None and run[1] - run[0] >= 4.0:
        out.append(arc_strip(r, w, run[0], run[1], z_top, depth))
    return out


AGED = None    # accumulator for the aged-bronze inlay strips (created in main)


def mat_bronze_aged():
    """Matte aged bronze for the inlay strips: shared CFCL_Bronze darkened, desaturated and rough."""
    m = bpy.data.materials.get("CFCL_Arch_BronzeAged")
    if m:
        return m
    m = M.get("Bronze").copy()
    m.name = "CFCL_Arch_BronzeAged"
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    lk = b.inputs["Base Color"].links
    if lk:
        src = lk[0].from_socket
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Saturation"].default_value = 0.55
        hs.inputs["Value"].default_value = 0.5
        nt.links.new(src, hs.inputs["Color"])
        nt.links.new(hs.outputs["Color"], b.inputs["Base Color"])
    for l in list(b.inputs["Roughness"].links):
        nt.links.remove(l)
    b.inputs["Roughness"].default_value = 0.68
    return m


def seg_map(p0, p1, z):
    p0, p1 = np.asarray(p0[:2], float), np.asarray(p1[:2], float)
    d = p1 - p0
    L = float(np.linalg.norm(d))
    t = d / L
    n = np.array([-t[1], t[0]])

    def f(u, v, h):
        u, v, h = (np.asarray(a, float) for a in (u, v, h))
        return np.stack([p0[0] + u * t[0] + v * n[0], p0[1] + u * t[1] + v * n[1], z + h], 1)
    return f, L


def groove_line(p0, p1, z, w=0.014):
    """Glow inlay recessed in a carved groove: dark strip at +2 mm between two raised stone lips (+12 mm)."""
    f, L = seg_map(p0, p1, z)
    glow = strip_box(p0, p1, w, z + 0.002)
    lips = [A.stroke([(0.0, s * (w / 2 + 0.009)), (L, s * (w / 2 + 0.009))], f, 0.009, 0.0045, 0.012, 0.004)
            for s in (-1, 1)]
    return glow, lips


def arc_runs(r, tha, thb, margin=0.12):
    out, run = [], None
    for t in np.arange(tha, thb + 1e-6, 2.0):
        ok = r_break(t % 360) > r + margin
        if ok and run is None:
            run = [t, t]
        elif ok:
            run[1] = t
        elif run is not None:
            if run[1] - run[0] >= 4.0:
                out.append(tuple(run))
            run = None
    if run is not None and run[1] - run[0] >= 4.0:
        out.append(tuple(run))
    return out


def groove_arc(r, tha, thb, z, w=0.014, margin=0.12):
    glows, lips = [], []
    for a, b in arc_runs(r, tha, thb, margin):
        glows.append(arc_strip(r, w, a, b, z + 0.002))
        mp = A.map_annulus(r, z)
        us = np.linspace(a * D2R * r, b * D2R * r, max(3, int((b - a) / 2.0)))
        for s in (-1, 1):
            lips.append(A.stroke([(u, s * (w / 2 + 0.009)) for u in us], mp, 0.009, 0.0045, 0.012, 0.004))
    return glows, lips


def bronze_arc(r, tha, thb, z, margin=0.15):
    """Wide bevelled matte bronze band following the ring (not a flat rectangle)."""
    out = []
    for a, b in arc_runs(r, tha, thb, margin):
        mp = A.map_annulus(r, z)
        us = np.linspace(a * D2R * r, b * D2R * r, max(3, int((b - a) / 2.0)))
        out.append(A.stroke([(u, 0.0) for u in us], mp, 0.024, 0.015, 0.007, 0.004))
    return out


def near_bastion_deg(th, half):
    return min(abs(wrap180(th - d)) for d in (45.0, 135.0, 225.0, 315.0)) < half


def face_fn(Mx, which, half):
    """Relief mapping on a block face in its local frame. which: '-y','+y','+x','-x'."""
    aff = A.map_affine(Mx)
    hx, hy, hz = half

    def f(u, v, h):
        u, v, h = (np.asarray(a, float) for a in (u, v, h))
        if which == "-y":
            P = np.stack([u, -hy - h, v], 1)
        elif which == "+y":
            P = np.stack([-u, hy + h, v], 1)
        elif which == "+x":
            P = np.stack([hx + h, u, v], 1)
        else:
            P = np.stack([-hx - h, -u, v], 1)
        return aff(P)
    return f


# =============================================================================== skirt (board trim)
def build_skirt():
    stone, bronze, glow = A.Acc(), A.Acc(), A.Acc()
    rng = np.random.default_rng(700)
    kin = B_HALF + 0.010
    # layered courses: plinth step (projects), carved body (fret band), moulded cap with inlays
    courses = [("plinth", kin, 2.735, FLOOR, FLOOR + 0.035, 5, 0.012),
               ("body", kin + 0.010, 2.645, FLOOR + 0.035, FLOOR + 0.155, 6, 0.02),
               ("cap", kin + 0.005, 2.675, FLOOR + 0.155, FLOOR + 0.19, 4, 0.015)]
    xend = 2.385
    for side in range(4):
        Rz = A.rot_euler(0, 0, side * 90.0)
        for (cn, yin, yout, z0, z1, n, rb) in courses:
            edges = np.linspace(-xend, xend, n + 1)
            for i in range(n):
                xa, xb = edges[i] + 0.004, edges[i + 1] - 0.004
                c_loc = np.array([0.5 * (xa + xb), -(yin + yout) / 2, 0.5 * (z0 + z1)])
                half = np.array([(xb - xa) / 2, (yout - yin) / 2, (z1 - z0) / 2 - 0.0015])
                Mx = A.M4(Rz, Rz @ c_loc) @ A.M4(A.rot_euler(0, 0, rng.uniform(-0.4, 0.4)))
                seed = 7000 + side * 100 + i + (0 if cn == "plinth" else 30 if cn == "body" else 60)
                b = A.make_block(half, rb=rb, rb_var=0.9, step=0.3, chips=5, chip_scale=0.45,
                                 rng=np.random.default_rng(seed), mapping=A.map_affine(Mx), seed=seed,
                                 noise_amp=0.0015, chip_opts={"prefer": (0, (1, -1, 1)), "prefer_p": 0.85})
                stone.add(b)
                if cn == "body":   # deep stepped-fret band on the outer face
                    f = face_fn(Mx, "-y", half)
                    nu = max(3, int(round((xb - xa) / 0.15)))
                    stone.add(A.fret_band(-half[0] + 0.04, half[0] - 0.04, -0.035, 0.03, nu, f, h=0.022, wb=0.012,
                                          wt=0.006, embed=0.012))
                if cn == "cap":    # bronze strip along the inner edge + glow groove along the middle
                    ztop = z1 + 0.0
                    p0 = Rz @ np.array([xa + 0.01, -(kin + 0.035), 0])
                    p1 = Rz @ np.array([xb - 0.01, -(kin + 0.035), 0])
                    fb_, Lb = seg_map(p0, p1, ztop)
                    AGED.add(A.stroke([(0.0, 0.0), (Lb, 0.0)], fb_, 0.020, 0.013, 0.006, 0.004))
                    q0 = Rz @ np.array([xa + 0.02, -2.56, 0])
                    q1 = Rz @ np.array([xb - 0.02, -2.56, 0])
                    gl, lp = groove_line(q0[:2], q1[:2], ztop, 0.012)
                    glow.add(gl)
                    stone.add(lp)
                    # carved chevron chain between the bronze strip and the glow groove, nailheads outboard
                    Rz4 = A.M4(Rz)

                    def topmap(u, v, h, z=ztop, Rz4=Rz4):
                        u, v, h = (np.asarray(a, float) for a in (u, v, h))
                        P = np.stack([u, -v, z + h], 1)
                        return P @ Rz4[:3, :3].T
                    nu = max(3, int(round((xb - xa) / 0.13)))
                    stone.add(A.lozenge_frieze(xa + 0.03, xb - 0.03, 2.445, 2.535, nu, topmap, h=0.010, wb=0.010,
                                               wt=0.005, nail_h=0.014, phases=(0,), embed=0.006))
                    for uu in np.linspace(xa + 0.06, xb - 0.06, max(2, int((xb - xa) / 0.12))):
                        stone.add(A.nailhead(uu, 2.62, 0.022, 0.022, 0.016, topmap, embed=0.005))
    # corner bastions: layered base / carved body / cap, bronze plate + pyramid, glow square around it
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        cx, cy = sx * BAST_C, sy * BAST_C
        seed = 7900 + 10 * k
        layers = [(0.33, FLOOR, FLOOR + 0.04), (0.28, FLOOR + 0.04, FLOOR + 0.21), (0.31, FLOOR + 0.21, FLOOR + 0.25)]
        cracked = (sx, sy) == (1, 1)
        for li, (hh, z0, z1) in enumerate(layers):
            half = np.array([hh, hh, (z1 - z0) / 2 - 0.0015])
            Mx = A.M4(A.rot_euler(0, 0, rng.uniform(-0.8, 0.8)), (cx, cy, 0.5 * (z0 + z1)))
            if cracked and li == 1:
                for (ca, fn) in ((-0.5, 1), (0.5, -1)):
                    hh2 = half.copy()
                    hh2[0] = half[0] * 0.5 - 0.004
                    pc = A.make_block(hh2, rb=0.025, rb_var=0.9, step=0.2, chips=4, chip_scale=0.5,
                                      rng=np.random.default_rng(seed + li + int(ca * 10)), mapping=A.map_affine(Mx),
                                      center=(ca * half[0], 0, 0), seed=seed, noise_amp=0.0015,
                                      face_noise=[(0, fn, lambda a, b: 0.025 * A.fbm2(a, b, 6, 2, seed=4))])
                    if ca > 0:
                        tilt_pieces([pc], (cx + 0.28, cy, FLOOR + 0.04), (0, 1, 0), 3.0, drop=0.012)
                    stone.add(pc)
            else:
                stone.add(A.make_block(half, rb=0.025, rb_var=0.9, step=0.2, chips=4, chip_scale=0.5,
                                       rng=np.random.default_rng(seed + li), mapping=A.map_affine(Mx), seed=seed + li,
                                       noise_amp=0.0015, chip_opts={"only_top": True}))
            if li == 1:
                for which, s in (("+x" if sx > 0 else "-x", 1), ("+y" if sy > 0 else "-y", 1)):
                    f = face_fn(Mx, which, half)
                    stone.add(A.lozenge_frieze(-hh + 0.06, hh - 0.06, -0.05, 0.05, 2, f, h=0.022, wb=0.018, wt=0.009,
                                               nail_h=0.03, embed=0.012))
        zt = FLOOR + 0.25
        hw = 0.21
        plate = A.make_block((hw + 0.02, hw + 0.02, 0.018), rb=0.004, step=0.5, center=(cx, cy, zt + 0.016),
                             seed=seed + 5, noise_amp=0)
        Vp = np.array([[cx - hw, cy - hw, zt + 0.034], [cx + hw, cy - hw, zt + 0.034], [cx + hw, cy + hw, zt + 0.034],
                       [cx - hw, cy + hw, zt + 0.034], [cx, cy, zt + 0.034 + 0.15]])
        pyr = A.Piece(Vp, [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]).fix_orientation()
        if cracked:
            grp = [plate, pyr]
            Mf = A.rot_about((cx, cy, zt + 0.05), (1, -1, 0.3), 105.0)
            for p in grp:
                p.transform(Mf)
            mn = min(p.V[:, 2].min() for p in grp)
            ctr = np.mean(np.concatenate([p.V for p in grp]), 0)
            dst = np.array([4.09 * math.cos(38 * D2R), 4.09 * math.sin(38 * D2R)])
            for p in grp:
                p.translate((dst[0] - ctr[0], dst[1] - ctr[1], FLOOR - mn - 0.01))
            bronze.add(grp)
        else:
            bronze.add([plate, pyr])
        # glow square on the cap around the plate (outside r 3.4)
        g = 0.272
        corners = [(cx - g, cy - g), (cx + g, cy - g), (cx + g, cy + g), (cx - g, cy + g)]
        for i in range(4):
            gl, lp = groove_line(corners[i], corners[(i + 1) % 4], zt, 0.012)
            glow.add(gl)
            stone.add(lp)
    return stone, bronze, glow


# =============================================================================== floor (ceremonial ring)
def protected7(r_in, r_out, tha, thb):
    pts = []
    for r in np.linspace(r_in, r_out, 4):
        for th in np.linspace(tha, thb, 5):
            pts.append((r * math.cos(th * D2R), r * math.sin(th * D2R)))
    pts = np.array(pts)
    if np.any((np.abs(pts[:, 0]) < B_HALF + 0.40) & (np.abs(pts[:, 1]) < B_HALF + 0.40)):
        return True
    if np.any(BD.in_bastion(pts, 0.25)):
        return True
    for _n, th, r, _h, _l in STELAE:
        c = np.array([r * math.cos(th * D2R), r * math.sin(th * D2R)])
        if np.any(np.linalg.norm(pts - c, axis=1) < 0.55):
            return True
    thm = 0.5 * (tha + thb)
    if any(abs(wrap180(thm - ax)) < 20 for ax in STAIR_AX) and r_out > 3.9:   # landings, chains, jambs
        return True
    if r_out <= 3.95:      # the sacred inner rings (R1, channel, kerbs) stay intact except where the edge fell
        return True
    return False


def build_floor():
    BD.STELAE = STELAE
    BD.protected = protected7
    BD.BAST_C = BAST_C
    flo, rub, glow, bronze = A.Acc(), A.Acc(), A.Acc(), A.Acc()
    rng = np.random.default_rng(7100)
    # core bed under board + skirt
    flo.add(A.make_block((2.76, 2.76, 0.14), rb=0.02, step=1.0, chips=0, rng=np.random.default_rng(1), noise_amp=0.0,
                         mapping=A.map_affine(A.M4(None, (0, 0, FLOOR - 0.14))), seed=1))
    # R1: 16 paving wedges separated by 12 raised radial rib stones pointing at the board (diagonals carry the
    # bastions instead); a glow inlay runs down the middle of every wedge
    RIB_HALF = 1.15
    for k in range(16):
        phi = k * 22.5
        rib = (phi % 90.0) != 45.0
        a0 = phi + (RIB_HALF + 0.25 if rib else 0.0)
        nxt = phi + 22.5
        rib_n = (nxt % 90.0) != 45.0
        a1 = nxt - (RIB_HALF + 0.25 if rib_n else 0.0)
        flo.add(sector_stone(2.75, 3.55, a0, a1, SLAB_B, FLOOR, 7200 + k, gap=0.012, rb=0.02, step=0.35, step_z=0.3,
                             chips=3, chip_scale=0.6, prefer=(0, (1, 1, 1)), noise_amp=0.0008))
        Rf = 3.30
        mpa = A.map_annulus(Rf, FLOOR)
        ua, ub = a0 * D2R * Rf + 0.05, a1 * D2R * Rf - 0.05
        if ub - ua > 0.3:
            flo.add(A.fret_band(ua, ub, 0.025, 0.105, max(3, int((ub - ua) / 0.16)), mpa, h=0.012, wb=0.011,
                                wt=0.0055, embed=0.006))
        if rib:
            mx = max(abs(math.cos(phi * D2R)), abs(math.sin(phi * D2R)))
            rs = max(2.78, 2.78 / mx)
            pcs = sector_stone(rs, 3.55, phi - RIB_HALF, phi + RIB_HALF, SLAB_B + 0.05, FLOOR + 0.032, 7300 + k,
                               gap=0.006, rb=0.018, step=0.3, step_z=0.3, chips=3, chip_scale=0.5, noise_amp=0.001)
            flo.add(pcs)
            mpf = A.map_radial(phi * D2R, FLOOR + 0.032)
            n_u = max(2, int((3.48 - rs - 0.06) / 0.11))
            flo.add(A.lozenge_frieze(rs + 0.05, 3.48, -0.035, 0.035, n_u, mpf, h=0.012, wb=0.012, wt=0.006,
                                     nail_h=0.016, phases=(0,), embed=0.006))
            flo.add(A.nailhead(3.505, 0.0, 0.04, 0.04, 0.03, mpf, embed=0.006))
        # radial glow inlay in the middle of the wedge
        pm = phi + 11.25
        mx = max(abs(math.cos(pm * D2R)), abs(math.sin(pm * D2R)))
        rs = max(2.86, 2.82 / mx)
        if 3.26 - rs > 0.12:
            u = np.array([math.cos(pm * D2R), math.sin(pm * D2R)])
            gl, lp = groove_line(u * rs, u * 3.26, FLOOR, 0.014)
            glow.add(gl)
            flo.add(lp)
    # concentric glow inlay at r 3.505 (between rib ends and the channel kerb), broken by the bastions
    starts = [b + 9 for b in (45.0, 135.0, 225.0, 315.0)]
    for s0 in starts:
        gls, lps = groove_arc(3.505, s0, s0 + 72.0, FLOOR, 0.014, margin=0.12)
        glow.add(gls)
        flo.add(lps)
    skipb = lambda c: bool(BD.in_bastion(c[None, :2], 0.10)[0])   # noqa: E731

    def chan_relief(tha, thb):   # deeper lozenge relief in the sunken channel
        Rr = 3.62 + 0.007
        mp = A.map_annulus(Rr, FLOOR - 0.055)
        a0, a1 = tha * D2R, thb * D2R
        u0, u1 = a0 * Rr + 0.035, a1 * Rr - 0.035
        return A.lozenge_frieze(u0, u1, 0.025, 0.215, 3, mp, h=0.024, wb=0.020, wt=0.010, nail_h=0.03,
                                nail_scale=0.5, small_nails=True, embed=0.006)
    BD.ring(flo, rub, 3.55, 3.62, 40, 0.0, FLOOR, SLAB_B, 7400, step=0.35, rb=0.025, skip=skipb, name="Ki")
    BD.ring(flo, rub, 3.62, 3.86, 32, 4.0, FLOOR - 0.055, SLAB_B, 7500, step=0.35, rb=0.02, relief=chan_relief,
            skip=skipb, name="Channel")
    BD.ring(flo, rub, 3.86, 3.93, 40, 4.5, FLOOR, SLAB_B, 7600, step=0.35, rb=0.025, skip=skipb, name="Ko")
    # bronze strips on both channel kerbs (ember-gold inlay), broken by the bastions
    for s0 in starts:
        AGED.add(bronze_arc(3.585, s0 + 4, s0 + 68.0, FLOOR))
        AGED.add(bronze_arc(3.895, s0 + 6, s0 + 66.0, FLOOR))

    # R2 with abstract rosettes (nested lozenges) on alternate slabs, away from stelae/chains/landings
    def rosette_relief(tha, thb):
        thm = 0.5 * (tha + thb)
        k = int(round((thm - 2.0 - 4.5) / 9.0))
        if k % 2:
            return []
        if any(abs(wrap180(thm - ax)) < 24 for ax in STAIR_AX):
            return []
        for _n, th, _r, _h, _l in STELAE:
            if abs(wrap180(thm - th)) < 9:
                return []
        if near_bastion_deg(thm, 7.0):
            return []
        mp = A.map_radial(thm * D2R, FLOOR)
        return A.rosette(4.09, 0.0, 0.085, mp, h=0.014, wb=0.016, wt=0.008, embed=0.006)
    BD.ring(flo, rub, 3.93, 4.25, 40, 2.0, FLOOR, SLAB_B, 7700, step=0.35, relief=rosette_relief, name="R2")
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = (sx * BAST_C, sy * BAST_C, FLOOR - 0.14)
            flo.add(A.make_block((0.47, 0.47, 0.14), rb=0.02, step=1.0, chips=3, rng=np.random.default_rng(7),
                                 mapping=A.map_affine(A.M4(None, c)), seed=7, noise_amp=0.0015))
    # cornice (both stair openings) + low carved parapet + carved frieze course
    F = FLOOR
    prof = [(4.25, F), (4.465, F), (4.50, F - 0.03), (4.50, F - 0.10), (4.485, F - 0.135), (4.455, F - 0.165),
            (4.415, F - 0.185), (4.375, F - 0.192), (4.375, SLAB_B), (4.25, SLAB_B)]
    n = 44
    for k in range(n):
        tha = 4.0 + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        if any(abs(wrap180(thm - ax)) < 14.5 for ax in STAIR_AX) or r_break(thm) < 4.55:
            continue
        g = 0.006 / 4.4
        pc = A.sweep_sector(prof, tha * D2R + g, thb * D2R - g, 4, end_chamfer=0.014)
        rad, tan = radial_tangent(thm)
        for end in (tha, thb):
            if rng.uniform() < 0.7:
                re, te = radial_tangent(end)
                p0 = np.array([4.50 * re[0], 4.50 * re[1], FLOOR])
                nvec = A.normalize(re + np.array([0, 0, 1.0]) + (te if end == tha else -te) * 0.9 + rng.normal(0, 0.2, 3))
                A.chip(pc.V, p0, nvec, rng.uniform(0.015, 0.05), 0.13)
        pc.displace(0.0015, 7.0, seed=k)
        flo.add(pc)
        # low parapet stone on the cornice with a stepped-fret band on its lava-facing face
        if r_break(thm) < 4.62 or rng.uniform() < 0.12:
            continue
        pz0, pz1 = FLOOR, FLOOR + 0.13
        pcs = sector_stone(4.31, 4.47, tha, thb, pz0, pz1, 7800 + k, gap=0.01, rb=0.02, step=0.3, step_z=0.3, chips=4,
                           chip_scale=0.6, prefer=(0, (1, 1, 1)), noise_amp=0.0015)
        Rr = 4.47 - 0.005
        mp = A.map_cyl(Rr, 0.0)
        a0, a1 = tha * D2R, thb * D2R
        spn = (a1 - a0) * Rr
        rel = A.fret_band(a0 * Rr + 0.06 * spn, a1 * Rr - 0.06 * spn, pz0 + 0.035, pz0 + 0.095, 3, mp, h=0.016,
                          wb=0.012, wt=0.006, embed=0.008)
        allp = pcs + rel
        if abs(wrap180(thm - 270)) > 50 and rng.uniform() < 0.25:     # slumped outward toward the abyss
            tilt_pieces(allp, (4.47 * rad[0], 4.47 * rad[1], pz0), tan, rng.uniform(4, 12), drop=rng.uniform(0.0, 0.03))
        flo.add(allp)
    n = 32
    for k in range(n):
        tha = 3.0 + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        if any(abs(wrap180(thm - ax)) < 13.0 for ax in STAIR_AX) or r_break(thm) < 4.45:
            continue
        pcs = sector_stone(3.95, 4.36, tha, thb, DAIS_B + 0.004, SLAB_B - 0.004, 7900 + k, gap=0.012, rb=0.02,
                           step=0.3, step_z=0.3, chips=3, prefer=(0, (1, 1, -1)), noise_amp=0.002)
        Rr = 4.36 - 0.006
        mp = A.map_cyl(Rr, 0.0)
        a0, a1 = tha * D2R, thb * D2R
        spn = (a1 - a0) * Rr
        u0, u1 = a0 * Rr + 0.1 * spn, a1 * Rr - 0.1 * spn
        rel = A.lozenge_frieze(u0, u1, -1.285, -1.115, 3, mp, h=0.02, wb=0.018, wt=0.009, nail_h=0.026,
                               small_nails=False, embed=0.008)
        rel.append(A.stroke([(u0, -1.30), (u1, -1.30)], mp, 0.009, 0.005, 0.008, 0.004))
        rel.append(A.stroke([(u0, -1.10), (u1, -1.10)], mp, 0.009, 0.005, 0.008, 0.004))
        flo.add(pcs + rel)

    def core_def(Rr, TH, Z, k):
        th = np.degrees(TH) % 360
        rc = np.array([min(3.97, r_break(t) - 0.12) for t in th])
        side = Rr > 0.99
        jit = 0.06 * A.fbm2(np.cos(TH) * 3.0, np.sin(TH) * 3.0 + Z * 2.0, 2.0, 3, seed=5) * (rc < 3.95)
        Rw = Rr * rc + jit * side
        top = Z > SLAB_B - 0.05
        Zw = Z + top * 0.018 * A.fbm2(Rw * np.cos(TH), Rw * np.sin(TH), 3.0, 3, seed=6)
        return Rw, Zw
    zt = SLAB_B - 0.022
    rub.add(A.lathe([(0, zt), (0.6, zt), (0.85, zt), (0.95, zt), (1.0, zt), (1.0, zt - 0.06), (1.0, -1.2),
                     (1.0, -1.3), (0.985, DAIS_B), (0, DAIS_B)], 140, deform=core_def))
    for i in range(22):
        th = BD.COL_C + rng.uniform(-BD.COL_HW * 0.8, BD.COL_HW * 0.8)
        rr = r_break(th) - rng.uniform(0.02, 0.25)
        sz = rng.uniform(0.05, 0.18)
        cc = (rr * math.cos(th * D2R), rr * math.sin(th * D2R), 0)
        rub.add(A.rest_on(A.rubble_chunk(cc, (sz, sz * 0.8, sz * 0.55), rng), SLAB_B - 0.02, 0.01))
    return flo, rub, glow, bronze


# =============================================================================== processional approaches
def jamb(th, seed, broken=False):
    """Threshold jamb flanking a stair head: base + two carved drums of a square pier (fret band)."""
    rad, tan = radial_tangent(th)
    c = rad * 4.31
    yaw = th - 90.0
    out = []
    z = FLOOR
    for li, (hh, h) in enumerate(((0.19, 0.08), (0.15, 0.30), (0.15, 0.30))):
        if broken and li == 2:
            break
        Mx = A.M4(A.rot_euler(0, 0, yaw + (li - 1) * 1.5), (c[0], c[1], z + h / 2))
        half = np.array([hh, hh, h / 2 - 0.002])
        ft = None
        if broken and li == 1:
            def ft(x, y, h=h):
                return h / 2 - 0.08 - 0.12 * (x / 0.15) + 0.02 * A.fbm2(x, y, 7, 2, seed=seed)
        b = A.make_block(half, rb=0.02, rb_var=0.9, step=0.2, chips=5, chip_scale=0.6, rng=np.random.default_rng(seed + li),
                         mapping=A.map_affine(Mx), seed=seed + li, noise_amp=0.0015, fracture_top=ft, frac_step=0.06)
        out.append(b)
        if li >= 1 and ft is None:
            for which in ("-y", "+x", "-x"):
                f = face_fn(Mx, which, half)
                out += A.fret_band(-hh + 0.03, hh - 0.03, -0.06, 0.02, 2, f, h=0.014, wb=0.01, wt=0.005, embed=0.008)
        z += h
    return out


def build_approaches():
    stone, bronze = A.Acc(), A.Acc()
    AD.STAIR_R = 4.50
    up = AD.build_stair()
    down = AD.build_stair()
    for p in down.pieces:
        p.transform(A.M4(A.rot_euler(0, 0, 180.0)))
    stone.add(up.pieces)
    stone.add(down.pieces)
    for i, th in enumerate(JAMBS):
        stone.add(jamb(th, 8100 + 10 * i, broken=(i == 1)))
    rng = np.random.default_rng(8200)
    # the fallen carved threshold lintel of the +Y gate: broken in two, one half lying down the stair slope
    for piece, (cx, cy, yaw, slope, L) in enumerate(((-0.40, 5.05, 9.0, True, 1.05), (0.62, 5.62, -14.0, True, 0.8))):
        half = np.array([L / 2, 0.16, 0.13])
        b = A.make_block(half, rb=0.02, rb_var=0.9, step=0.2, chips=6, chip_scale=0.6, rng=rng, seed=8300 + piece,
                         noise_amp=0.0015, face_noise=[(0, 1 if piece == 0 else -1,
                                                        lambda a, bb: 0.03 * A.fbm2(a, bb, 6, 2, seed=8))])
        rel = A.fret_band(-L / 2 + 0.05, L / 2 - 0.05, -0.07, 0.03, max(3, int(L / 0.17)),
                          lambda u, v, h: np.stack([np.asarray(u, float), -0.16 - np.asarray(h, float),
                                                    np.asarray(v, float)], 1), h=0.016, wb=0.012, wt=0.006, embed=0.008)
        grp = [b] + rel
        Mx = A.M4(A.rot_euler(-24.0 if slope else 0.0, 0, yaw)) if slope else A.M4(A.rot_euler(0, -88.0, yaw))
        for p in grp:
            p.transform(Mx)
            p.translate((cx, cy, 0))
        if slope:   # lie on the nosing line of the stair
            def zline(y):
                return FLOOR - 0.17 * (y - 4.5) / 0.36
            V = np.concatenate([p.V for p in grp])
            dz = np.min(V[:, 2] - zline(V[:, 1]))
            for p in grp:
                p.translate((0, 0, -dz - 0.01))
        else:
            mn = min(p.V[:, 2].min() for p in grp)
            for p in grp:
                p.translate((0, 0, FLOOR - mn - 0.01))
        stone.add(grp)
    # broken terrace below the +Y stair (where its lost lower flight fell): paving on a rubble mass
    e = np.array([1.75, 0.75, 0.62])
    c = np.array([0.15, 7.45, -2.05 - 0.62])

    def ftop(x, y):
        return 0.62 - 0.03 + 0.04 * A.fbm2(x, y, 2.5, 2, seed=3) - 0.25 * smoothstep(1.2, 1.75, abs(x))
    stone.add(A.make_block(e, rb=0.04, step=0.6, chips=4, rng=rng, mapping=A.map_affine(A.M4(None, c)), seed=8400,
                           fracture_top=ftop, frac_step=0.35, noise_amp=0.012,
                           face_noise=[(1, 1, lambda a, b: 0.15 * A.fbm2(a, b, 2, 2, seed=9)),
                                       (0, 1, lambda a, b: 0.12 * A.fbm2(a, b, 2, 2, seed=10)),
                                       (0, -1, lambda a, b: 0.12 * A.fbm2(a, b, 2, 2, seed=11))]))
    zt = -2.05
    for i, (x0, x1, y0, y1) in enumerate(((-1.25, -0.42, 6.85, 7.55), (-0.38, 0.45, 6.85, 7.6), (0.5, 1.3, 6.85, 7.5),
                                           (-1.2, -0.4, 7.6, 8.05), (0.48, 1.25, 7.55, 8.1))):
        b = A.make_block(np.array([(x1 - x0) / 2, (y1 - y0) / 2, 0.08]), rb=0.025, rb_var=0.9, step=0.3, chips=5,
                         chip_scale=0.6, rng=rng, seed=8410 + i, noise_amp=0.002,
                         mapping=A.map_affine(A.M4(A.rot_euler(*rng.uniform(-3, 3, 2), rng.uniform(-3, 3)),
                                                   ((x0 + x1) / 2, (y0 + y1) / 2, zt - 0.08 + rng.uniform(-0.03, 0.0)))))
        stone.add(b)
    # half-buried carved ring segment (a fallen gate halo) beside the terrace, leaning away from the board
    ring = KIT.build_ring()
    for p in ring:
        p.transform(A.M4(np.eye(3) * 0.48))
        p.transform(A.M4(A.rot_euler(0, 0, -20.0), (1.15, 7.85, zt - 0.10)))
    stone.add(ring)
    # fallen blocks from the lost flight / parapets: on the terrace and on the lower steps
    for i in range(7):
        sz = rng.uniform(0.10, 0.22)
        b = A.make_block(np.array([sz * 1.6, sz, sz * 0.8]), rb=0.025, rb_var=0.9, step=0.3, chips=5, chip_scale=0.6,
                         rng=rng, seed=8500 + i, noise_amp=0.002)
        x = rng.uniform(-1.3, 1.3)
        y = rng.uniform(6.95, 7.95)
        b.transform(A.M4(A.rot_euler(rng.uniform(-25, 25), rng.uniform(-25, 25), rng.uniform(0, 180)), (x, y, 0)))
        A.rest_on(b, zt, sink=0.03)
        stone.add(b)
    for i in range(10):
        sz = rng.uniform(0.04, 0.12)
        cc = (rng.uniform(-1.5, 1.5), rng.uniform(6.9, 8.1), 0)
        stone.add(A.rest_on(A.rubble_chunk(cc, (sz, sz * 0.8, sz * 0.55), rng), zt, 0.02))
    # paired stelae on both axes + floor-ring chains (re-using the arch_altar_dais builders)
    AD.STELAE = STELAE
    AD.STELE_PLINTH = (0.25, 0.24)
    AD.CHAIN_R = 4.10
    AD.CHAIN_SPEC = CHAINS
    AD.CHAIN_SWEEP = 7.0
    AD.FALL_ANGLE = 0.0
    st, sb = AD.build_stelae()
    return stone, bronze, st, sb


# =============================================================================== attributes / checks
def add_heat(ob, extra_low=True):
    """POINT attribute cf_heat 0..1: lava-facing outer edge, the collapse lip and low hanging parts."""
    me = ob.data
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    r = np.hypot(V[:, 0], V[:, 1])
    th = (np.degrees(np.arctan2(V[:, 1], V[:, 0])) + 360) % 360
    rb = np.array([r_break(t) for t in th])
    h = smoothstep(4.05, 4.55, r) * 0.9
    h = np.maximum(h, smoothstep(rb - 0.6, rb, r) * (rb < 9))
    if extra_low:
        h = np.maximum(h, smoothstep(-1.15, -1.9, V[:, 2]) * 0.8)
    h = h * (0.75 + 0.25 * A.fbm3(V * 2.0, 1.0, 2, seed=3))
    at = me.attributes.get("cf_heat") or me.attributes.new("cf_heat", 'FLOAT', 'POINT')
    at.data.foreach_set("value", np.clip(h, 0, 1).astype(np.float32))


def main():
    R.reset_scene()
    scn = bpy.context.scene
    root = bpy.data.collections.new(ASSET)
    scn.collection.children.link(root)
    cs = bpy.data.collections.new(ASSET + "_BoardSkirt")
    cf = bpy.data.collections.new(ASSET + "_Floor")
    ca = bpy.data.collections.new(ASSET + "_Approaches")
    for c in (cs, cf, ca):
        root.children.link(c)
    stone_m = mat_ritual_stone()
    glow_m = mat_glow()
    global AGED
    AGED = A.Acc()
    objs = {}
    s, b, g = build_skirt()
    for acc in (s, b, g):
        BD.clamp_under_board(acc)
    objs["skirt"] = s.build("CFCL_Arch_BoardSkirt", cs, stone_m, sharp_deg=34)
    objs["skirt_bronze"] = b.build("CFCL_Arch_BoardSkirt_Bronze", cs, "Bronze", sharp_deg=30)
    flo, rub, fg, fb = build_floor()
    for acc in (flo, rub):
        BD.clamp_under_board(acc, margin=0.2)
    objs["floor"] = flo.build("CFCL_Arch_DaisFloor", cf, stone_m, sharp_deg=34)
    objs["rubble"] = rub.build("CFCL_Arch_DaisRubble", cf, stone_m, sharp_deg=34)
    gall = A.Acc()
    gall.add(g.pieces)
    gall.add(fg.pieces)
    objs["glow"] = gall.build("CFCL_Arch_RitualInlay_Glow", cs, glow_m, sharp_deg=30)
    AGED.add(fb.pieces)
    objs["floor_bronze"] = AGED.build("CFCL_Arch_RitualInlay_Bronze", cf, mat_bronze_aged(), sharp_deg=40)
    # sediment in the sunken channel + small domed moss cushions in carving angles (never flat cards)
    sed, mos = A.Acc(), A.Acc()
    rngm = np.random.default_rng(9100)
    for k in range(10):
        t0 = rngm.uniform(0, 360)
        if BD.r_break(t0) < 4.0 or near_bastion_deg(t0, 12):
            continue
        span = rngm.uniform(10, 28)
        pcs = A.sweep_sector([(3.633, FLOOR - 0.056), (3.847, FLOOR - 0.056), (3.847, FLOOR - 0.040),
                              (3.78, FLOOR - 0.046), (3.70, FLOOR - 0.044), (3.633, FLOOR - 0.039)],
                             t0 * D2R, (t0 + span) * D2R, max(4, int(span / 2)), end_chamfer=0.05)
        sed.add(pcs)
    for i in range(46):
        kind = rngm.uniform()
        if kind < 0.45:      # in the channel, between the carved lozenges
            th = rngm.uniform(0, 360)
            rr = rngm.uniform(3.65, 3.83)
            z = FLOOR - 0.045
        elif kind < 0.75:    # angle between the skirt plinth and the paving
            sd = rngm.integers(4)
            t = rngm.uniform(-2.2, 2.2)
            x, y = [(2.76, t), (-t, 2.76), (-2.76, -t), (t, -2.76)][sd]
            rr, th, z = math.hypot(x, y), math.degrees(math.atan2(y, x)), FLOOR
        else:                # along rib-stone flanks
            th = rngm.integers(16) * 22.5 + rngm.choice([-1.6, 1.6])
            rr = rngm.uniform(3.05, 3.5)
            z = FLOOR
        if BD.r_break(th % 360) < rr + 0.2:
            continue
        c = (rr * math.cos(th * D2R), rr * math.sin(th * D2R), z)
        if abs(c[0]) < B_HALF + 0.3 and abs(c[1]) < B_HALF + 0.3 and kind >= 0.75:
            continue
        mos.add(KIT.pad(c, rngm.uniform(0.03, 0.075), rngm.uniform(0.025, 0.06), rngm.uniform(0.012, 0.03), rngm,
                        sink=0.01).set_mat(0))
    BD.clamp_under_board(mos, margin=0.2)
    objs["sediment"] = sed.build("CFCL_Arch_RitualSediment", cf, M.get("MossDry"), sharp_deg=40)
    objs["moss"] = mos.build("CFCL_Arch_RitualMoss", cf, M.get("Moss"), sharp_deg=60)
    ap, apb, st, sb = build_approaches()
    objs["approaches"] = ap.build("CFCL_Arch_Approaches", ca, stone_m, sharp_deg=34)
    for nm, acc in st.items():
        objs["stele_" + nm] = acc.build(f"CFCL_Arch_Stele_{nm}", ca, stone_m, sharp_deg=34)
    objs["stele_bronze"] = sb.build("CFCL_Arch_SteleBronze_Chain", ca, "Bronze", sharp_deg=40)
    for k, o in objs.items():
        if "bronze" in k or k in ("glow", "moss", "sediment"):
            continue
        try:
            M.bake_curvature(o)
        except Exception as e:
            log("curvature bake failed", o.name, e)
        add_heat(o, extra_low=(k != "skirt"))
    checks = BD.clearance(list(objs.values()))
    info = []
    for k, o in objs.items():
        mn, mx = R.bounds([o])
        info.append(dict(name=o.name, dims=[round(v, 4) for v in (mx - mn)], bounds_min=[round(v, 4) for v in mn],
                         bounds_max=[round(v, 4) for v in mx], tris=R.tri_count([o]),
                         materials=[m.name for m in o.data.materials if m],
                         collection=o.users_collection[0].name))
    groups = {}
    for i in info:
        groups[i["collection"]] = groups.get(i["collection"], 0) + i["tris"]
    tris = sum(groups.values())
    log("checks", json.dumps({k: v for k, v in checks.items() if k != "objects"}))
    log("tris", tris, groups)
    path = os.path.join(ADIR, f"{ASSET}_v{VER:03d}.blend")
    saved = False
    if not NOSAVE:
        if os.path.exists(path):
            log("version exists, not overwriting", path)
        else:
            bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
            saved = True
            log("saved", path)
            R.write_json(os.path.join(ADIR, "arrangement.json"), dict(asset=ASSET, blend=os.path.basename(path), placements=[
                dict(source="COLLECTION:" + c.name, name=c.name.replace(ASSET + "_", ""), location=[0, 0, 0],
                     rotation_deg=[0, 0, 0], scale=[1, 1, 1]) for c in (cs, cf, ca)]))
    R.write_json(os.path.join(RDIR, f"{TAG}_report.json"),
                 dict(version=VER, blend=os.path.basename(path), saved=saved, tris_total=tris, tris_by_collection=groups,
                      stone_value=STONE_VALUE, units="env units (world = env*4.6 + (0,0,1.94))",
                      board=dict(half=B_HALF, bottom=B_BOT, top=B_TOP), clearance=checks, objects=info))
    if NORENDER:
        return
    # ---------------------------------------------------------------- world-scale preview (not saved)
    R.setup_render(scn, "EEVEE", (1280, 720), 16 if FAST else 40)
    R.setup_world(scn)
    pc = bpy.data.collections.new("PREVIEW_ONLY")
    scn.collection.children.link(pc)
    R.standard_lights(scale=22.0, collection=pc)
    xf = bpy.data.objects.new("PREVIEW_WorldXform", None)
    pc.objects.link(xf)
    xf.scale = (WS, WS, WS)
    xf.location = (0, 0, WZ)
    for o in objs.values():
        o.parent = xf
    # placeholder rock (env units, parented) and 21.85 m board stand-in (world units)

    def rock_def(Rr, TH, Z, k):
        th = np.degrees(TH) % 360
        cut = np.array([min(1.0, (r_break(t) - 0.35) / 4.4) for t in th])
        f = 1 + 0.08 * A.fbm2(np.cos(TH) * 2, np.sin(TH) * 2 + Z * 0.3, 1.0, 3, seed=2)
        return Rr * f * np.where(Z > -3.5, cut, np.maximum(cut, 0.85)), Z
    rk = A.lathe([(0, DAIS_B - 0.01), (4.4, DAIS_B - 0.01), (4.55, -1.8), (4.0, -3.0), (2.9, -5.0), (1.2, -7.5),
                  (0, -8.0)], 72, deform=rock_def)
    ter = A.make_block((2.4, 1.6, 1.4), rb=0.1, step=1.0, chips=3, rng=np.random.default_rng(3), seed=3, noise_amp=0.05,
                       mapping=A.map_affine(A.M4(None, (0.2, 7.3, -2.05 - 0.75 - 1.4))))
    acc = A.Acc()
    acc.add([rk, ter])
    rock = acc.build("PREVIEW_PlaceholderRock", pc, "Basalt", sharp_deg=50)
    rock.parent = xf
    me = bpy.data.meshes.new("PREVIEW_Board")
    h = B_HALF * WS
    zb, ztp = B_BOT * WS + WZ, B_TOP * WS + WZ
    vs = [(-h, -h, zb), (h, -h, zb), (h, h, zb), (-h, h, zb), (-h, -h, ztp), (h, -h, ztp), (h, h, ztp), (-h, h, ztp)]
    me.from_pydata(vs, [], [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    bob = bpy.data.objects.new("PREVIEW_Board", me)
    pc.objects.link(bob)
    mat = bpy.data.materials.new("PREVIEW_BoardMat")
    nt = mat.node_tree
    bs = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ck = nt.nodes.new("ShaderNodeTexChecker")
    ck.inputs["Scale"].default_value = 1.0
    ck.inputs["Color1"].default_value = (0.62, 0.56, 0.46, 1)
    ck.inputs["Color2"].default_value = (0.05, 0.05, 0.05, 1)
    mp_ = nt.nodes.new("ShaderNodeMapping")
    mp_.inputs["Scale"].default_value = (1 / 2.3, 1 / 2.3, 1 / 2.3)
    nt.links.new(tc.outputs["Object"], mp_.inputs["Vector"])
    nt.links.new(mp_.outputs["Vector"], ck.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    ax_ = nt.nodes.new("ShaderNodeMath")
    ax_.operation = 'ABSOLUTE'
    ay_ = nt.nodes.new("ShaderNodeMath")
    ay_.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs["X"], ax_.inputs[0])
    nt.links.new(sep.outputs["Y"], ay_.inputs[0])
    mxn = nt.nodes.new("ShaderNodeMath")
    mxn.operation = 'MAXIMUM'
    nt.links.new(ax_.outputs[0], mxn.inputs[0])
    nt.links.new(ay_.outputs[0], mxn.inputs[1])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 9.2
    nt.links.new(mxn.outputs[0], gt.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    nt.links.new(gt.outputs[0], mix.inputs[0])
    nt.links.new(ck.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = (0.10, 0.05, 0.025, 1)
    nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.45
    bob.data.materials.append(mat)

    def cam(name, loc, tgt, lens, res=(1280, 720)):
        scn.render.resolution_x, scn.render.resolution_y = res
        c = R.camera("CFCL_V7_CAM_" + name, loc, tgt, lens, collection=pc)
        return R.render_to(os.path.join(RDIR, f"{TAG}_{name}.png"), c)
    out = [cam("god", (0, -26, 30), (0, 2, -2), 26), cam("hero", (0, -30, 9), (0, 20, 5.5), 24),
           cam("close_skirt_bastion", (17.5, -18.5, 3.2), (12.0, -12.6, -1.2), 32),
           cam("close_ring_ribs", (-4.0, -27.0, 5.0), (-3.5, -15.5, -1.6), 30),
           cam("close_approach_plusY", (9.5, 44.0, 9.0), (0.0, 27.0, -4.5), 28),
           cam("close_heat_edge", (-27.0, 10.0, 2.0), (-19.5, 4.0, -2.2), 30)]
    # glow preview: same god view with the inlay pulsed (material emission 4.0) to show the channels
    glow_m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 4.0
    out.append(cam("god_glow_pulse", (0, -26, 30), (0, 2, -2), 26))
    glow_m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.0
    log("renders", out)


if __name__ == "__main__":
    main()
