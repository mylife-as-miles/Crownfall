"""CFCL_Terrain_FarCliffs - one distant landscape layer (35-80 m): low-poly broken cliff walls, spire clusters
and one pale ruined-arch silhouette, so atmosphere has something to sit between (depth layering).

Design rules (hero camera (0,-1.31,0.22) -> (0,10,0.615), 28 mm):
  * skyline LOW in the central haze column (screen x 0.45-0.58) and under the eclipse; tall on the flanks
  * two depth sub-layers: 35-48 m (spire clusters, darker) and 52-78 m (walls / mesas, fog-lifted)
  * every wall has a broken stepped skyline, spires breaking off its top, strata insets and vertical joints;
    nothing smooth or conical.  Objects face the arena with their local -Y side.
Origin of each object = its base centre at Z=-6 (abyss floor level), rotation about Z only, saved in place.

Run:  python lib/run_blender.py scripts/terrain_farcliffs.py -- --iter 1 [--norender]
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, S, M, R, F32

ASSET = "CFCL_Terrain_FarCliffs"
args = T.get_args()
ITER = int(args.get("iter", 1))
OUT = os.path.join(T.RENDERS, "farcliffs")
os.makedirs(OUT, exist_ok=True)
BASE_Z = -6.0


def prism(P, c, r, n, rot, z0, z1, taper=0.35, tilt=(0.0, 0.0), seed=0):
    """Polygonal column (n sides) from z0 to z1 with taper and an oblique broken top."""
    x = P[:, 0] - c[0]
    y = P[:, 1] - c[1]
    z = P[:, 2]
    u = np.clip((z - z0) / max(z1 - z0, 1e-3), 0, 1)
    rz = r * (1 - taper * u ** 1.6)
    d = None
    rng = np.random.default_rng(abs(int(seed)))
    for k in range(n):
        a = rot + k * 2 * np.pi / n + rng.uniform(-0.2, 0.2)
        dk = x * math.cos(a) + y * math.sin(a) - rz * rng.uniform(0.85, 1.05)
        d = dk if d is None else np.maximum(d, dk)
    top = z - (z1 + tilt[0] * x + tilt[1] * y)
    return np.maximum(np.maximum(d, top), z0 - z)


def wall_sdf(L, D, H, seed, spires=4, notch=0.25):
    rng = np.random.default_rng(seed)
    nseg = max(4, int(L / rng.uniform(2.6, 4.2)))
    br = np.sort(rng.uniform(-L / 2, L / 2, nseg - 1))
    hs = H * rng.uniform(0.4, 1.0, nseg)
    hs[rng.random(nseg) < notch] *= rng.uniform(0.15, 0.4)
    sp = [(rng.uniform(-L * 0.45, L * 0.45), rng.uniform(-D * 0.3, D * 0.2), rng.uniform(1.2, 2.6),
           rng.uniform(0.25, 0.75) * H, int(rng.integers(5, 8)), rng.uniform(0, 6.3),
           rng.normal(0, 0.25, 2)) for _ in range(spires)]
    band = rng.uniform(1.4, 2.6)
    bins = rng.uniform(0.0, 0.8, 40)
    joints = [(rng.uniform(-L / 2, L / 2), rng.uniform(0.15, 0.4), rng.uniform(1.0, 2.2)) for _ in range(int(L / 3))]

    def f(P):
        Pw = S.warp(P, 0.6, 0.08, seed=seed, octaves=2)
        x, y, z = Pw[:, 0], Pw[:, 1], Pw[:, 2]
        idx = np.searchsorted(br, x)
        zt = hs[idx] + 0.6 * S.fbm(P * F32(0.15), 1.0, 2, seed=seed + 1)
        b = np.clip(np.floor(z / band).astype(np.int32), 0, 39)
        inset = bins[b]
        hx = L / 2 * (1 - 0.06 * np.clip(z / H, 0, 1)) - inset * 0.5
        hy = D / 2 * (1 - 0.35 * np.clip(z / H, 0, 1.2)) - inset
        d = np.maximum(np.maximum(np.abs(x) - hx, np.abs(y) - hy), np.maximum(z - zt, -z - 2.0))
        for (sx, sy, sr, sh, sn, srot, stl) in sp:
            ztop = float(hs[int(np.searchsorted(br, sx))])
            d = np.minimum(d, prism(Pw, (sx, sy), sr, sn, srot, -2.0, ztop + sh, 0.55, tuple(stl * 0.4),
                                    seed=seed + int(sx * 10)))
        for (jx, jw, jd) in joints:                     # vertical joints on the arena-facing (-Y) face
            rem = np.maximum(np.abs(x - jx) - jw, (-hy + jd) + y)
            d = np.maximum(d, -rem)
        return d + 0.25 * S.fbm(P * F32(0.3), 1.0, 3, seed=seed + 3)

    ext = max(L, D) / 2 + 3
    return f, (-L / 2 - 3, -D / 2 - 3, -2.5), (L / 2 + 3, D / 2 + 3, H * 1.8 + 2)


def spires_sdf(n, Hmax, seed, spread=6.0):
    rng = np.random.default_rng(seed)
    sp = []
    for i in range(n):
        h = Hmax * rng.uniform(0.45, 1.0) * (1.0 if i == 0 else 0.8)
        sp.append((rng.normal(0, spread * 0.5), rng.normal(0, spread * 0.35), rng.uniform(1.0, 1.9) * (h / Hmax) ** 0.5 + 0.5,
                   h, int(rng.integers(5, 8)), rng.uniform(0, 6.3), rng.normal(0, 0.35, 2)))
    band = rng.uniform(1.2, 2.2)
    bins = rng.uniform(0.0, 0.55, 40)

    def f(P):
        Pw = S.warp(P, 0.3, 0.12, seed=seed, octaves=2)
        z = Pw[:, 2]
        b = np.clip(np.floor(z / band).astype(np.int32), 0, 39)
        d = None
        for (x0, y0, r, h, k, rot, tl) in sp:
            v = prism(Pw, (x0, y0), r, k, rot, -2.0, h, 0.3, tuple(tl * 0.5), seed=seed + int(h * 7)) + bins[b] * 0.7
            d = v if d is None else np.minimum(d, v)
        skirt = S.ellipsoid(Pw, (0, 0, -1.2), (spread * 0.75, spread * 0.55, 3.0))     # low rubble apron
        d = S.smin(d, skirt + 0.4 * S.ridged(P, 0.6, 2, seed=seed + 5), 0.4)
        return d + 0.18 * S.fbm(P * F32(0.35), 1.0, 3, seed=seed + 2)

    e = spread + 4
    return f, (-e, -e, -2.5), (e, e, Hmax + 2)


def ruin_arch_sdf(seed=7):
    """Pale broken arch silhouette: two block-coursed piers, a partial voussoir ring, a fallen block."""
    span, ph, pw = 7.0, 8.5, 1.6

    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d = None
        for sxn, hh in ((-1, ph), (1, ph * 0.72)):
            cxp = sxn * (span / 2 + pw / 2)
            course = np.floor(z / 0.9)
            off = ((np.sin(course * 12.9898 + sxn * 3.1) * 43758.5453) % 1.0 - 0.5) * 0.3
            v = np.maximum(np.maximum(np.abs(x - cxp - off) - pw / 2, np.abs(y) - pw / 2), np.maximum(z - hh, -z))
            d = v if d is None else np.minimum(d, v)
        rr = np.hypot(x, z - ph)
        ang = np.arctan2(z - ph, x)
        ring = np.maximum(np.abs(rr - (span / 2 + pw / 2)) - pw / 2, np.abs(y) - pw * 0.45)
        ring = np.maximum(ring, -(z - ph))
        ring = np.maximum(ring, 0.42 * np.pi - ang)          # right part of the arch has fallen
        seg = np.abs(((ang / 0.3) % 1.0) - 0.5) * 0.3 * rr   # voussoir joints
        ring = np.maximum(ring, 0.05 - seg)
        d = np.minimum(d, ring)
        d = np.minimum(d, S.box(P, (span * 0.2, -1.6, 0.55), (1.1, 0.7, 0.55), S.rot_matrix(0, 18, 25)))
        d = np.minimum(d, S.box(P, (span * 0.45, 1.2, 0.4), (0.8, 0.6, 0.4), S.rot_matrix(12, -8, 60)))
        return d

    return f, (-span - 2.5, -3.0, -0.5), (span + 2.5, 3.0, ph + span / 2 + pw + 1.0)


# (name, kind, az deg, r, params, target tris)
# Layering in the hero frame: skull/hand 9-11 m -> far ribs 17-26 m -> spire clusters 36-44 m ->
# CFCL_Arch_FarRuins (architect, 50-85 m) -> these walls as the palest skyline at 90-100 m.
# (name, kind, az deg, r, params, target tris)
PIECES = [
    ("CFCL_FarCliff_WallL", "wall", -31, 95, dict(L=48, D=10, H=22, seed=11, spires=6), 2600),
    ("CFCL_FarCliff_WallR", "wall", 31, 98, dict(L=46, D=10, H=19, seed=12, spires=5), 2400),
    ("CFCL_FarCliff_RidgeC", "wall", 3, 102, dict(L=54, D=8, H=4.0, seed=13, spires=2, notch=0.45), 1600),
    ("CFCL_FarCliff_WallW", "wall", -80, 60, dict(L=40, D=9, H=13, seed=14, spires=4), 1900),
    ("CFCL_FarCliff_WallE", "wall", 82, 58, dict(L=38, D=9, H=14, seed=15, spires=4), 1900),
    ("CFCL_FarCliff_WallBack", "wall", 180, 60, dict(L=50, D=9, H=10, seed=16, spires=3), 1700),
    ("CFCL_FarCliff_WallBL", "wall", -134, 64, dict(L=36, D=9, H=12, seed=17, spires=3), 1400),
    ("CFCL_FarCliff_WallBR", "wall", 137, 62, dict(L=36, D=9, H=11, seed=18, spires=3), 1400),
    ("CFCL_FarCliff_SpiresL", "spires", -20, 38, dict(n=4, Hmax=16, seed=21, spread=6), 1500),
    ("CFCL_FarCliff_SpiresR", "spires", 27, 42, dict(n=3, Hmax=10, seed=22, spread=5), 1200),
    ("CFCL_FarCliff_SpiresWL", "spires", -52, 36, dict(n=3, Hmax=15, seed=23, spread=5), 1200),
    ("CFCL_FarCliff_SpiresWR", "spires", 55, 38, dict(n=3, Hmax=14, seed=24, spread=5), 1200),
]


def build_piece(name, kind, az, r, prm, target, col):
    if kind == "wall":
        f, bmin, bmax = wall_sdf(prm["L"], prm["D"], prm["H"], prm["seed"], prm.get("spires", 4),
                                 prm.get("notch", 0.25))
        vox = 0.32
    elif kind == "spires":
        f, bmin, bmax = spires_sdf(prm["n"], prm["Hmax"], prm["seed"], prm.get("spread", 6.0))
        vox = 0.22
    else:
        f, bmin, bmax = ruin_arch_sdf()
        vox = 0.12
    ob = T.sdf_object(name, f, bmin, bmax, vox, col, target_tris=None, sharp_angle=None)
    T.drop_small_parts(ob, 40)
    T.decimate_to(ob, target)
    T.shade(ob, True, 40)
    a = math.radians(az)
    ob.location = (r * math.sin(a), r * math.cos(a), BASE_Z)
    ob.rotation_euler = (0, 0, -a)
    return ob


def main():
    R.reset_scene()
    col = T.new_collection(ASSET)
    obs = []
    for (name, kind, az, r, prm, tgt) in PIECES:
        ob = build_piece(name, kind, az, r, prm, tgt, col)
        M.assign(ob, "Basalt", curvature=True)
        obs.append(ob)
        T.log(name, "tris", R.tri_count([ob]), "dims", [round(x, 1) for x in ob.dimensions])
    # (broken architecture is CFCL_Arch_FarRuins' job - this asset is geology only)
    bpy.context.view_layer.update()
    tot = R.tri_count(obs)
    T.log("TOTAL far tris", tot)
    path, ver = T.next_version_path(ASSET, ITER)
    T.save_blend(path)
    T.write_json(os.path.join(T.ASSETS, ASSET, "arrangement.json"),
                 {"asset": ASSET, "blend": os.path.basename(path),
                  "placements": [{"source": o.name, "name": o.name, "location": [round(c, 3) for c in o.location],
                                  "rotation_deg": [0.0, 0.0, round(math.degrees(o.rotation_euler.z), 2)],
                                  "scale": [1.0, 1.0, 1.0]} for o in obs]})
    T.write_json(os.path.join(T.ASSETS, ASSET, "meta.json"),
                 {"asset": ASSET, "blend": os.path.basename(path), "version": ver, "total_tris": tot,
                  "objects": [T.obj_info(o) for o in obs],
                  "origin": "base centre at Z=-6 (abyss floor level); local -Y faces the arena; saved in place",
                  "material_slots": ["CFCL_Basalt"],
                  "intent": "single distant landscape layer 35-78 m; skyline kept low in the central haze column"})
    if args.get("norender"):
        return
    import cf_atmos as A
    sc = bpy.context.scene
    A.build_world(sc)
    lc = T.new_collection("CFCL_PreviewRig")
    A.build_light_rig(lc, board_shaft=False)
    A.build_fog_volume(lc, density=0.012)
    R.setup_render(sc, "EEVEE", (1280, 720), 48)
    pre = os.path.join(OUT, f"iter{ITER:02d}")
    for k in ("hero", "seated", "elevated"):
        c = LD.CAMS[k]
        R.render_to(f"{pre}_{k}.png", R.camera("CFCL_Far_" + k, c["loc"], c["target"], c["lens"]))
    R.render_to(f"{pre}_behind.png", R.camera("CFCL_Far_behind", (0, 1.0, 0.6), (0, -20, 3), 24))
    R.render_to(f"{pre}_aerial.png", R.camera("CFCL_Far_aerial", (0, -95, 70), (0, 5, 0), 30))


main()
