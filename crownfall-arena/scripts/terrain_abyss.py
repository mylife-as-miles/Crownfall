"""CFCL_Terrain_Abyss - the lava abyss around the altar (REVISED scale: extent ~70 m, lava -2.45 near -> -4.8).

Objects (world coordinates, origin = world origin, saved in place):
  CFCL_Terrain_AbyssLava   lava surface (Lava material) only where lava can be seen; follows lava_z(x,y)
                           (-2.45 in the side clefts, flowing down to ~-4.8 at 33 m) + ripples.
                           Point colour attribute "CFCL_heat" (0..1: channel centre-lines near the altar = 1).
  CFCL_Terrain_AbyssCrust  ~1-2k real 3D cooled-crust plates (Basalt): Voronoi cells (stretched 1.6x along
                           the flow), jagged edges, slight dome/tilt, some up-tilted pressure ridges; they stand
                           0.1-0.4 m above the lava so plate edges occlude the glowing cracks.  Plates are
                           absent in the hottest channel cores (open lava ribbons) and thin out near the altar.
  CFCL_Terrain_AbyssBanks  rocky land: rubble buttes under every rib root, a broken near shelf ring (8-15 m)
                           cut by the clefts / rifts, sparse far shelves, and a rising stratified rim at
                           29-35 m so no straight horizon shows.  Terraced (soft-quantised) heights.
Lava plan (clefts flanking the altar, merging in front, outflow, rifts, pools) lives in
terrain_layout_data.py (shared with the rib arrangement).

Run:  python lib/run_blender.py scripts/terrain_abyss.py -- --iter 1 [--norender]
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, bmesh, S, M, R, F32

ASSET = "CFCL_Terrain_Abyss"
args = T.get_args()
ITER = int(args.get("iter", 1))
OUT = os.path.join(T.RENDERS, "abyss")
os.makedirs(OUT, exist_ok=True)
EXT = 35.0
RNG = np.random.default_rng(2024)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise2(x, y, freq, seed, oct=3):
    P = np.stack([x * freq, y * freq, np.full_like(x, seed * 0.173)], -1).reshape(-1, 3).astype(F32)
    return S.fbm(P, 1.0, oct, seed=seed).reshape(x.shape)


def grid_axis(N, a=0.5):
    u = np.linspace(-1, 1, N)
    return np.sign(u) * EXT * (a * np.abs(u) + (1 - a) * np.abs(u) ** 3)


# ---------------------------------------------------------------------------------------------
def land_height(x, y):
    """Height of rocky land ABOVE the local lava (negative = no land)."""
    r = np.hypot(x, y)
    b = LD.basin_sdf(x, y)
    n1 = noise2(x, y, 0.09, 11)
    n2 = noise2(x, y, 0.21, 12)
    n3 = noise2(x, y, 0.45, 13, 4)
    rift = np.full(x.shape, 1e9)
    for rf in LD.RIFTS:
        rift = np.minimum(rift, LD.seg_dist(x, y, rf))
    open_ = np.minimum(b, rift + 0.1)            # never build land in channels / rifts
    # near shelf ring (8-15 m): the rocky shore beyond the clefts, broken by noise gaps
    shelf = smoothstep(0.3, 1.4, open_) * (1 - smoothstep(12.5, 16.5, r + 4.0 * n1)) * smoothstep(-0.15, 0.1, n2)
    h = shelf * (0.7 + 0.45 * smoothstep(-0.2, 0.4, n1 + 0.3 * n2) + 0.12 * n3)
    # sparse far shelves (crust field dominates out there)
    far = smoothstep(0.5, 1.6, open_) * smoothstep(16.0, 19.0, r) * smoothstep(0.18, 0.34, n1 + 0.4 * n2)
    h = np.maximum(h, far * (0.5 + 0.5 * smoothstep(-0.2, 0.5, n2)))
    cm = LD.corner_lava_mask(x, y, margin=0.03)       # keep the hero corner sight-lines open
    h = np.where(cm | LD.in_cc0_bank(x, y), np.minimum(h, -0.5), h)   # CC0 canyon banks own that ground
    # rubble buttes under rib roots
    brng = np.random.default_rng(5)
    for p in LD.rib_placements():
        px, py, pz = p["location"]
        if bool(LD.in_cc0_bank(np.array(px), np.array(py))):
            continue                                       # rooted on a CC0 bank top: no butte needed
        sc = abs(p["scale"][2])
        rb = 0.5 + 0.42 * sc
        a0 = brng.uniform(0, 2 * np.pi)
        dd = np.zeros_like(x)
        for k in range(7):                                 # irregular cleaved outline
            a = a0 + k * 2 * np.pi / 7 + brng.uniform(-0.35, 0.35)
            dd = np.maximum(dd, ((x - px) * np.cos(a) + (y - py) * np.sin(a)) / brng.uniform(0.7, 1.3))
        dd = dd * (1 + 0.15 * n3)
        top = pz + 0.1 - float(LD.lava_z(px, py))
        m = 1 - smoothstep(rb * 0.75, rb, dd)
        tier = 1 - smoothstep(rb * 1.1, rb * 1.45, dd + 0.3 * rb * n2)
        hb = np.maximum(m * (top + 0.12 * n3), tier * top * (0.35 + 0.2 * n1))
        h = np.maximum(h, hb - (1 - tier) * 0.4)
    # rising stratified rim at the abyss edge
    rim = smoothstep(26.0, 34.0, r + 5.0 * n1 + 2.0 * n2) * smoothstep(-0.5, 2.5, LD.seg_dist(x, y, LD.CHANNEL_OUT))
    rimh = (0.7 + 1.8 * smoothstep(-0.3, 0.5, n2)) * (1 + 0.2 * n3) + 0.18 * np.maximum(r - 34.0, 0)
    h = np.maximum(h, rim * rimh)
    # terraces: soft quantisation (risers + flat treads), + rough surface
    step = 0.32
    k = np.floor(h / step)
    fr = h / step - k
    hq = step * (k + smoothstep(0.62, 1.0, fr))
    hq = np.where(h > 0, hq, h) + 0.03 * n3
    return hq


def build_land(col):
    N = 420
    xs = grid_axis(N, 0.55)
    X, Y = np.meshgrid(xs, xs, indexing="ij")
    Lz = LD.lava_z(X, Y)
    h = land_height(X, Y)
    H = Lz + h
    keep_v = h > -0.12
    kf = keep_v[:-1, :-1] | keep_v[1:, :-1] | keep_v[1:, 1:] | keep_v[:-1, 1:]
    idx = np.arange(N * N).reshape(N, N)
    q = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1)[kf]
    V = np.stack([X.ravel(), Y.ravel(), np.maximum(H, Lz - 0.35).ravel()], 1).astype(F32)
    used = np.unique(q)
    remap = -np.ones(N * N, np.int64)
    remap[used] = np.arange(len(used))
    ob = T.mesh_obj("CFCL_Terrain_AbyssBanks", V[used], remap[q].astype(np.int32), col, smooth=True,
                    sharp_angle=None, recalc=False)
    T.decimate_to(ob, 110000)
    T.shade(ob, True, 48)
    M.assign(ob, "Basalt", curvature=True)
    return ob


def build_lava(col):
    N = 230
    xs = grid_axis(N, 0.5)
    X, Y = np.meshgrid(xs, xs, indexing="ij")
    Lz = LD.lava_z(X, Y)
    h = land_height(X, Y)
    keep_v = h < 0.35
    kf = keep_v[:-1, :-1] | keep_v[1:, :-1] | keep_v[1:, 1:] | keep_v[:-1, 1:]
    # drop lava under the central rock / seats interiors (hidden anyway)
    cx = 0.25 * (X[:-1, :-1] + X[1:, 1:] + X[1:, :-1] + X[:-1, 1:])
    cy = 0.25 * (Y[:-1, :-1] + Y[1:, 1:] + Y[1:, :-1] + Y[:-1, 1:])
    kf &= np.hypot(cx, cy) > LD.PLATEAU_R - 1.0
    idx = np.arange(N * N).reshape(N, N)
    q = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1)[kf]
    rip = 0.025 * noise2(X, Y, 1.3, 31, 3) + 0.04 * noise2(X, Y, 0.35, 32, 2)
    V = np.stack([X.ravel(), Y.ravel(), (Lz + rip).ravel()], 1).astype(F32)
    used = np.unique(q)
    remap = -np.ones(N * N, np.int64)
    remap[used] = np.arange(len(used))
    ob = T.mesh_obj("CFCL_Terrain_AbyssLava", V[used], remap[q].astype(np.int32), col, smooth=True, recalc=False)
    hv = LD.heat(V[used][:, 0].astype(float), V[used][:, 1].astype(float)).astype(F32)
    try:
        ca = ob.data.color_attributes.new("CFCL_heat", "FLOAT_COLOR", "POINT")
        cols = np.stack([hv, hv, hv, np.ones_like(hv)], 1).ravel()
        ca.data.foreach_set("color", cols)
    except Exception as e:
        T.log("heat attribute failed", e)
    M.assign(ob, "Lava")
    me = ob.data
    me.materials.append(M.get("Lava", heat=2.2, glow=1.5))      # slot 1: hot channel cores / clefts
    me.materials.append(M.get("Lava", heat=0.35, glow=0.3))     # slot 2: cooled far field (crust stays dark)
    nf = len(me.polygons)
    ctr = np.zeros(nf * 3, F32)
    me.polygons.foreach_get("center", ctr)
    ctr = ctr.reshape(-1, 3)
    hf = LD.heat(ctr[:, 0].astype(float), ctr[:, 1].astype(float))
    idx = np.where(hf > 0.45, 1, np.where(hf < 0.12, 2, 0)).astype(np.int32)
    me.polygons.foreach_set("material_index", idx)
    T.log("lava faces hot/normal/dim", int((idx == 1).sum()), int((idx == 0).sum()), int((idx == 2).sum()))
    return ob


# ---------------------------------------------------------------------------------------------
def voronoi_cells(pts, k=14, stretch=(1.0, 1.6), box=EXT + 2):
    """Convex Voronoi cells by half-plane clipping (in a space where y is compressed by `stretch`)."""
    sx, sy = stretch
    Q = pts / np.array([sx, sy])
    n = len(Q)
    cells = []
    # neighbour search with a coarse grid hash
    cs = 4.5
    keys = np.floor(Q / cs).astype(int)
    from collections import defaultdict
    hsh = defaultdict(list)
    for i, kk in enumerate(map(tuple, keys)):
        hsh[kk].append(i)
    for i in range(n):
        kx, ky = keys[i]
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cand.extend(hsh.get((kx + dx, ky + dy), []))
        cand = np.array([c for c in cand if c != i])
        if len(cand) == 0:
            cells.append(None)
            continue
        d = np.linalg.norm(Q[cand] - Q[i], axis=1)
        nb = cand[np.argsort(d)[:k]]
        poly = [Q[i] + np.array(v) for v in ((-cs * 2, -cs * 2), (cs * 2, -cs * 2), (cs * 2, cs * 2), (-cs * 2, cs * 2))]
        for j in nb:
            m = 0.5 * (Q[i] + Q[j])
            nrm = Q[j] - Q[i]
            out = []
            L = len(poly)
            for a in range(L):
                p0, p1 = poly[a], poly[(a + 1) % L]
                s0 = (p0 - m) @ nrm
                s1 = (p1 - m) @ nrm
                if s0 <= 0:
                    out.append(p0)
                if (s0 <= 0) != (s1 <= 0):
                    t = s0 / (s0 - s1)
                    out.append(p0 + (p1 - p0) * t)
            poly = out
            if len(poly) < 3:
                break
        if len(poly) < 3:
            cells.append(None)
            continue
        cells.append(np.array(poly) * np.array([sx, sy]))
    return cells


def build_crust(col):
    rng = np.random.default_rng(77)
    # seeds: jittered grid thinned to a size field s(r)
    sp = 0.55
    g = np.arange(-EXT, EXT + 1e-6, sp)
    GX, GY = np.meshgrid(g, g, indexing="ij")
    P = np.stack([GX.ravel(), GY.ravel()], 1) + rng.uniform(-0.45, 0.45, (GX.size, 2)) * sp
    r = np.hypot(P[:, 0], P[:, 1])
    size = 0.5 + 0.055 * r
    keep = rng.random(len(P)) < (sp / size) ** 2 * 1.1
    P = P[keep]
    x, y = P[:, 0], P[:, 1]
    lh = land_height(x, y)
    rr = np.hypot(x, y)
    ok = (lh < 0.15) & (rr > LD.PLATEAU_R - 0.3) & (np.hypot(x + 3.3, y - 9.0) > 1.4) \
        & (np.hypot(x - 4.0, y - 10.0) > 1.2) & ~LD.in_cc0_bank(x, y)
    T.log("crust seeds", len(P), "kept", int(ok.sum()))
    cells = voronoi_cells(P)
    acc = T.MeshAcc()
    area_plates = 0.0
    nplates = 0
    for (cx, cy), cell, good in zip(P, cells, ok):
        if cell is None or not good:
            continue
        h = float(LD.heat(np.array([cx]), np.array([cy]))[0])
        if (h > 0.42 and rng.random() < 0.92) or (h > 0.15 and rng.random() < 0.12):
            continue                                   # open lava ribbon (hot core) / open pool
        if abs(cx) > EXT - 0.5 or abs(cy) > EXT - 0.5:
            continue
        Lz = float(LD.lava_z(cx, cy))
        c = cell.mean(0)
        rad = np.linalg.norm(cell - c, axis=1).mean()
        gap = 0.06 + 0.45 * h ** 1.2 + rng.uniform(0, 0.05)
        shrink = max(0.25, 1.0 - gap / max(rad, 1e-3))
        poly = np.clip(c + (cell - c) * shrink, -EXT, EXT)
        # jagged edges: split each edge, jitter the midpoint perpendicular
        pts = []
        for a in range(len(poly)):
            p0, p1 = poly[a], poly[(a + 1) % len(poly)]
            e = p1 - p0
            el = np.linalg.norm(e)
            nrm = np.array([e[1], -e[0]]) / max(el, 1e-6)
            pts.append(p0)
            for t in (0.33, 0.67):
                pts.append(p0 + e * t + nrm * rng.uniform(-0.08, 0.05) * el)
        pts = np.array(pts)
        ar = 0.5 * abs(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1)))
        if ar < 0.03:
            continue
        area_plates += ar
        nplates += 1
        top_h = 0.09 + 0.28 * (1 - h) ** 1.4 + rng.uniform(-0.03, 0.06)
        tilt = rng.normal(0, 0.04, 2)
        if rng.random() < 0.1:                           # pressure ridge: one side heaved up
            tilt = tilt + rng.normal(0, 1, 2) / max(rad, 0.3) * rng.uniform(0.12, 0.3)
        zt = Lz + top_h + (pts - c) @ tilt
        K = len(pts)
        top = np.column_stack([pts, zt])
        bot = np.column_stack([pts, np.full(K, Lz - 0.3)])
        ctr = np.array([[c[0], c[1], Lz + top_h + rng.uniform(0.0, 0.05) * min(rad, 1.5)]])
        V = np.concatenate([top, bot, ctr], 0)
        F = []
        for a in range(K):
            b2 = (a + 1) % K
            F.append([a, b2, 2 * K])                     # top fan
            F.append([b2, a, K + a, K + b2])             # side wall (outward)
        acc.add(V, F)
    ob = T.mesh_obj("CFCL_Terrain_AbyssCrust", acc.verts(), acc.f, col, smooth=True, sharp_angle=35)
    M.assign(ob, "LavaCrust")
    T.log("crust plates", nplates, "plate area m2", round(area_plates, 1))
    return ob, nplates, area_plates


def lava_area_estimate():
    N = 400
    xs = np.linspace(-EXT, EXT, N)
    X, Y = np.meshgrid(xs, xs, indexing="ij")
    lh = land_height(X, Y)
    r = np.hypot(X, Y)
    m = (lh < 0.15) & (r > 3.3)
    return float(m.sum()) * (2 * EXT / N) ** 2


def append_collection(blend, name):
    if not blend:
        return None
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c == name]
    for c in dst.collections:
        if c is not None:
            bpy.context.scene.collection.children.link(c)
            return c
    return None


def main():
    R.reset_scene()
    col = T.new_collection(ASSET)
    lava = build_lava(col)
    T.log("lava tris", R.tri_count([lava]))
    land = build_land(col)
    T.log("banks tris", R.tri_count([land]))
    crust, nplates, aplates = build_crust(col)
    T.log("crust tris", R.tri_count([crust]))
    alava = lava_area_estimate()
    cover = aplates / max(alava, 1e-3)
    T.log("lava-basin area", round(alava, 1), "crust coverage", round(cover, 3))
    obs = [lava, land, crust]
    path, ver = T.next_version_path(ASSET, ITER)
    T.save_blend(path)
    T.write_json(os.path.join(T.ASSETS, ASSET, "arrangement.json"),
                 {"asset": ASSET, "blend": os.path.basename(path),
                  "placements": [{"source": o.name, "name": o.name, "location": [0.0, 0.0, 0.0],
                                  "rotation_deg": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]} for o in obs]})
    T.write_json(os.path.join(T.ASSETS, ASSET, "meta.json"),
                 {"asset": ASSET, "blend": os.path.basename(path), "version": ver,
                  "objects": [T.obj_info(o) for o in obs],
                  "origin": "world origin (board centre); saved in place",
                  "material_slots": {"CFCL_Terrain_AbyssLava": "CFCL_Lava", "CFCL_Terrain_AbyssCrust": "CFCL_LavaCrust",
                                     "CFCL_Terrain_AbyssBanks": "CFCL_Basalt"},
                  "lava_level": "lava_z(r) = -2.45 for r<11 m, smoothstep down to -4.8 at r=33 m",
                  "crust_plates": nplates, "crust_coverage_of_visible_lava_area": round(cover, 3),
                  "heat_attribute": "CFCL_Terrain_AbyssLava has POINT FLOAT_COLOR 'CFCL_heat' (0..1) for "
                                    "the material agent: 1 = hottest channel core near the altar"})
    if args.get("norender"):
        return
    sc = bpy.context.scene
    cen = append_collection(T.latest_blend("CFCL_Terrain_Central"), "CFCL_Terrain_Central")
    import cf_atmos as A
    A.build_world(sc)
    lc = T.new_collection("CFCL_PreviewRig")
    A.build_light_rig(lc, board_shaft=False, lava_points=[((-5.0, 2.6, -1.9), 260.0), ((5.1, 2.6, -1.9), 260.0),
                                                          ((0.0, -6.0, -1.9), 240.0), ((-6.6, 9.0, -1.9), 280.0),
                                                          ((6.8, 9.5, -1.9), 280.0), ((0.0, 6.5, -1.9), 160.0)])
    A.build_fog_volume(lc, density=0.012)
    R.setup_render(sc, "EEVEE", (1280, 720), 48)
    sc.view_settings.exposure = 0.0
    pre = os.path.join(OUT, f"iter{ITER:02d}")
    cams = {
        "elevated": (LD.CAMS["elevated"]["loc"], LD.CAMS["elevated"]["target"], 24),
        "hero": (LD.CAMS["hero"]["loc"], LD.CAMS["hero"]["target"], 28),
        "cleft_low": ((-1.8, -2.5, 0.4), (-5.5, 6.0, -2.3), 30),
        "overview": ((18, -22, 14), (0, 3, -2.5), 28),
    }
    for k, (loc, tgt, lens) in cams.items():
        R.render_to(f"{pre}_{k}.png", R.camera("CFCL_Abyss_" + k, loc, tgt, lens))
    cd = bpy.data.cameras.new("CFCL_Abyss_TopOrtho")
    cd.type = "ORTHO"
    cd.ortho_scale = 72
    cd.clip_end = 500
    co = bpy.data.objects.new("CFCL_Abyss_TopOrtho", cd)
    sc.collection.objects.link(co)
    co.location = (0, 0, 60)
    co.rotation_euler = (0, 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = 1100, 1100
    R.render_to(f"{pre}_top.png", co)


main()
