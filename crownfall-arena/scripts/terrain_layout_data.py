"""Crownfall terrain - shared layout data (pure python + numpy, no bpy).

World metres, board centre = origin, +Z up, player on -Y.  Scale = REVISED contract (2026-10-23 ~20:05),
research ideal from research/reference_study.md section 6c.

Used by terrain_ribs.py / terrain_islands.py / terrain_abyss.py / terrain_layout.py and by
`python scripts/terrain_layout_data.py` (prints a composition check table for the hero camera).
"""
import math
import numpy as np

# ------------------------------------------------------------------ cameras (research spec)
CAMS = {
    # MAIN SCENE (2026-10-24): massive board (half-size 2.375 env) on the dais; cameras from build_main_scene.py
    "hero": dict(loc=(0.0, -6.522, 1.535), target=(0.0, 4.348, 0.774), lens=24.0),
    "hero_low": dict(loc=(0.0, -3.587, 0.317), target=(0.0, 6.522, 1.535), lens=22.0),
    "main_elevated": dict(loc=(0.0, -7.391, 8.274), target=(0.0, 1.304, -0.857), lens=24.0),
    "monuments": dict(loc=(0.0, -1.739, 1.317), target=(0.0, 9.783, 3.057), lens=28.0),
    "w_god": dict(loc=(0.0, -5.652, 6.1), target=(0.0, 0.435, -0.857), lens=26.0),
    "w_hero": dict(loc=(0.0, -6.522, 1.535), target=(0.0, 4.348, 0.774), lens=24.0),
    "w_high34": dict(loc=(-9.783, -11.957, 8.274), target=(0.0, 3.261, -0.422), lens=30.0),
    "w_worm": dict(loc=(1.304, -3.043, -0.161), target=(0.0, 6.522, 2.622), lens=18.0),
    "old_hero": dict(loc=(0.0, -1.31, 0.22), target=(0.0, 10.0, 0.615), lens=28.0),   # pre-2026-10-24 tabletop
    # research ideal (reference_study 6c): same position, +2 deg pitch -> reference screen fractions apply
    "research": dict(loc=(0.0, -1.31, 0.22), target=(0.0, -1.31 + 10 * math.cos(math.radians(2)),
                                                      0.22 + 10 * math.sin(math.radians(2))), lens=28.0),
    "seated": dict(loc=(0.0, -0.85, 0.55), target=(0.0, 6.0, 1.0), lens=24.0),
    "seated_up": dict(loc=(0.0, -0.85, 0.55), target=(0.0, 9.0, 1.5), lens=24.0),
    "elevated": dict(loc=(0.0, -7.0, 7.0), target=(0.0, 4.0, -1.0), lens=24.0),
}
ASPECT = 16.0 / 9.0

# ------------------------------------------------------------------ fixed sites (other agents)
SKULL = dict(center=(-2.8, 9.5, 1.0), width=2.7, height=2.5, codex=(-3.8, 8.1, -0.4))
HAND = dict(center=(4.5, 10.0, -0.35), top_z=3.8, codex=(3.6, 9.8, -0.2))
ECLIPSE = dict(center=(3.0, 20.0, 5.4), r=2.0)      # integration pass02 position
GATE = dict(center=(0.0, 11.05, 0.0), span=3.0, peak=4.9)
SKULL_SEAT = (-3.3, 9.0, -0.6)        # plateau top centre (~4 m wide)
HAND_SEAT = (4.0, 10.0, -0.5)         # mound top centre (~3.5 m)
DAIS = dict(z=-0.76, r=3.6)
PLATEAU_Z = -0.86                     # central rock top
PLATEAU_R = 4.95                      # central rock radius (dais r 4.2-4.5 + margin; clefts start beyond ~4.9)
DAIS_SEAT_R = 4.65                    # flat seat radius on the central rock
# CC0 canyon banks (CFCL_FromCodex_CC0Banks): inner face at the lava level |x| ~ 5.8-7.4 for y 1..19,
# tops Z -0.2..-1.35 (probe: renders/terrain/probe_banks.json)
CC0_BANK = dict(x_in=5.9, x_out=10.6, y0=0.7, y1=19.8)


def cc0_bank_top(x, y):
    """Approximate top height of the CC0 bank at (x,y) from the probe (right bank higher near y 3-9)."""
    yy = float(np.clip(y, 0.0, 19.0))
    if x > 0:
        prof = [-0.89, -0.72, -0.53, -0.23, -0.22, -0.3, -0.27, -0.26, -0.36, -0.75, -1.1, -1.33, -1.25, -1.27,
                -1.25, -1.29, -1.22, -1.24, -1.35, -1.35]
    else:
        prof = [-2.1, -1.32, -1.3, -1.36, -1.33, -1.35, -1.33, -1.41, -1.28, -0.99, -0.74, -0.36, -0.34, -0.35,
                -0.44, -0.3, -0.53, -0.71, -0.84, -0.84]
    return float(np.interp(yy, np.arange(len(prof)), prof))


def in_cc0_bank(x, y):
    return (np.abs(x) > CC0_BANK["x_in"]) & (np.abs(x) < CC0_BANK["x_out"]) & (y > CC0_BANK["y0"]) & (y < CC0_BANK["y1"])
LAVA_Z_NEAR = -1.75                   # lava surface in the side clefts (1.75 m below the altar rim, spec 1.5-3)


def cam_basis(name):
    c = CAMS[name]
    loc = np.array(c["loc"], float)
    f = np.array(c["target"], float) - loc
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    th = 18.0 / c["lens"]
    tv = th / ASPECT
    return loc, f, r, u, th, tv


def project(name, p):
    """-> (sx, sy, depth) with sx, sy in [0,1], origin top-left (like the reference measurements)."""
    loc, f, r, u, th, tv = cam_basis(name)
    d = np.asarray(p, float) - loc
    z = d @ f
    if z <= 1e-6:
        return (float("nan"), float("nan"), z)
    return (0.5 + (d @ r) / z / (2 * th), 0.5 - (d @ u) / z / (2 * tv), z)


def project_np(name, P):
    """Vectorised project: P (N,3) -> sx, sy, depth arrays."""
    loc, f, r, u, th, tv = cam_basis(name)
    d = np.asarray(P, float) - loc
    z = d @ f
    zz = np.where(z > 1e-6, z, np.nan)
    return 0.5 + (d @ r) / zz / (2 * th), 0.5 - (d @ u) / zz / (2 * tv), z


def corner_lava_mask(x, y, z=None, margin=0.0):
    """True where a point at lava level shows in the bottom corners of the hero / seated_up views
    (reference: lava visible at screen x 0-0.15 and 0.85-1.0, y > 0.72)."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    zz = lava_z(x, y) if z is None else z
    P = np.stack([x.ravel(), y.ravel(), np.broadcast_to(zz, x.shape).ravel()], 1)
    m = np.zeros(len(P), bool)
    for cam in ("hero", "hero_low"):
        sx, sy, dep = project_np(cam, P)
        m |= ((sx < 0.17 + margin) | (sx > 0.83 - margin)) & (sx > -0.05) & (sx < 1.05) & (sy > 0.70 - margin) \
            & (sy < 1.05) & (dep > 0) & (dep < 18.0)
    return m.reshape(x.shape)


def unproject(name, sx, sy, dist):
    """Point at euclidean distance `dist` from the camera along the ray through screen (sx, sy)."""
    loc, f, r, u, th, tv = cam_basis(name)
    ray = f + r * (sx - 0.5) * 2 * th - u * (sy - 0.5) * 2 * tv
    ray /= np.linalg.norm(ray)
    return loc + ray * dist


def polar(az, rad):
    a = math.radians(az)
    return rad * math.sin(a), rad * math.cos(a)


# ------------------------------------------------------------------ RIBS
# (variant, mode, a, b, root_z, scale, mirror, yaw jitter, tier, note)
#   mode "scr": a = hero-research screen x of the rib base, b = distance from the hero camera
#   mode "xy" : a, b = world x, y
#   mode "pol": a = azimuth (deg from +Y toward +X), b = radius from the board centre
RIB_SPOTS = [
    # v005 COMPOSITION (env units).  Asymmetric framing clusters on the CC0 canyon banks, thick near / thin far,
    # several broken, the front-left quadrant kept empty for the high34 gameplay camera.  yaw field: number =
    # jitter around "bend toward the arena centre"; (x, y) tuple = bend toward that point.
    # ---- left frame cluster (heavy): squat stump in front, aggressive leaner over the cleft, ruin-bound rib
    ("H", "xy", -6.70, 1.40, "bank", 1.00, False, (0.0, 6.0), "near", "L1 squat broken stump, frame anchor"),
    ("K", "xy", -7.40, 4.70, "bank", 0.85, False, (0.0, 4.0), "near", "L2 aggressive leaner over the left cleft"),
    ("L", "xy", -8.60, 8.20, "bank", 0.95, True, (0.0, 9.0), "near", "L3 ruin-bound rib: carved collar, chain, block"),
    ("I", "xy", -10.8, 12.8, "bank", 0.85, False, (0.0, 12.0), "mid", "whip rib rising behind the skull, left"),
    ("A", "xy", -12.6, 4.8, -1.45, 0.62, False, 6, "mid", "left, beyond the bank"),
    ("G", "xy", -9.6, -1.6, "bank", 1.25, True, -10, "mid", "left flank stump (outside the high34 corridor)"),
    # ---- right frame cluster (broken): twin ribs + slung chain, snapped rib with its fallen half, thin far
    ("M", "xy", 7.00, 2.40, "bank", 1.00, False, (0.0, 6.0), "near", "R1 twin ribs with a slung bronze chain"),
    ("J", "xy", 8.60, 6.80, "bank", 0.88, True, (0.0, 9.0), "near", "R2 snapped, upper half lying across rubble"),
    ("K", "xy", 9.60, 10.9, "bank", 0.70, True, (3.0, 8.0), "near", "R3 smaller counter-leaner right of the hand"),
    ("D", "xy", 11.4, 14.6, -1.60, 0.95, True, -4, "mid", "pointed, behind the hand, thin"),
    ("I", "xy", 12.9, 6.0, -1.45, 0.92, True, 8, "mid", "whip on the right flank"),
    ("K", "xy", 10.8, -1.4, -1.45, 0.80, False, (0.0, 0.0), "mid", "right flank leaner (VR)"),
    ("H", "xy", 5.40, -5.20, -1.45, 0.70, True, -15, "mid", "front-right squat stump in the moat"),
    # ---- behind the skull / hand: mid depth, medium thickness
    ("A", "xy", -8.20, 15.6, "bank", 0.66, False, 4, "mid", "big sweep behind the skull"),
    ("C", "xy", 8.20, 16.6, "bank", 0.85, True, -6, "mid", "behind the hand, right"),
    ("B", "xy", -5.6, 19.0, -1.70, 0.62, False, -8, "mid", "behind the skull, toward the corridor"),
    # ---- behind the player (VR enclosure), sparse and uneven
    ("E", "xy", 6.20, -9.20, -1.45, 1.15, False, 12, "mid", "behind-right snapped rib"),
    ("C", "xy", -1.80, -11.8, -1.45, 1.05, True, -6, "mid", "behind the player"),
    ("I", "xy", 3.20, -13.5, -1.45, 0.80, False, 5, "mid", "behind the player, whip"),
    # ---- far: thin, taller, sparse, fog-lifted
    ("I", "xy", -17.5, 23.5, -2.6, 1.05, True, 6, "far", "far left whip (clear of the Meshy fossil rib_a)"),
    ("A", "xy", -19.5, 12.5, -2.6, 1.00, False, -7, "far", "far left sweep"),
    ("D", "xy", 16.8, 24.8, -2.8, 1.40, True, 4, "far", "far right pointed (clear of the Meshy fossil rib_b)"),
    ("B", "xy", 18.5, 12.0, -2.6, 1.10, False, 6, "far", "far right"),
    ("C", "xy", -22.0, 2.0, -3.0, 1.50, False, 9, "far", "far left flank"),
    ("A", "xy", 20.0, -4.0, -2.8, 0.90, True, -12, "far", "far right flank"),
    ("B", "xy", -12.0, -17.0, -3.0, 1.15, True, -4, "far", "far behind left"),
    ("C", "xy", 11.0, -19.0, -3.0, 1.40, True, 11, "far", "far behind right"),
]


NEAR_TARGET = (0.0, 8.0)


def rib_xy(mode, a, b):
    if mode == "xy":
        return a, b
    if mode == "pol":
        return polar(a, b)
    p = unproject("research", a, 0.5, b)
    return float(p[0]), float(p[1])


def rib_placements():
    out = []
    for i, (k, mode, a, b, z, sc, mir, yj, tier, note) in enumerate(RIB_SPOTS):
        x, y = rib_xy(mode, a, b)
        if isinstance(yj, tuple):                   # bend toward a chosen point (composition tool)
            yaw = math.degrees(math.atan2(yj[1] - y, yj[0] - x))
        else:
            yaw = math.degrees(math.atan2(-y, -x)) + yj   # rib local +X -> arena centre
        inb = bool(in_cc0_bank(np.array(x), np.array(y)))
        if inb and tier != "far":
            z = round(cc0_bank_top(x, y) - 0.35, 3)          # rooted into the CC0 bank top
        elif z == "bank":
            z = round(max(cc0_bank_top(x, y) - 0.35, float(lava_z(x, y)) + 0.3), 3)
        elif tier == "far":
            z = round(float(lava_z(x, y)) + 0.8, 3)
        else:                                       # never root below the lava surface
            z = round(max(z, float(lava_z(x, y)) + 0.3), 3)
        out.append(dict(source="CFCL_Rib_" + k, name=f"CFCL_Rib_{k}_{tier}_{i + 1:02d}",
                        location=[round(x, 3), round(y, 3), z], rotation_deg=[0.0, 0.0, round(yaw, 2)],
                        scale=[sc, -sc if mir else sc, sc], tier=tier, note=note))
    return out


# ------------------------------------------------------------------ FLOATING ISLANDS (hero-screen arc)
# (source, screen x, screen y, distance from hero cam, yaw, tilt, scale, note)
ISLAND_SPOTS = [
    # sizes follow the reference frame fractions: large ~6-9 % W x 13-19 % H at 22-24 m (scaled carriers)
    ("CFCL_Island_Carrier_A", 0.400, 0.060, 24.0, 30, 14, 0.60, "large left island above/right of the skull crown"),
    ("CFCL_Island_Carrier_B", 0.640, 0.400, 22.0, -20, -10, 0.55, "large island below the eclipse, right of the haze column"),
    ("CFCL_Island_Small_D", 0.330, 0.140, 13.0, 70, 22, 1.0, "small, above the skull crown (>=4% H gap)"),
    ("CFCL_Island_Small_A", 0.470, 0.130, 19.0, -35, 18, 0.9, "small, mid arc"),
    ("CFCL_Island_Small_C", 0.560, 0.100, 26.0, 10, 25, 0.8, "small, touching the corona top-left (<10% of the disc)"),
    ("CFCL_Island_Small_B", (7.5, 16.0, 7.5), None, None, 110, -16, 1.0,
     "small, above-right of the hand fingertips (keeps the fingertip/corona gap clear)"),
]
DEBRIS_SPOTS = [
    # debris cluster object placed along the arc (comet tails toward the eclipse)
    ("CFCL_Island_Debris", 0.44, 0.10, 18.0, 20, 0, 0.7, "trail behind carrier A"),
    ("CFCL_Island_Debris", 0.585, 0.12, 21.5, 140, 30, 0.6, "spiral around the corona"),
    ("CFCL_Island_Debris", (6.5, 18.0, 7.6), None, None, 260, 10, 0.6, "trail above the hand fingertips"),
]


def island_placements():
    out = []
    for i, (src, sx, sy, d, yaw, tilt, sc, note) in enumerate(ISLAND_SPOTS + DEBRIS_SPOTS):
        p = np.array(sx, float) if isinstance(sx, tuple) else unproject("research", sx, sy, d)
        out.append(dict(source=src, name=f"{src}_P{i + 1:02d}", location=[round(float(c), 3) for c in p],
                        rotation_deg=[round(tilt * 0.6, 1), round(tilt, 1), float(yaw)], scale=[sc, sc, sc],
                        screen_hero=[round(float(v), 3) for v in project("hero", p)[:2]], note=note))
    return out


# ------------------------------------------------------------------ lava basin (plan polylines)
# Two side clefts flank the central rock, rise from behind the skull / hand seats and merge in front (-Y),
# then an outflow channel runs away behind the player.  (x, y, half-width)
CHANNEL_L = [(-8.0, 18.5, 0.9), (-6.6, 14.0, 0.75), (-6.0, 10.5, 0.7), (-5.7, 7.0, 0.75), (-5.6, 3.5, 0.75),
             (-5.6, 0.0, 0.8), (-5.0, -3.0, 0.9), (-3.2, -5.4, 1.0), (0.0, -6.3, 1.1)]
CHANNEL_R = [(8.4, 18.5, 0.9), (6.9, 14.0, 0.75), (6.1, 10.5, 0.7), (5.75, 7.0, 0.75), (5.65, 3.5, 0.75),
             (5.6, 0.0, 0.8), (5.0, -3.0, 0.9), (3.2, -5.4, 1.0), (0.0, -6.3, 1.1)]
CHANNEL_OUT = [(0.0, -6.3, 1.4), (-0.6, -9.5, 1.8), (0.8, -14.0, 2.2), (-0.6, -20.0, 2.6), (1.2, -27.0, 3.0),
               (0.0, -36.0, 3.4)]
# thin rifts of open lava through the far crust field
RIFTS = [
    [(-7.4, 12.5, 0.5), (-11.0, 15.0, 0.45), (-15.0, 21.0, 0.4), (-19.0, 27.0, 0.35)],
    [(7.6, 13.0, 0.5), (11.5, 16.5, 0.45), (14.0, 23.0, 0.4), (17.0, 30.0, 0.35)],
    [(-4.9, -0.6, 0.45), (-9.0, 0.5, 0.42), (-14.0, -1.5, 0.38), (-21.0, 0.5, 0.34), (-30.0, -2.0, 0.3)],
    [(5.0, -0.5, 0.45), (9.5, -1.5, 0.42), (15.0, 1.0, 0.38), (22.0, -1.0, 0.34), (30.0, 0.5, 0.3)],
    [(0.0, -9.5, 0.45), (-6.0, -12.0, 0.4), (-12.0, -16.0, 0.36), (-20.0, -19.0, 0.32)],
    [(0.8, -14.0, 0.45), (7.0, -16.0, 0.4), (13.0, -20.0, 0.36), (21.0, -22.0, 0.32)],
    [(0.0, 9.0, 0.35), (-1.0, 14.0, 0.35), (0.5, 19.0, 0.32), (-0.5, 26.0, 0.3)],
]
# lava pools: (x, y, radius) - moat around the central rock, ring around the seats, rear gaps
POOLS = [(0.0, 0.0, 6.0), (-3.3, 9.0, 2.9), (4.0, 10.0, 2.7), (0.6, 7.6, 2.8)]


def lava_z(x, y):
    """Lava surface height: -2.45 near the altar, flowing down to ~-4.8 at the abyss edge."""
    r = np.hypot(x, y)
    t = np.clip((r - 11.0) / 22.0, 0.0, 1.0)
    return LAVA_Z_NEAR - 2.35 * t * t * (3 - 2 * t)


def seg_dist(px, py, pts):
    """Distance from points to a polyline with per-vertex half-width -> (dist - halfwidth, t-param)."""
    best = np.full(np.shape(px), 1e9)
    for (x0, y0, w0), (x1, y1, w1) in zip(pts[:-1], pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1)
        d = np.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) - (w0 + t * (w1 - w0))
        best = np.minimum(best, d)
    return best


def basin_sdf(x, y):
    """<0 inside the open-lava basin features (clefts, merge, outflow, pools); rifts not included."""
    d = seg_dist(x, y, CHANNEL_L)
    d = np.minimum(d, seg_dist(x, y, CHANNEL_R))
    d = np.minimum(d, seg_dist(x, y, CHANNEL_OUT))
    for (cx, cy, r) in POOLS:
        d = np.minimum(d, np.hypot(x - cx, y - cy) - r)
    return d


def heat(x, y):
    """0..1: hottest (thinnest crust) along channel centre-lines near the altar, cooling outward."""
    def ch(pts, w):
        return np.exp(-np.maximum(seg_dist(x, y, [(a, b, 0.0) for a, b, _ in pts]), 0) ** 2 / w)
    h = np.maximum(ch(CHANNEL_L, 2.2), ch(CHANNEL_R, 2.2))
    h = np.maximum(h, ch(CHANNEL_OUT, 2.6) * 0.9)
    near = np.exp(-(np.hypot(x, y) / 13.0) ** 2)
    hr = 0.0
    for rf in RIFTS:
        hr = np.maximum(hr, np.exp(-np.maximum(seg_dist(x, y, [(a, b, 0.0) for a, b, _ in rf]), 0) ** 2 / 0.08))
    cm = corner_lava_mask(x, y).astype(float) * 0.62
    return np.clip(np.maximum(np.maximum(h * (0.45 + 0.55 * near), hr * 0.85), cm), 0, 1)


def check():
    print("RIBS (hero cam): name, tier, r, screen x,y(base), x(top-ish), depth")
    for p in rib_placements():
        x, y, z = p["location"]
        sb = project("research", (x, y, z))
        st = project("research", (x, y, z + 6 * p["scale"][2]))
        print(f"  {p['name']:22s} {p['tier']:4s} r={math.hypot(x, y):5.1f}  base=({sb[0]:.2f},{sb[1]:.2f}) "
              f"top=({st[0]:.2f},{st[1]:.2f}) d={sb[2]:.1f}")
    print("ISLANDS:")
    for p in island_placements():
        x, y, z = p["location"]
        print(f"  {p['name']:32s} loc=({x:6.2f},{y:6.2f},{z:5.2f}) dist_board={math.hypot(x, y):5.1f}")
    for k, v in (("skull", SKULL["center"]), ("hand_top", (HAND["center"][0], HAND["center"][1], HAND["top_z"])),
                 ("eclipse", ECLIPSE["center"]), ("gate_peak", (0, 11.05, 4.9))):
        print("  site", k, "research", [round(c, 3) for c in project("research", v)], "hero",
              [round(c, 3) for c in project("hero", v)])


if __name__ == "__main__":
    check()
