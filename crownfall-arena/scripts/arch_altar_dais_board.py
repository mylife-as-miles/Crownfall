"""CFCL_Arch_AltarDais - BOARD-SCALE dais (2026-10-24 direction change: the board is massive).

In ENV UNITS (the main build later scales the environment x4.6 and the board x28.75):
  board = square, half-size 2.375 (x,y in +-2.375), base on the dais top Z=-0.76, top Z=-0.42.
  The drum/pedestal and offerings are no longer used.  This file builds:
  * a carved stone SKIRT around the board's base edge (kerb blocks, chevron band on the outer face) and
    four corner BASTIONS carrying bronze pyramids (echo of the board's bronze corner bosses);
  * the dais floor, r 4.5: core bed under board/skirt, paving ring R1 (2.65-3.55), carved sunken channel
    ring with lozenge relief (3.62-3.86, kerbs both sides), paving ring R2 (3.93-4.25), projecting cornice
    (4.25-4.50) over a carved frieze course; collapse on the far right-back edge; rubble core;
  * stelae (<=1.2, one snapped) on R2 at r 4.12; broken floor-ring chains at r>=3.88;
  * broken stair descending +Y from r 4.50.
  Rules checked every run: nothing inside the board volume; nothing above Z=-0.42 within r<3.4.

Run:  python lib/run_blender.py scripts/arch_altar_dais_board.py --timeout 1800 -- --ver 5 [--norender] [--nosave]
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
import arch_altar_dais as AD  # noqa: E402  (main() is guarded)

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = int(ARGV[ARGV.index("--ver") + 1]) if "--ver" in ARGV else 5
NORENDER = "--norender" in ARGV
NOSAVE = "--nosave" in ARGV
FAST = "--fast" in ARGV
ASSET = "CFCL_Arch_AltarDais"
ADIR = os.path.join(CL, "assets", ASSET)
RDIR = os.path.join(CL, "renders", "arch")
TAG = f"board_iter{VER:02d}"
T0 = time.time()

B_HALF = 2.375          # board half size (env units)
B_BOT, B_TOP = -0.76, -0.42
FLOOR, SLAB_B, DAIS_B = -0.76, -1.04, -1.36
R_KEEP = 3.4            # nothing above B_TOP within this radius
SKIRT_OUT = 2.62        # skirt outer face
BAST_C, BAST_H = 2.70, 0.30   # bastion centre (x=y) and half size
R_DAIS = 4.50
COL_C, COL_HW = 15.0, 30.0


def log(*a):
    print(f"[arch_board {time.time() - T0:6.1f}s]", *a, flush=True)


wrap180 = AD.wrap180
radial_tangent = AD.radial_tangent
tilt_pieces = AD.tilt_pieces
sector_stone = AD.sector_stone

STELAE = [("A", 112.0, 4.12, 0.74, 0.0), ("B", 68.0, 4.12, 0.62, 3.5), ("C", 200.0, 4.12, 0.56, 0.0),
          ("D", 340.0, 4.12, 1.00, 0.0)]


def r_break(th):
    d = abs(wrap180(th - COL_C))
    if d >= COL_HW:
        return 99.0
    t = 1.0 - d / COL_HW
    nz = 0.10 * float(A.fbm2(np.array([th * 0.07]), np.array([0.3]), 1.0, 2, seed=11)[0])
    return 4.66 - 1.0 * (t ** 0.75) + nz


def in_bastion(P, m=0.04):
    P = np.atleast_2d(P)
    out = np.zeros(len(P), bool)
    for sx in (-1, 1):
        for sy in (-1, 1):
            out |= (np.abs(P[:, 0] - sx * BAST_C) < BAST_H + m) & (np.abs(P[:, 1] - sy * BAST_C) < BAST_H + m)
    return out


def protected(r_in, r_out, tha, thb):
    pts = []
    for r in np.linspace(r_in, r_out, 4):
        for th in np.linspace(tha, thb, 5):
            pts.append((r * math.cos(th * D2R), r * math.sin(th * D2R)))
    pts = np.array(pts)
    if np.any((np.abs(pts[:, 0]) < B_HALF + 0.35) & (np.abs(pts[:, 1]) < B_HALF + 0.35)):
        return True                                   # under / against the board and its skirt
    if np.any(in_bastion(pts, 0.25)):
        return True
    for _n, th, r, _h, _l in STELAE:
        c = np.array([r * math.cos(th * D2R), r * math.sin(th * D2R)])
        if np.any(np.linalg.norm(pts - c, axis=1) < 0.55):
            return True
    thm = 0.5 * (tha + thb)
    if abs(wrap180(thm - 90)) < 18 and r_out > 3.9:   # stair landing + chain zone
        return True
    return False


def ring(acc, rub, r_in, r_out, n, off, zt, zb, seed0, step=0.3, rb=0.03, relief=None, skip=None, name=""):
    """Wraps arch_altar_dais.floor_ring with this layout's collapse / protection rules."""
    AD.r_break = r_break
    AD.protected = protected
    AD.SLAB_B = SLAB_B
    if skip is None:
        AD.floor_ring(acc, rub, r_in, r_out, n, off, zt, zb, seed0, step=step, rb=rb, relief=relief, ringname=name)
        return
    # skip segments (e.g. under the bastions): build into a temp accumulator, keep pieces outside skip()
    tmp, tmpr = A.Acc(), A.Acc()
    AD.floor_ring(tmp, tmpr, r_in, r_out, n, off, zt, zb, seed0, step=step, rb=rb, relief=relief, ringname=name)
    for p in tmp.pieces:
        c = p.V.mean(0)
        if not skip(c):
            acc.add(p)
    for p in tmpr.pieces:
        if not skip(p.V.mean(0)):
            rub.add(p)


def build_skirt():
    """Kerb blocks around the board base + 4 corner bastions with bronze pyramids."""
    stone, bronze = A.Acc(), A.Acc()
    rng = np.random.default_rng(900)
    kin = B_HALF + 0.010
    kz0, kz1 = FLOOR, FLOOR + 0.18          # kerb top -0.58 (board top -0.42 stands proud)
    span = BAST_C - BAST_H - 0.006           # kerb runs between the bastions
    n = 6
    edges = np.linspace(-span, span, n + 1)
    for side in range(4):
        Rz = A.rot_euler(0, 0, side * 90.0)
        for i in range(n):
            xa, xb = edges[i] + 0.004, edges[i + 1] - 0.004
            c_loc = np.array([0.5 * (xa + xb), -(kin + SKIRT_OUT) / 2, 0.5 * (kz0 + kz1)])
            half = np.array([(xb - xa) / 2, (SKIRT_OUT - kin) / 2, (kz1 - kz0) / 2 - 0.002])
            Mx = A.M4(Rz, Rz @ c_loc) @ A.M4(A.rot_euler(0, 0, rng.uniform(-0.6, 0.6)))
            seed = 910 + side * 10 + i
            b = A.make_block(half, rb=0.03, rb_var=0.9, step=0.25, chips=7, chip_scale=0.6,
                             rng=np.random.default_rng(seed), mapping=A.map_affine(Mx), seed=seed, noise_amp=0.002,
                             chip_opts={"prefer": (0, (1, -1, 1)), "prefer_p": 0.85})
            stone.add(b)
            # chevron band on the outer face (local -y)
            f = A.compose(lambda u, v, h, half=half: np.stack([np.asarray(u, float), -half[1] - np.asarray(h, float),
                                                             np.asarray(v, float)], 1), A.map_affine(Mx))
            stone.add(A.lozenge_frieze(-half[0] + 0.06, half[0] - 0.06, -0.04, 0.04, 3, f, h=0.014, wb=0.02,
                                       wt=0.01, nail_h=0.02, embed=0.012))
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        c = np.array([sx * BAST_C, sy * BAST_C, FLOOR + 0.13])
        seed = 950 + k
        cracked = (sx, sy) == (1, 1)          # far-right bastion, on the collapse side
        half = np.array([BAST_H, BAST_H, 0.13])
        Mx = A.M4(A.rot_euler(0, 0, 45.0 * 0 + rng.uniform(-1, 1)), c)
        crack = None
        if cracked:
            pcs = []
            for (ca, ea, fn) in ((-0.5, 0.5, 1), (0.5, 0.5, -1)):
                hh = half.copy()
                hh[0] = half[0] * ea - 0.004
                pcs.append(A.make_block(hh, rb=0.035, rb_var=0.9, step=0.2, chips=6, chip_scale=0.6,
                                        rng=np.random.default_rng(seed + int(ca * 10)), mapping=A.map_affine(Mx),
                                        center=(ca * half[0], 0, 0), seed=seed, noise_amp=0.003,
                                        face_noise=[(0, fn, lambda a, b: 0.03 * A.fbm2(a, b, 6, 2, seed=4))]))
            # outer half has slumped outward
            tilt_pieces([pcs[1]], (c[0] + 0.3, c[1], FLOOR), (0.0, 1.0, 0.0), 4.0, drop=0.02)
            stone.add(pcs)
        else:
            b = A.make_block(half, rb=0.035, rb_var=0.9, step=0.2, chips=6, chip_scale=0.6,
                             rng=np.random.default_rng(seed), mapping=A.map_affine(Mx), seed=seed, noise_amp=0.002,
                             chip_opts={"only_top": True})
            stone.add(b)
        # carved band on the two outward faces
        for fa in (("x", sx), ("y", sy)):
            if fa[0] == "x":
                f = A.compose(lambda u, v, h, s=fa[1]: np.stack([np.full_like(np.asarray(u, float), s * BAST_H) +
                                                                s * np.asarray(h, float), s * np.asarray(u, float),
                                                                np.asarray(v, float)], 1), A.map_affine(Mx))
            else:
                f = A.compose(lambda u, v, h, s=fa[1]: np.stack([-s * np.asarray(u, float),
                                                                np.full_like(np.asarray(u, float), s * BAST_H) +
                                                                s * np.asarray(h, float), np.asarray(v, float)], 1),
                              A.map_affine(Mx))
            stone.add(A.lozenge_frieze(-BAST_H + 0.07, BAST_H - 0.07, -0.045, 0.045, 2, f, h=0.014, wb=0.02, wt=0.01,
                                       nail_h=0.02, embed=0.012))
        # bronze cap plate + pyramid (echo of the board's corner bosses)
        zt = FLOOR + 0.26
        hw = 0.21
        plate = A.make_block((hw + 0.02, hw + 0.02, 0.018), rb=0.004, step=0.5, center=(c[0], c[1], zt + 0.016),
                             seed=seed + 5, noise_amp=0)
        Vp = np.array([[c[0] - hw, c[1] - hw, zt + 0.034], [c[0] + hw, c[1] - hw, zt + 0.034],
                       [c[0] + hw, c[1] + hw, zt + 0.034], [c[0] - hw, c[1] + hw, zt + 0.034],
                       [c[0], c[1], zt + 0.034 + 0.15]])
        pyr = A.Piece(Vp, [[3, 2, 1, 0], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]).fix_orientation()
        if cracked:   # the pyramid was knocked off and lies on the paving beyond the bastion
            grp = [plate, pyr]
            Mf = A.rot_about((c[0], c[1], zt + 0.05), (1, -1, 0.3), 105.0)
            for p in grp:
                p.transform(Mf)
            mn = min(p.V[:, 2].min() for p in grp)
            ctr = np.mean(np.concatenate([p.V for p in grp]), 0)
            dst = np.array([4.09 * math.cos(40 * D2R), 4.09 * math.sin(40 * D2R)])   # on R2, outside r 3.4
            for p in grp:
                p.translate((dst[0] - ctr[0], dst[1] - ctr[1], FLOOR - mn - 0.01))
            bronze.add(grp)
        else:
            bronze.add([plate, pyr])
    return stone, bronze


def build_floor():
    flo, rub = A.Acc(), A.Acc()
    # core bed under board + skirt: flat, top exactly -0.76
    e = np.array([2.70, 2.70, 0.14])
    flo.add(A.make_block(e, rb=0.02, step=1.0, chips=0, rng=np.random.default_rng(1), noise_amp=0.0,
                         mapping=A.map_affine(A.M4(None, (0, 0, FLOOR - 0.14))), seed=1))
    ring(flo, rub, 2.65, 3.55, 28, 3.0, FLOOR, SLAB_B, 2000, step=0.35, name="R1",
         skip=lambda c: bool(in_bastion(c[None, :2], 0.0)[0]) and False)
    skipb = lambda c: bool(in_bastion(c[None, :2], 0.10)[0])   # noqa: E731
    ring(flo, rub, 3.55, 3.62, 40, 0.0, FLOOR, SLAB_B, 2100, step=0.35, rb=0.025, skip=skipb, name="Ki")

    def chan_relief(tha, thb):
        Rr = 3.62 + 0.007
        mp = A.map_annulus(Rr, FLOOR - 0.055)
        a0, a1 = tha * D2R, thb * D2R
        u0, u1 = a0 * Rr + 0.035, a1 * Rr - 0.035
        return A.lozenge_frieze(u0, u1, 0.025, 0.215, 3, mp, h=0.014, wb=0.018, wt=0.009, nail_h=0.018,
                                nail_scale=0.5, small_nails=True, embed=0.004)
    ring(flo, rub, 3.62, 3.86, 32, 4.0, FLOOR - 0.055, SLAB_B, 2200, step=0.35, rb=0.02, relief=chan_relief,
         skip=skipb, name="Channel")
    ring(flo, rub, 3.86, 3.93, 40, 4.5, FLOOR, SLAB_B, 2300, step=0.35, rb=0.025, skip=skipb, name="Ko")
    ring(flo, rub, 3.93, 4.25, 40, 2.0, FLOOR, SLAB_B, 2400, step=0.35, name="R2")
    # bastion footings fill the gaps left in the channel/kerb rings
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = (sx * BAST_C, sy * BAST_C, FLOOR - 0.14)
            flo.add(A.make_block((BAST_H + 0.14, BAST_H + 0.14, 0.14), rb=0.02, step=1.0, chips=3,
                                 rng=np.random.default_rng(7), mapping=A.map_affine(A.M4(A.rot_euler(0, 0, 0), c)),
                                 seed=7, noise_amp=0.0015))
    # cornice + carved frieze course
    F = FLOOR
    prof = [(4.25, F), (4.465, F), (4.50, F - 0.03), (4.50, F - 0.10), (4.485, F - 0.135), (4.455, F - 0.165),
            (4.415, F - 0.185), (4.375, F - 0.192), (4.375, SLAB_B), (4.25, SLAB_B)]
    rng = np.random.default_rng(2600)
    n = 44
    for k in range(n):
        tha = 4.0 + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        if abs(wrap180(thm - 90.0)) < 14.5 or r_break(thm) < 4.55:
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
        if abs(wrap180(thm - 270)) > 60 and rng.uniform() < 0.2:
            tilt_pieces([pc], (4.25 * rad[0], 4.25 * rad[1], SLAB_B), tan, rng.uniform(3, 7), drop=rng.uniform(0.01, 0.04))
        pc.displace(0.0015, 7.0, seed=k)
        flo.add(pc)
    n = 32
    for k in range(n):
        tha = 3.0 + k * 360.0 / n
        thb = tha + 360.0 / n
        thm = (0.5 * (tha + thb)) % 360
        if abs(wrap180(thm - 90.0)) < 13.0 or r_break(thm) < 4.45:
            continue
        pcs = sector_stone(3.95, 4.36, tha, thb, DAIS_B + 0.004, SLAB_B - 0.004, 2700 + k, gap=0.012, rb=0.02,
                           step=0.3, step_z=0.3, chips=3, prefer=(0, (1, 1, -1)), noise_amp=0.002)
        Rr = 4.36 - 0.006
        mp = A.map_cyl(Rr, 0.0)
        a0, a1 = tha * D2R, thb * D2R
        spn = (a1 - a0) * Rr
        u0, u1 = a0 * Rr + 0.1 * spn, a1 * Rr - 0.1 * spn
        rel = A.lozenge_frieze(u0, u1, -1.285, -1.115, 3, mp, h=0.012, wb=0.016, wt=0.008, nail_h=0.018,
                               small_nails=False, embed=0.004)
        rel.append(A.stroke([(u0, -1.30), (u1, -1.30)], mp, 0.009, 0.005, 0.008, 0.004))
        rel.append(A.stroke([(u0, -1.10), (u1, -1.10)], mp, 0.009, 0.005, 0.008, 0.004))
        flo.add(pcs + rel)

    # rubble core
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
    rub.add(A.lathe([(0, zt), (0.5, zt), (0.7, zt), (0.85, zt), (0.95, zt), (1.0, zt), (1.0, zt - 0.06),
                     (1.0, -1.17), (1.0, -1.25), (1.0, -1.31), (0.985, DAIS_B), (0, DAIS_B)], 200, deform=core_def))
    for i in range(22):
        th = COL_C + rng.uniform(-COL_HW * 0.8, COL_HW * 0.8)
        rr = r_break(th) - rng.uniform(0.02, 0.25)
        sz = rng.uniform(0.05, 0.18)
        cc = (rr * math.cos(th * D2R), rr * math.sin(th * D2R), 0)
        rub.add(A.rest_on(A.rubble_chunk(cc, (sz, sz * 0.8, sz * 0.55), rng), SLAB_B - 0.02, 0.01))
    return flo, rub


def clamp_under_board(acc, eps=0.0005, margin=0.003):
    """Nothing may rise into the board's base: verts inside the board square (+margin) stay at or below -0.76.
    The floor uses a 0.2 margin so no triangle can bridge from a raised vertex outside into the board volume."""
    for p in acc.pieces:
        m = (np.abs(p.V[:, 0]) <= B_HALF + margin) & (np.abs(p.V[:, 1]) <= B_HALF + margin)
        p.V[m, 2] = np.minimum(p.V[m, 2], B_BOT - eps)


def clearance(objs):
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    h = B_HALF
    bx = [(-h, -h, B_BOT + 1e-4), (h, -h, B_BOT + 1e-4), (h, h, B_BOT + 1e-4), (-h, h, B_BOT + 1e-4),
          (-h, -h, B_TOP), (h, -h, B_TOP), (h, h, B_TOP), (-h, h, B_TOP)]
    bf = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    box = BVHTree.FromPolygons(bx, bf)
    n = 64
    cv = [(R_KEEP * math.cos(A.TAU * i / n), R_KEEP * math.sin(A.TAU * i / n), z) for z in (B_TOP + 1e-5, 6.0)
          for i in range(n)]
    cf = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    cyl = BVHTree.FromPolygons(cv, cf)
    rep = {"objects": {}}
    tot = dict(verts_in_board_volume=0, verts_above_boardtop_r34=0, tri_overlaps_board_box=0,
               tri_overlaps_r34_cylinder=0)
    for o in objs:
        me = o.evaluated_get(dg).to_mesh()
        V = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", V)
        V = V.reshape(-1, 3)
        Mw = np.array(o.matrix_world)
        V = V @ Mw[:3, :3].T + Mw[:3, 3]
        r = np.hypot(V[:, 0], V[:, 1])
        d = dict(verts_in_board_volume=int(np.sum((np.abs(V[:, 0]) <= h) & (np.abs(V[:, 1]) <= h) &
                                                  (V[:, 2] > B_BOT + 1e-5) & (V[:, 2] < B_TOP))),
                 verts_above_boardtop_r34=int(np.sum((r < R_KEEP) & (V[:, 2] > B_TOP))))
        bvh = BVHTree.FromPolygons([tuple(v) for v in V], [tuple(p.vertices) for p in me.polygons])
        d["tri_overlaps_board_box"] = len(bvh.overlap(box))
        d["tri_overlaps_r34_cylinder"] = len(bvh.overlap(cyl))
        o.evaluated_get(dg).to_mesh_clear()
        rep["objects"][o.name] = d
        for k in tot:
            tot[k] += d[k]
    rep.update(tot)
    return rep


def main():
    R.reset_scene()
    scn = bpy.context.scene
    root = bpy.data.collections.new(ASSET)
    scn.collection.children.link(root)
    cb = bpy.data.collections.new(ASSET + "_BoardSkirt")
    cf = bpy.data.collections.new(ASSET + "_Floor")
    root.children.link(cb)
    root.children.link(cf)
    stone_m = M.get("AncientStone")
    objs = {}
    s_acc, b_acc = build_skirt()
    clamp_under_board(s_acc)
    objs["skirt"] = s_acc.build("CFCL_Arch_BoardSkirt", cb, stone_m, sharp_deg=34)
    objs["skirt_bronze"] = b_acc.build("CFCL_Arch_BoardSkirt_Bronze", cb, "Bronze", sharp_deg=30)
    flo, rub = build_floor()
    clamp_under_board(flo, margin=0.2)
    clamp_under_board(rub, margin=0.2)
    objs["floor"] = flo.build("CFCL_Arch_DaisFloor", cf, stone_m, sharp_deg=34)
    objs["rubble"] = rub.build("CFCL_Arch_DaisRubble", cf, stone_m, sharp_deg=34)
    # stelae + floor chains + stair from the drum-scale script, re-parametrised
    AD.STELAE = STELAE
    AD.STELE_PLINTH = (0.25, 0.24)
    AD.CHAIN_R = 4.10
    AD.CHAIN_SPEC = ((79.0, 1.0), (101.0, -1.0))
    AD.CHAIN_SWEEP = 7.0
    AD.STAIR_R = R_DAIS
    AD.FALL_ANGLE = 0.0           # D (340 deg) top fell tangentially along the ring, staying outside r 3.4
    st, sb = AD.build_stelae()
    for nm, acc in st.items():
        objs["stele_" + nm] = acc.build(f"CFCL_Arch_Stele_{nm}", cf, stone_m, sharp_deg=34)
    objs["stele_bronze"] = sb.build("CFCL_Arch_SteleBronze_Chain", cf, "Bronze", sharp_deg=40)
    objs["stair"] = AD.build_stair().build("CFCL_Arch_DaisStair", cf, stone_m, sharp_deg=34)
    for k, o in objs.items():
        if "bronze" not in k:
            try:
                M.bake_curvature(o)
            except Exception as e:
                log("curvature bake failed", o.name, e)
    checks = clearance(list(objs.values()))
    info = []
    for k, o in objs.items():
        mn, mx = R.bounds([o])
        info.append(dict(name=o.name, dims=[round(v, 4) for v in (mx - mn)], bounds_min=[round(v, 4) for v in mn],
                         bounds_max=[round(v, 4) for v in mx], tris=R.tri_count([o]),
                         materials=[m.name for m in o.data.materials if m]))
    tris = sum(i["tris"] for i in info)
    log("checks", json.dumps({k: v for k, v in checks.items() if k != "objects"}))
    log("tris", tris, {i["name"]: i["tris"] for i in info})
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
                dict(source="COLLECTION:" + ASSET + "_BoardSkirt", name="BoardSkirt", location=[0, 0, 0],
                     rotation_deg=[0, 0, 0], scale=[1, 1, 1]),
                dict(source="COLLECTION:" + ASSET + "_Floor", name="DaisFloor", location=[0, 0, 0],
                     rotation_deg=[0, 0, 0], scale=[1, 1, 1])]))
    R.write_json(os.path.join(RDIR, f"{TAG}_report.json"),
                 dict(version=VER, blend=os.path.basename(path), saved=saved, tris_total=tris, units="env units",
                      board=dict(half=B_HALF, bottom=B_BOT, top=B_TOP), clearance=checks, objects=info))
    if NORENDER:
        return
    # ---------------------------------------------------------------- preview (not saved)
    R.setup_render(scn, "EEVEE", (1280, 720), 16 if FAST else 40)
    R.setup_world(scn)
    pc = bpy.data.collections.new("PREVIEW_ONLY")
    scn.collection.children.link(pc)
    R.standard_lights(scale=5.0, collection=pc)
    # board stand-in: 4.75 x 4.75 slab, top -0.42, bottom -0.76, 8x8 checker inside a dark frame
    me = bpy.data.meshes.new("PREVIEW_Board")
    h = B_HALF
    vs = [(-h, -h, B_BOT), (h, -h, B_BOT), (h, h, B_BOT), (-h, h, B_BOT), (-h, -h, B_TOP), (h, -h, B_TOP),
          (h, h, B_TOP), (-h, h, B_TOP)]
    me.from_pydata(vs, [], [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    ob = bpy.data.objects.new("PREVIEW_Board", me)
    pc.objects.link(ob)
    mat = bpy.data.materials.new("PREVIEW_BoardMat")
    nt = mat.node_tree
    bs = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ck = nt.nodes.new("ShaderNodeTexChecker")
    ck.inputs["Scale"].default_value = 1.0
    ck.inputs["Color1"].default_value = (0.62, 0.56, 0.46, 1)
    ck.inputs["Color2"].default_value = (0.05, 0.05, 0.05, 1)
    mp_ = nt.nodes.new("ShaderNodeMapping")
    mp_.inputs["Scale"].default_value = (1.0 / 0.5, 1.0 / 0.5, 1.0 / 0.5)
    mp_.inputs["Location"].default_value = (0.0, 0.0, 0.0)
    nt.links.new(tc.outputs["Object"], mp_.inputs["Vector"])
    nt.links.new(mp_.outputs["Vector"], ck.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    ax = nt.nodes.new("ShaderNodeMath")
    ax.operation = 'ABSOLUTE'
    ay = nt.nodes.new("ShaderNodeMath")
    ay.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs["X"], ax.inputs[0])
    nt.links.new(sep.outputs["Y"], ay.inputs[0])
    mxn = nt.nodes.new("ShaderNodeMath")
    mxn.operation = 'MAXIMUM'
    nt.links.new(ax.outputs[0], mxn.inputs[0])
    nt.links.new(ay.outputs[0], mxn.inputs[1])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 2.0
    nt.links.new(mxn.outputs[0], gt.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    nt.links.new(gt.outputs[0], mix.inputs[0])
    nt.links.new(ck.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = (0.12, 0.06, 0.03, 1)
    nt.links.new(mix.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.5
    ob.data.materials.append(mat)

    def rock_def(Rr, TH, Z, k):
        th = np.degrees(TH) % 360
        cut = np.array([min(1.0, (r_break(t) - 0.35) / 4.4) for t in th])
        f = 1 + 0.08 * A.fbm2(np.cos(TH) * 2, np.sin(TH) * 2 + Z * 0.3, 1.0, 3, seed=2)
        return Rr * f * np.where(Z > -3.5, cut, np.maximum(cut, 0.85)), Z
    rk = A.lathe([(0, DAIS_B - 0.01), (4.4, DAIS_B - 0.01), (4.55, -1.8), (4.0, -3.0), (2.9, -5.0), (1.2, -7.5),
                  (0, -8.0)], 72, deform=rock_def)
    acc = A.Acc()
    acc.add(rk)
    acc.build("PREVIEW_PlaceholderRock", pc, "Basalt", sharp_deg=50)

    def cam(name, loc, tgt, lens, ortho=None, res=(1280, 720)):
        scn.render.resolution_x, scn.render.resolution_y = res
        c = R.camera("CFCL_BOARD_CAM_" + name, loc, tgt, lens, collection=pc)
        if ortho:
            c.data.type = 'ORTHO'
            c.data.ortho_scale = ortho
        return R.render_to(os.path.join(RDIR, f"{TAG}_{name}.png"), c)
    out = [cam("a_34", (-7.2, -8.2, 4.6), (0, 0.6, -0.8), 30),
           cam("b_low_front", (0.0, -8.6, 0.6), (0, 1.5, -0.6), 28),
           cam("c_top", (0, 0.9, 20.0), (0, 0.9, 0), 50, ortho=12.4, res=(900, 900)),
           cam("d_bastion", (4.3, -3.3, -0.1), (2.65, -2.55, -0.62), 40),
           cam("e_channel_kerb", (-1.3, -5.6, 0.5), (-0.6, -3.4, -0.75), 40),
           cam("f_back_collapse", (6.2, 7.6, 2.6), (1.5, 2.4, -0.9), 30),
           cam("g_skirt_edge", (-3.6, -0.6, -0.2), (-2.5, 0.2, -0.62), 40)]
    log("renders", out)


if __name__ == "__main__":
    main()
