"""Distant SILHOUETTE sets (ENV units; the main build scales the environment x4.6 and lifts it +1.94 m).

  --set cliffs -> CFCL_Terrain_FarCliffs v003  (replaces the v002 rectangular walls)
  --set stacks -> CFCL_Terrain_FarStacks v001  (drop-in replacement for CFCL_FarLand_BasaltStacks "organ pipes")

Vocabulary (E33_13 / 14 / 15): cubic-fracture massifs built from stacked, chamfered, slightly misaligned blocks
with stepped terraces and stepped skylines; leaning and split monoliths; snapped pinnacles; eroded notches;
broken arches / bridges spanning between stacks; columnar-basalt clusters whose skyline steps like a city, with
gaps, leaning outer columns and snapped columns.  Low poly - the value is in the OUTLINE (they will be hazed).

Run:  python lib/run_blender.py scripts/terrain_farsil.py -- --set cliffs --iter 3
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, S, M, R, F32

args = T.get_args()
SET = args.get("set", "cliffs")
ITER = int(args.get("iter", 1))
BASE_Z = -6.0
OUT = os.path.join(T.RENDERS, "farsil")
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- primitives
def cblock(acc, rng, c, size, yaw=0.0, tilt=(0.0, 0.0), ncut=None):
    """Chamfered / fractured block (box cleaved by 1-3 planes) - the cubic-fracture brick of the silhouettes."""
    V, F = T.block_chunk(rng, 0.0, dims=size, ncut=int(rng.integers(1, 4)) if ncut is None else ncut)
    Rm = T.rot3(tilt[0], tilt[1], yaw)
    acc.add((V @ Rm.T + np.asarray(c, F32)).astype(F32), F)


def stack(acc, rng, x, y, z0, h, w, d, slab=(4.0, 8.0), lean=(0.0, 0.0), taper=0.12, yaw=0.0, jit=0.07):
    """Column of stacked slabs, slightly out of line, optionally leaning (tilt accumulates with height)."""
    z = z0
    lx, ly = lean
    while z < z0 + h - 0.4:
        t = min(rng.uniform(*slab), z0 + h - z)
        u = (z - z0) / max(h, 1e-3)
        k = 1.0 - taper * u
        cx = x + math.tan(math.radians(lx)) * (z - z0 + t / 2) + rng.normal(0, jit)
        cy = y + math.tan(math.radians(ly)) * (z - z0 + t / 2) + rng.normal(0, jit)
        cblock(acc, rng, (cx, cy, z + t / 2), (w * k * rng.uniform(0.93, 1.03), d * k * rng.uniform(0.93, 1.03), t),
               yaw + rng.normal(0, 1.2), (-ly + rng.normal(0, 0.6), lx + rng.normal(0, 0.6)))
        z += t * rng.uniform(0.96, 1.0)
    return z


def monolith(acc, rng, x, y, h, w, d=None, lean=(0.0, 0.0), top="split", yaw=0.0, z0=-3.0):
    """Silhouette-first pinnacle: 3-5 segments whose widths neck and flare (wide base, necked waist,
    overhanging cap), with stair-stepped lateral offsets, a side notch, and a characterful top:
    'split' (two prongs leaning apart), 'cap' (tilted overhanging capstone) or 'shear' (steep oblique cut)."""
    d = d or w * 1.05
    n = int(rng.integers(3, 6))
    fr = np.sort(rng.uniform(0.15, 0.95, n - 1))
    edges = np.concatenate([[0.0], fr, [1.0]]) * h
    widths = [1.25] + [float(v) for v in rng.permutation([0.72, 1.0, 0.62, 0.9, 0.7])][:n - 1]
    lx, ly = math.tan(math.radians(lean[0])), math.tan(math.radians(lean[1]))
    off = np.zeros(2)
    notch_i = int(rng.integers(1, n))
    for i in range(n):
        za, zb = z0 + edges[i], z0 + edges[i + 1]
        t = zb - za
        if i > 0:
            off += rng.normal(0, 0.12, 2) * w + np.array([rng.choice([-1, 1]) * 0.18 * w, 0.0])
        ww = w * widths[i] * rng.uniform(0.92, 1.05)
        cx = x + off[0] + lx * (0.5 * (za + zb) - z0)
        cy = y + off[1] + ly * (0.5 * (za + zb) - z0)
        if i == notch_i:                                   # side notch: the segment is cut back on one side
            ww *= 0.7
            cx += 0.15 * w * rng.choice([-1, 1])
        if i == n - 1 and top == "split":
            gap = 0.22 * ww
            for sgn in (-1, 1):
                pw = (ww - gap) / 2
                ph = t * rng.uniform(0.9, 1.6)
                cblock(acc, rng, (cx + sgn * (gap / 2 + pw / 2) + sgn * 0.12 * ph, cy, za + ph / 2), (pw, d * 0.8, ph),
                       yaw, (0.0, sgn * rng.uniform(6, 14)), ncut=1)
            continue
        if i == n - 1 and top == "cap":
            cblock(acc, rng, (cx, cy, za + t * 0.35), (ww, d * 0.9, t * 0.7), yaw, (0, 0), ncut=1)
            cblock(acc, rng, (cx + rng.normal(0, 0.15) * w, cy, za + t * 0.7 + 0.35 * w),
                   (ww * 1.6, d * 1.2, 0.7 * w), yaw + rng.normal(0, 8), (rng.normal(0, 4), rng.uniform(7, 15)), ncut=1)
            continue
        if i == n - 1 and top == "shear":
            V, F = T.block_chunk(rng, 0.0, dims=(ww, d * 0.9, t * 1.3), ncut=0)
            Vc = V.copy()
            hi = Vc[:, 2] > 0
            Vc[hi, 2] += (Vc[hi, 0] / max(ww, 1e-3)) * t * 1.2       # steep oblique break
            Rm = T.rot3(0, 0, yaw)
            acc.add((Vc @ Rm.T + np.array([cx, cy, za + t * 0.65], F32)).astype(F32), F)
            continue
        cblock(acc, rng, (cx, cy, za + t / 2), (ww, d * widths[i] * rng.uniform(0.9, 1.05), t), yaw + rng.normal(0, 1.5),
               (-lean[1] + rng.normal(0, 0.6), lean[0] + rng.normal(0, 0.6)), ncut=int(rng.integers(0, 2)))


def arch_span(acc, rng, p0, p1, width=2.0, thick=1.3, gap=(0.42, 0.62), rise=0.5, deck=True):
    """Broken arch / bridge between two stacks: voussoir ring + deck with the middle section fallen."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    span = p1 - p0
    L = float(np.linalg.norm(span[:2]))
    yaw = math.degrees(math.atan2(span[1], span[0]))
    n = max(9, int(L / 1.1))
    top = max(p0[2], p1[2]) + 0.5 * L * rise
    for i in range(n):
        tm = (i + 0.5) / n
        if gap[0] < tm < gap[1]:
            continue                                            # collapsed middle
        c = p0 + span * tm
        c[2] = p0[2] + span[2] * tm + 0.5 * L * rise * math.sin(math.pi * tm)
        slope = math.degrees(math.atan(span[2] / L + 0.5 * rise * math.pi * math.cos(math.pi * tm)))
        cblock(acc, rng, c, (L / n * 1.08, width, thick), yaw, (0.0, -slope + rng.normal(0, 1.5)), ncut=0)
    if deck:
        for i in range(n):
            tm = (i + 0.5) / n
            if gap[0] - 0.08 < tm < gap[1] + 0.08:
                continue
            c = p0 + span * tm
            c[2] = top + thick * 0.9 + rng.normal(0, 0.15)
            cblock(acc, rng, c, (L / n * 1.0, width * 1.15, thick * 0.55), yaw + rng.normal(0, 1),
                   (rng.normal(0, 1), rng.normal(0, 1)), ncut=0)


def massif(acc, rng, L, D, prof, cell=7.0, rows=2, slab=(4.0, 8.5), notch=0.2):
    """Cubic-fracture massif: columns x rows of slab stacks; front rows lower (stepped terraces toward the
    arena, local -Y), stepped skyline from `prof(x)` (0..1 x height), eroded notches."""
    x = -L / 2
    while x < L / 2:
        cw = cell * rng.uniform(0.6, 1.4)
        xc = x + cw / 2
        H = prof(xc) * rng.uniform(0.85, 1.08)
        if rng.random() < notch:
            H *= rng.uniform(0.35, 0.6)
        for k in range(rows):
            yc = -D / 2 + (k + 0.5) * D / rows
            Hk = H * (0.5 + 0.5 * (k + 1) / rows) * rng.uniform(0.9, 1.05)
            if Hk < 1.0:
                continue
            stack(acc, rng, xc, yc, -3.0, Hk + 3.0, cw * 1.0, D / rows * 1.02, slab, taper=0.04, jit=0.06)
        x += cw
    return acc


def hexcol(acc, rng, x, y, r, h, lean=(0.0, 0.0), slant=0.35, z0=-3.0, nside=6):
    """Columnar-basalt prism with an oblique broken top (no flat organ-pipe caps)."""
    a0 = rng.uniform(0, 2 * np.pi)
    angs = a0 + np.arange(nside) * 2 * np.pi / nside + rng.uniform(-0.18, 0.18, nside)
    rr = r * rng.uniform(0.86, 1.08, nside)
    ring = np.stack([np.cos(angs) * rr, np.sin(angs) * rr], 1)
    d = rng.normal(size=2)
    d /= np.linalg.norm(d)
    top = h + (ring @ d) * slant * rng.uniform(0.4, 1.4) + rng.uniform(-0.15, 0.25, nside) * r
    tl = np.tan(np.radians(lean))
    bot = np.column_stack([ring, np.full(nside, z0)])
    tpv = np.column_stack([ring, top])
    tpv[:, 0] += tl[0] * (tpv[:, 2] - z0)
    tpv[:, 1] += tl[1] * (tpv[:, 2] - z0)
    ctr = tpv.mean(0) + np.array([0, 0, rng.uniform(-0.1, 0.3) * r])
    V = np.vstack([bot, tpv, ctr[None, :]]) + np.array([x, y, 0])
    F = []
    for i in range(nside):
        j = (i + 1) % nside
        F.append([i, j, nside + j, nside + i])
        F.append([nside + i, nside + j, 2 * nside])
    acc.add(V.astype(F32), F)


def basalt_cluster(acc, rng, rc, h, peak=(0.3, -0.2), col_r=(0.75, 1.35), gaps=0.12, snaps=0.16, leans=0.14,
                   pinnacles=2):
    """Stepped skyline of columns: height falls off from an off-centre peak, quantised in steps, with gaps,
    snapped and leaning columns and a couple of detached pinnacles."""
    pts = []
    sp = 0.98 * (col_r[0] + col_r[1])
    for gx in np.arange(-rc, rc + 1e-6, sp):
        for gy in np.arange(-rc, rc + 1e-6, sp * 0.87):
            ox = gx + (sp * 0.5 if int(round(gy / (sp * 0.87))) % 2 else 0) + rng.normal(0, 0.25)
            oy = gy + rng.normal(0, 0.25)
            if math.hypot(ox / 1.0, oy / 0.8) > rc * rng.uniform(0.8, 1.05):
                continue
            pts.append((ox, oy))
    px_, py_ = peak[0] * rc, peak[1] * rc
    for (ox, oy) in pts:
        if rng.random() < gaps:
            continue                                            # negative space
        dist = math.hypot(ox - px_, oy - py_) / rc
        hh = h * max(0.12, 1.0 - dist ** 1.25) ** 0.85
        hh = round(hh / (0.14 * h)) * 0.14 * h * rng.uniform(0.75, 1.1)    # stepped skyline, bigger steps
        if rng.random() < snaps:
            hh *= rng.uniform(0.35, 0.65)
        lean = (0.0, 0.0)
        if rng.random() < leans or dist > 0.8:
            a = math.atan2(oy, ox)
            m = rng.uniform(5, 15)
            lean = (math.cos(a) * m, math.sin(a) * m)
        hexcol(acc, rng, ox, oy, rng.uniform(*col_r), hh, lean, slant=0.45)
    for _ in range(2):                                          # spires breaking the skyline above the peak
        hexcol(acc, rng, px_ + rng.normal(0, 0.25) * rc, py_ + rng.normal(0, 0.25) * rc, rng.uniform(*col_r) * 0.7,
               h * rng.uniform(1.12, 1.35), (rng.normal(0, 7), rng.normal(0, 7)), slant=0.9)
    for _ in range(pinnacles):                                  # detached thin pinnacles beside the cluster
        a = rng.uniform(0, 2 * np.pi)
        dd = rc * rng.uniform(1.1, 1.35)
        hexcol(acc, rng, math.cos(a) * dd, math.sin(a) * dd, rng.uniform(0.55, 0.85), h * rng.uniform(0.55, 0.95),
               (math.cos(a) * rng.uniform(4, 12), math.sin(a) * rng.uniform(4, 12)), slant=0.7)


# ---------------------------------------------------------------- profiles
def peaks_profile(rng, L, H, npk=3, base=0.35):
    pk = [(rng.uniform(-L / 2, L / 2), rng.uniform(0.55, 1.0), rng.uniform(0.08, 0.22) * L) for _ in range(npk)]
    pk[0] = (L / 2 * rng.choice([-0.75, 0.75]), 1.0, 0.18 * L)

    def prof(x):
        v = base
        for (c, a, w) in pk:
            v = max(v, a * math.exp(-((x - c) / w) ** 2))
        return H * v
    return prof


# ---------------------------------------------------------------- the two sets
def build_cliffs(col):
    pieces = []

    def place_obj(name, acc, az_or_xy, rot_deg, mat="Basalt"):
        ob = T.mesh_obj(name, acc.verts(), acc.f, col, smooth=True, sharp_angle=30)
        ob.location = (az_or_xy[0], az_or_xy[1], BASE_Z)
        ob.rotation_euler = (0, 0, math.radians(rot_deg))
        if mat == "Basalt":
            M.assign(ob, "Basalt", curvature=True, columns=0.0)   # no plank-like column streaks at distance
        else:
            M.assign(ob, mat, curvature=True)
        pieces.append(ob)
        return ob

    def facing(x, y):
        """rotation so local -Y faces the arena centre"""
        return math.degrees(math.atan2(y, x)) - 90.0

    # ---- LEFT flank massif (hero screen x ~0-260): stepped tiers rising to the frame edge, split monolith
    rng = np.random.default_rng(3101)
    acc = T.MeshAcc()
    prof = peaks_profile(rng, 30, 26, 2, base=0.42)
    massif(acc, rng, 30, 12, prof)
    monolith(acc, rng, 17.5, -1.5, 31, 5.0, lean=(-8, 1), top="split")     # split monolith leaning in
    monolith(acc, rng, 23.0, -0.5, 22, 4.0, lean=(13, -2), top="shear")     # sheared slab leaning out
    place_obj("CFCL_FarSil_MassifL", acc, (-47.0, 66.0), facing(-47.0, 66.0))

    # ---- LEFT pinnacle group, half cut by the frame edge (D~45): three slabs, one leaning, broken bridge
    rng = np.random.default_rng(3102)
    acc = T.MeshAcc()
    for (x, y, h, w, lean, tp) in ((-4.5, 0.0, 21, 4.6, (3, 0), "cap"), (0.8, 1.0, 15, 3.6, (-14, 2), "shear"),
                                   (5.5, -0.5, 19, 4.2, (5, -1), "split")):
        monolith(acc, rng, x, y, h, w, lean=lean, top=tp)
    arch_span(acc, rng, (-2.4, 0.0, 12.5), (3.1, -0.5, 11.5), width=2.0, thick=1.3, gap=(0.5, 0.75))
    place_obj("CFCL_FarSil_PinnaclesL", acc, (-31.0, 33.0), facing(-31.0, 33.0))

    # ---- RIGHT flank massif: terraces + a leaning pinnacle peeling off its inner end
    rng = np.random.default_rng(3103)
    acc = T.MeshAcc()
    prof = peaks_profile(rng, 30, 24, 2, base=0.4)
    massif(acc, rng, 30, 12, prof)
    monolith(acc, rng, -18.5, -2.0, 27, 4.6, lean=(-15, 0), top="cap")
    monolith(acc, rng, -24.0, -1.0, 16, 3.6, lean=(6, 0), top="split")
    place_obj("CFCL_FarSil_MassifR", acc, (49.0, 68.0), facing(49.0, 68.0))

    # ---- RIGHT pinnacle group with a broken bridge
    rng = np.random.default_rng(3104)
    acc = T.MeshAcc()
    for (x, y, h, w, lean, tp) in ((-4.0, 0.5, 14, 4.0, (7, 0), "shear"), (1.2, -1.0, 21, 4.6, (-3, 1), "split"),
                                   (6.5, 0.5, 13, 3.6, (-15, 0), "cap")):
        monolith(acc, rng, x, y, h, w, lean=lean, top=tp)
    arch_span(acc, rng, (-2.2, 0.0, 10.5), (2.9, -1.0, 11.0), width=2.0, thick=1.3,
              gap=(0.55, 0.8))
    place_obj("CFCL_FarSil_PinnaclesR", acc, (31.5, 34.0), facing(31.5, 34.0))

    # ---- BEHIND THE HAND: two cubic stacks joined by a broken arched bridge, low enough to keep the corona clear
    rng = np.random.default_rng(3105)
    acc = T.MeshAcc()
    monolith(acc, rng, -6.5, 0.0, 15, 5.6, lean=(2, 0), top="cap")
    monolith(acc, rng, 6.0, 0.5, 18, 6.0, lean=(-3, 0), top="split")
    monolith(acc, rng, 10.8, -1.5, 10, 3.4, lean=(14, 0), top="shear")
    arch_span(acc, rng, (-3.8, 0.0, 8.5), (3.0, 0.5, 9.0), width=3.0, thick=1.6, gap=(0.48, 0.68))
    place_obj("CFCL_FarSil_BehindHand", acc, (20.0, 66.0), facing(20.0, 66.0))

    # ---- low broken ridge in the centre (keeps the haze column under the eclipse open)
    rng = np.random.default_rng(3106)
    acc = T.MeshAcc()
    massif(acc, rng, 54, 7, lambda x: 4.5 * (0.6 + 0.4 * math.sin(x * 0.31) ** 2), cell=6.0, rows=1, notch=0.35,
           slab=(3.0, 5.0))
    place_obj("CFCL_FarSil_RidgeC", acc, (5.3, 102.0), facing(5.3, 102.0))

    # ---- VR enclosure: lower block massifs on the sides / behind the player
    for i, (name, x, y, Lm, Hm) in enumerate((("WallW", -59.0, 10.4, 38, 15), ("WallE", 57.4, 8.1, 36, 16),
                                              ("WallBack", 0.0, -60.0, 46, 11), ("WallBL", -46.0, -44.5, 32, 13),
                                              ("WallBR", 42.3, -45.3, 32, 12))):
        rng = np.random.default_rng(3110 + i)
        acc = T.MeshAcc()
        massif(acc, rng, Lm, 9, peaks_profile(rng, Lm, Hm, 2, base=0.45), cell=7.5, rows=2, slab=(4.0, 8.0))
        place_obj("CFCL_FarSil_" + name, acc, (x, y), facing(x, y))
    return pieces


STACK_SPOTS = [  # tools-agent BasaltStacks cluster centres (env): (x, y, r, h)
    (-22.0, 58.0, 7.0, 16.0), (26.0, 62.0, 6.0, 13.0), (-8.0, 72.0, 4.0, 8.0), (-11.0, 36.0, 3.0, 5.0),
    (18.5, 27.0, 3.2, 7.5), (-18.8, 15.2, 2.6, 6.0), (19.8, 15.8, 2.6, 7.0)]   # last two nudged clear of the
#   Meshy fossil ribs (world (-56,88) / (64,96) = env (-12.2,19.1) / (13.9,20.9))


def build_stacks(col):
    pieces = []
    for i, (x, y, rc, h) in enumerate(STACK_SPOTS):
        rng = np.random.default_rng(3200 + i)
        acc = T.MeshAcc()
        peak = (rng.uniform(-0.5, 0.5), rng.uniform(-0.4, 0.4))
        basalt_cluster(acc, rng, rc, h, peak=peak, col_r=(0.7 + 0.07 * rc, 1.0 + 0.1 * rc),
                       pinnacles=2 if rc > 3 else 1, leans=0.22)
        # asymmetric satellite sub-cluster with a negative-space gap, and a low cubic rubble skirt
        a = rng.uniform(0, 2 * np.pi)
        sub = T.MeshAcc()
        basalt_cluster(sub, rng, rc * 0.45, h * rng.uniform(0.45, 0.7), peak=(0.0, 0.0),
                       col_r=(0.6 + 0.05 * rc, 0.9 + 0.07 * rc), pinnacles=0, gaps=0.2, leans=0.3)
        off = np.array([math.cos(a), math.sin(a), 0.0]) * rc * 1.55
        acc.add(sub.verts() + off.astype(F32), sub.f)
        for k in range(int(4 + rc)):
            b = rng.uniform(0, 2 * np.pi)
            dd = rc * rng.uniform(0.8, 1.25)
            sz = rng.uniform(1.2, 2.4) * (0.6 + rc / 10)
            cblock(acc, rng, (math.cos(b) * dd, math.sin(b) * dd, -1.5 + sz * 0.3), (sz * 1.6, sz * 1.2, sz),
                   rng.uniform(0, 360), (rng.normal(0, 8), rng.normal(0, 8)))
        if i == 0:                                   # big left cluster: a broken arch to a split satellite stack
            stack(acc, rng, rc * 1.55, -1.0, -3.0, h * 0.75, 2.4, 2.6, (1.4, 2.8), (9, 0), taper=0.2)
            arch_span(acc, rng, (rc * 0.7, -1.0, h * 0.45), (rc * 1.5, -1.0, h * 0.5), width=1.3, thick=0.9,
                      gap=(0.45, 0.62))
        ob = T.mesh_obj(f"CFCL_FarStack_{i + 1:02d}", acc.verts(), acc.f, col, smooth=True, sharp_angle=30)
        ob.location = (x, y, -2.0)
        ob.rotation_euler = (0, 0, rng.uniform(0, 2 * np.pi))
        M.assign(ob, "Basalt", curvature=True, columns=0.0)     # no plank-like column streaks at distance
        pieces.append(ob)
    return pieces


def main():
    R.reset_scene()
    asset = "CFCL_Terrain_FarCliffs" if SET == "cliffs" else "CFCL_Terrain_FarStacks"
    col = T.new_collection(asset)
    obs = build_cliffs(col) if SET == "cliffs" else build_stacks(col)
    bpy.context.view_layer.update()
    tot = R.tri_count(obs)
    for o in obs:
        T.log(o.name, "tris", R.tri_count([o]), "dims", [round(v, 1) for v in o.dimensions])
    T.log("TOTAL", asset, tot)
    path, ver = T.next_version_path(asset, ITER)
    T.save_blend(path)
    sfx = "" if args.get("promote") else "_wip"      # official files only on --promote (README READY in lockstep)
    T.write_json(os.path.join(T.ASSETS, asset, f"arrangement{sfx}.json"),
                 {"asset": asset, "blend": os.path.basename(path),
                  "placements": [{"source": o.name, "name": o.name, "location": [round(c, 3) for c in o.location],
                                  "rotation_deg": [0.0, 0.0, round(math.degrees(o.rotation_euler.z), 2)],
                                  "scale": [1.0, 1.0, 1.0]} for o in obs]})
    T.write_json(os.path.join(T.ASSETS, asset, f"meta{sfx}.json"),
                 {"asset": asset, "blend": os.path.basename(path), "version": ver, "total_tris": tot,
                  "objects": [T.obj_info(o) for o in obs], "units": "ENV (main build: world = env*4.6, +1.94 Z)",
                  "origin": "base centre (Z -6 cliffs / -2 stacks); local -Y faces the arena; saved in place",
                  "material_slots": ["CFCL_Basalt", "(bridge/arch blocks share the rock material)"],
                  "replaces": "CFCL_FarLand_BasaltStacks (tools)" if SET == "stacks" else "FarCliffs v002 walls"})
    if args.get("norender"):
        return
    # silhouette check: black shapes on pale haze from the hero camera (env), + an aerial overview
    import cf_atmos as A
    sc = bpy.context.scene
    A.build_world(sc)
    lc = T.new_collection("CFCL_PreviewRig")
    A.build_light_rig(lc, board_shaft=False)
    A.build_fog_volume(lc, density=0.006)
    R.setup_render(sc, "EEVEE", (1280, 720), 32)
    pre = os.path.join(OUT, f"{SET}_iter{ITER:02d}")
    c = LD.CAMS["w_hero"]
    R.render_to(f"{pre}_hero.png", R.camera("CFCL_FS_hero", c["loc"], c["target"], c["lens"]))
    R.render_to(f"{pre}_aerial.png", R.camera("CFCL_FS_aerial", (0, -60, 45), (0, 40, 0), 28))
    for o in obs[:7]:                               # close silhouette views of the main pieces
        T.hide_all_but([o], obs)
        R.turntable([o], f"{pre}_{o.name}", views=(("front", 0, 6), ("q", -40, 12)), lens=35, dist_mult=1.5,
                    res=(640, 400), samples=16, ground=False)


main()
