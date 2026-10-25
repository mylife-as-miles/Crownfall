"""CFCL_Terrain_Islands - 6 unique floating islands (2 carriers + 4 small) + one debris-chip comet tail.

Each island (SDF, numpy):
  * top: broken slab, gently domed, rim notches + 1-2 fissures (ruins / vegetation can sit on it)
  * underside: asymmetric inverted wedge 1.2-2x top width deep, made of 4-7 horizontal STRATA bands
    (each band a slab with its own scale/offset and 3 vertical cleavage planes -> undercut shadow lines),
    one secondary lobe, a blunt broken tip, 2-4 broken drips, 6-10 root sockets under the lip
Origin = centre of the top surface (Z=0 is the top plateau).  Materials: Basalt (slot 0) + AncientStone on
up-facing top faces (slot 1); moss comes from the materials' up-mask.

Run:  python lib/run_blender.py scripts/terrain_islands.py -- --iter 1 [--norender] [--only Carrier_A]
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, S, M, R, F32

ASSET = "CFCL_Terrain_Islands"
args = T.get_args()
ITER = int(args.get("iter", 1))
OUT = os.path.join(T.RENDERS, "islands")
os.makedirs(OUT, exist_ok=True)

ISLANDS = {
    #            R(top half-width) elong      D(depth) bands pw  tipw lobe  seed
    "Carrier_A": dict(R=1.75, el=(1.0, 0.8), D=5.2, nb=6, pw=0.85, tipw=0.13, lobe=True, seed=101, dome=0.08,
                      target=22000),
    "Carrier_B": dict(R=1.55, el=(1.3, 0.85), D=3.7, nb=5, pw=1.1, tipw=0.16, lobe=True, seed=211, dome=0.06,
                      target=20000),
    "Small_A": dict(R=0.60, el=(1.0, 0.85), D=1.75, nb=4, pw=0.9, tipw=0.15, lobe=True, seed=307, dome=0.05,
                    target=7000),
    "Small_B": dict(R=0.42, el=(1.2, 0.8), D=1.25, nb=4, pw=1.0, tipw=0.16, lobe=False, seed=409, dome=0.05,
                    target=5000),
    "Small_C": dict(R=0.70, el=(1.1, 0.9), D=2.3, nb=5, pw=0.8, tipw=0.12, lobe=True, seed=503, dome=0.06,
                    target=8000),
    "Small_D": dict(R=0.30, el=(1.0, 0.75), D=0.85, nb=3, pw=1.0, tipw=0.18, lobe=False, seed=607, dome=0.04,
                    target=3000),
}


def make_island_sdf(cfg):
    R0, D0 = cfg["R"], cfg["D"]
    ex, ey = cfg["el"]
    nb = cfg["nb"]
    seed = cfg["seed"]
    rng = np.random.default_rng(seed)

    def band_params(nbands, Rr):
        n = nbands + 3
        bs = rng.uniform(0.86, 1.04, n)
        bs[rng.random(n) < 0.3] *= rng.uniform(0.78, 0.86)      # recessed soft beds -> undercut shadow lines
        bs[0] = 1.0
        bo = rng.normal(0, 0.06, (n, 2))
        bo[0] = 0
        pa = rng.uniform(0, 2 * np.pi, (n, 5))
        po = rng.uniform(0.6, 0.95, (n, 5))                      # blocky cleaved beds, not round drums
        po[0] = rng.uniform(0.82, 0.97, 5)
        th = rng.choice([0.55, 0.8, 1.0, 1.3, 1.7], n)            # irregular bed thicknesses
        cum = np.cumsum(th) / th[:nbands].sum()
        la = rng.uniform(0, 2 * np.pi)
        lean = np.array([math.cos(la), math.sin(la)]) * rng.uniform(0.3, 0.5)   # asymmetric wedge
        return bs, bo, pa, po, cum, lean

    main = dict(cx=0.0, cy=0.0, R=R0, D=D0, nb=nb, ex=ex, ey=ey, bp=band_params(nb, R0),
                tilt=rng.normal(0, 0.15, 2), top=True)
    parts = [main]
    if cfg["lobe"]:
        a = rng.uniform(0, 2 * np.pi)
        parts.append(dict(cx=0.5 * R0 * math.cos(a), cy=0.5 * R0 * math.sin(a), R=0.58 * R0, D=0.72 * D0,
                          nb=max(3, nb - 2), ex=1.0, ey=0.9, bp=band_params(nb, R0 * 0.55),
                          tilt=rng.normal(0, 0.2, 2), top=False))
    # rim notches + fissures on the top slab
    notches = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.72, 0.9), rng.uniform(0.1, 0.3) * R0)
               for _ in range(int(rng.integers(2, 5)))]
    fiss = [(rng.uniform(0, np.pi), rng.uniform(-0.4, 0.4) * R0, rng.uniform(0.02, 0.045) * R0,
             rng.uniform(0.15, 0.35) * R0) for _ in range(int(rng.integers(1, 3)))]
    # drips (broken stalactites) hanging from band undersides
    drips = []
    for _ in range(int(rng.integers(2, 5))):
        a = rng.uniform(0, 2 * np.pi)
        u = rng.uniform(0.25, 0.7)
        rr = R0 * (1 - u) ** 0.9 * rng.uniform(0.35, 0.7)
        drips.append((rr * math.cos(a) * ex, rr * math.sin(a) * ey, -u * D0 + 0.05 * D0,
                      rng.uniform(0.12, 0.3) * D0, rng.uniform(0.07, 0.12) * R0))
    # root sockets under the lip
    sockets = []
    for _ in range(int(rng.integers(6, 11))):
        a = rng.uniform(0, 2 * np.pi)
        u = rng.uniform(0.06, 0.3)
        rr = R0 * (1 - u) ** 0.9 * 0.86
        sockets.append((rr * math.cos(a) * ex, rr * math.sin(a) * ey, -u * D0, rng.uniform(0.045, 0.08) * R0))

    def wedge(P, Pw, p):
        x = (Pw[:, 0] - p["cx"]) / p["ex"]
        y = (Pw[:, 1] - p["cy"]) / p["ey"]
        z = Pw[:, 2]
        R_, D_, nb_ = p["R"], p["D"], p["nb"]
        bs, bo, pa, po, cum, lean = p["bp"]
        phi = np.arctan2(y, x)
        ring = np.stack([np.cos(phi) * 1.6, np.sin(phi) * 1.6, np.full_like(phi, seed * 0.37 + R_)], 1).astype(F32)
        Rp = R_ * (1.0 + 0.15 * S.perlin(ring, seed) + 0.06 * S.perlin(ring * 2.7, seed + 5))
        u = np.clip(-z / D_, 0.0, 1.25)
        wob = S.fbm(P * F32(0.7 / R0), 1.0, 2, seed=seed + 9) * 0.05
        b = np.clip(np.searchsorted(cum, u + wob), 0, len(bs) - 1).astype(np.int32)
        ub = np.clip(np.where(b > 0, cum[np.maximum(b - 1, 0)], 0.0) + 0.02, 0, 1)
        prof = np.maximum(cfg["tipw"] * 0.5, (1.0 - ub) ** cfg["pw"])
        Rz = Rp * prof * bs[b]
        sh = (ub ** 1.2) * R_
        xo = x - bo[b, 0] * R_ - lean[0] * sh
        yo = y - bo[b, 1] * R_ - lean[1] * sh
        side = (np.sqrt(xo * xo + yo * yo) - Rz) * 0.85
        for i in range(5):
            d_pl = xo * np.cos(pa[b, i]) + yo * np.sin(pa[b, i]) - po[b, i] * Rz
            side = np.maximum(side, d_pl)
        if p["top"]:
            rho = np.sqrt(x * x + y * y)
            ztop = cfg["dome"] * R_ * (1 - np.clip(rho / R_, 0, 1.2) ** 2) + 0.025 * R_ * S.fbm(P * F32(2.0 / R0), 1.0, 3, seed=seed + 3)
            top = Pw[:, 2] - ztop
        else:
            top = Pw[:, 2] + 0.18 * D0       # lobe starts below the top slab
        tx, ty = p["tilt"]
        bot = -Pw[:, 2] - D_ * (0.88 + 0.12 * (x * tx + y * ty) / R_)      # blunt oblique broken tip
        return np.maximum(np.maximum(side, top), bot)

    def f(P):
        Pw = S.warp(P, 0.035 * R0, 1.1 / R0, seed=seed, octaves=2)
        d = wedge(P, Pw, parts[0])
        for p in parts[1:]:
            d = S.smin(d, wedge(P, Pw, p), 0.06 * R0)
        # rim notches: remove rim segments of the top slab
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
            dd = np.maximum(dd, -(P[:, 2] - (z0 - ln * 0.8)))      # broken end
            d = S.smin(d, dd, 0.05 * R0)
        for (x0, y0, z0, rr) in sockets:
            d = S.ssub(d, S.sphere(P, (x0, y0, z0), rr), 0.02 * R0)
        d = d + 0.01 * R0 * S.fbm(P * F32(3.5 / R0), 1.0, 3, seed=seed + 21)
        return d

    ext = R0 * 1.25 * max(ex, ey) + (0.45 * R0 if cfg["lobe"] else 0)
    bmin = (-ext, -ext, -D0 * 1.12 - 0.05)
    bmax = (ext, ext, R0 * 0.18)
    return f, bmin, bmax, sockets


def build_island(key, col):
    cfg = ISLANDS[key]
    f, bmin, bmax, sockets = make_island_sdf(cfg)
    vox = cfg["R"] / 48.0
    ob = T.sdf_object("CFCL_Island_" + key, f, bmin, bmax, vox, col, target_tris=None, sharp_angle=None)
    T.drop_small_parts(ob, 200)
    T.decimate_to(ob, cfg["target"])
    T.shade(ob, True, 42)
    T.assign_two_materials(ob, "Basalt", "AncientStone", up=0.62, zmin=-0.12 * cfg["D"])
    import json as _json
    ob["cf_root_sockets_local_json"] = _json.dumps([[round(float(v), 3) for v in s_[:3]] for s_ in sockets])
    return ob, sockets


def build_debris(col, seed=901, n=14):
    """Comet tail of angular chips along local +X (head at origin), sizes ~1/6 .. 1/60 of a 3.6 m island."""
    rng = np.random.default_rng(seed)
    acc = T.MeshAcc()
    for i in range(n):
        t = i / (n - 1)
        size = 0.6 * (1 - t) ** 1.6 + 0.06
        V, Fc = T.block_chunk(rng, size)
        V = V @ T.rot3(*rng.uniform(0, 360, 3)).T
        pos = np.array([t * 6.5 + rng.normal(0, 0.25), rng.normal(0, 0.35 + 0.3 * t), rng.normal(0, 0.25 + 0.25 * t)
                        + 0.6 * t], F32)
        acc.add(V + pos, Fc)
    ob = T.mesh_obj("CFCL_Island_Debris", acc.verts(), acc.f, col, smooth=True, sharp_angle=30)
    M.assign(ob, "Basalt")
    return ob


def main():
    R.reset_scene()
    col = T.new_collection(ASSET)
    obs = []
    sock = {}
    only = args.get("only")
    for k in ISLANDS:
        if only and k != only:
            continue
        ob, s = build_island(k, col)
        obs.append(ob)
        sock[ob.name] = [[round(float(v), 3) for v in s_[:3]] for s_ in s]
        T.log(k, "tris", R.tri_count([ob]), "dims", [round(x, 2) for x in ob.dimensions])
    deb = build_debris(col)
    obs.append(deb)
    path, ver = T.next_version_path(ASSET, ITER)
    T.save_blend(path)
    pl = LD.island_placements()
    T.write_json(os.path.join(T.ASSETS, ASSET, "arrangement.json"),
                 {"asset": ASSET, "blend": os.path.basename(path),
                  "placements": [{k: p[k] for k in ("source", "name", "location", "rotation_deg", "scale")}
                                 for p in pl]})
    T.write_json(os.path.join(T.ASSETS, ASSET, "meta.json"),
                 {"asset": ASSET, "blend": os.path.basename(path), "version": ver,
                  "objects": [T.obj_info(o) for o in obs],
                  "origin": "islands: centre of the top surface (Z=0 = top plateau); debris: head chip at origin, "
                            "tail along local +X",
                  "material_slots": ["CFCL_Basalt (underside/sides)", "CFCL_AncientStone (up-facing top faces)"],
                  "budget_tris_each": 25000, "root_sockets_local": sock,
                  "placement_notes": [{"name": p["name"], "note": p["note"], "screen_research_cam": p["screen_hero"]}
                                      for p in pl],
                  "params": {k: {kk: (list(vv) if isinstance(vv, tuple) else vv) for kk, vv in v.items()}
                             for k, v in ISLANDS.items()}})
    if args.get("norender"):
        return
    sc = bpy.context.scene
    R.setup_world(sc)
    R.standard_lights(scale=2.0)
    pre = os.path.join(OUT, f"iter{ITER:02d}")
    views = (("front", 0, 10), ("q_left", -45, -18), ("side", 90, 25), ("below", 160, -38))
    for o in obs:
        o.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for o in obs:
        T.hide_all_but([o], obs)
        R.turntable([o], f"{pre}_{o.name}", views=views, lens=45, dist_mult=1.7, res=(800, 640), samples=32,
                    ground=False)
    # group shot: all islands spaced in a row, seen slightly from below (as from the board)
    xs = 0.0
    for o in obs:
        o.hide_render = False
        o.hide_viewport = False
        o.location = (xs + o.dimensions.x * 0.5, 0, 0)
        xs += o.dimensions.x + 1.0
        bpy.context.view_layer.update()
    mn, mx = R.bounds(obs)
    ctr = (mn + mx) / 2
    cam = R.camera("CFCL_IslandsGroup", (ctr.x, ctr.y - (mx.x - mn.x) * 0.9, ctr.z - 3.0), ctr, lens=35)
    R.setup_render(sc, "EEVEE", (1600, 700), 32)
    R.render_to(f"{pre}_group_low.png", cam)


main()
