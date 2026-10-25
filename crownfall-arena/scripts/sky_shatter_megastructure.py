"""CFCL_Sky_Shatter v011 - numpy-only geometry (no bpy) for
  (1) MEGASTRUCTURE architecture on the torn landmasses: stepped masonry foundation slab torn open at the front,
      suspended colonnade (standing + snapped columns, capitals, lintel fragments, fallen drums), roofless chambers
      with arched doorways, a barrel-vaulted hall exposed in section by the tear, and a bridge running off the edge
      whose outer span has snapped and hangs.  All pieces are chamfered extrusions/sweeps (low-poly, bevelled,
      readable at ~300 m).
  (2) CELESTIAL MECHANISM around the eclipse: fragments of three concentric rings (carved stone / aged bronze with
      a raised riveted band and gear-tooth notches), spokes/bridges, suspended foundation blocks, drifting pieces.
Every builder returns (verts (N,3), faces list, tags list) via an Acc; tags select the material slot.
"""
import math

import numpy as np

import sky_shatter_layout as L


class Acc:
    def __init__(self):
        self.V, self.F, self.T, self.UV, self.n = [], [], [], [], 0

    def add(self, V, F, tag=0, uv=None):
        V = np.asarray(V, float)
        self.V.append(V)
        self.F += [tuple(int(i) + self.n for i in f) for f in F]
        self.T += [tag] * len(F)
        self.UV.append(np.zeros((len(V), 2)) if uv is None else np.asarray(uv, float))
        self.n += len(V)

    def verts(self):
        return np.vstack(self.V) if self.V else np.zeros((0, 3))

    def uvs(self):
        return np.vstack(self.UV) if self.UV else np.zeros((0, 2))

    def merge(self, other, M=None, off=None):
        V = other.verts()
        if M is not None:
            V = V @ np.asarray(M).T
        if off is not None:
            V = V + np.asarray(off)
        self.V.append(V)
        self.F += [tuple(i + self.n for i in f) for f in other.F]
        self.T += other.T
        self.UV.append(other.uvs())
        self.n += len(V)


def rz(deg):
    a = math.radians(deg)
    return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1.0]])


def chamfer_rect(w, d, c):
    c = min(c, 0.45 * w, 0.45 * d)
    return np.array([(-w / 2 + c, -d / 2), (w / 2 - c, -d / 2), (w / 2, -d / 2 + c), (w / 2, d / 2 - c),
                     (w / 2 - c, d / 2), (-w / 2 + c, d / 2), (-w / 2, d / 2 - c), (-w / 2, -d / 2 + c)])


def prism(acc, poly, z0, z1, M=np.eye(3), off=(0, 0, 0), tag=0, bevel=0.0, top_jit=None, rng=None):
    """extrude a footprint polygon (k,2) from z0 to z1; top edge chamfered by `bevel`; optional jagged top."""
    poly = np.asarray(poly, float)
    k = len(poly)
    ctr = poly.mean(0)
    bot = np.column_stack([poly, np.full(k, z0)])
    top_z = np.full(k, z1)
    if top_jit is not None and rng is not None:
        top_z = top_z - rng.uniform(0, top_jit, k)
    mid = np.column_stack([poly, top_z - bevel])
    rings = [bot, mid]
    if bevel > 0:
        inset = ctr + (poly - ctr) * np.clip(1 - bevel / np.maximum(np.linalg.norm(poly - ctr, axis=1), 1e-3), 0.5, 1)[:, None]
        rings.append(np.column_stack([inset, top_z]))
    V = np.vstack(rings)
    F = [tuple(range(k - 1, -1, -1))]
    for r in range(len(rings) - 1):
        for i in range(k):
            j = (i + 1) % k
            F.append((r * k + i, r * k + j, (r + 1) * k + j, (r + 1) * k + i))
    F.append(tuple(range((len(rings) - 1) * k, len(rings) * k)))
    acc.add(V @ np.asarray(M).T + np.asarray(off), F, tag)


def box(acc, c, size, rot=0.0, tag=0, bevel=0.25, M=np.eye(3), top_jit=None, rng=None):
    w, d, h = size
    poly = chamfer_rect(w, d, bevel) @ rz(rot)[:2, :2].T
    prism(acc, poly, 0.0, h, M, np.asarray(M) @ np.asarray(c, float), tag, bevel, top_jit, rng)


def octa(r, n=8):
    a = np.linspace(0, 2 * math.pi, n, endpoint=False) + math.pi / n
    return np.stack([np.cos(a) * r, np.sin(a) * r], 1)


def sweep(acc, centers, frames, profile, tag=0, caps=True, jag=None, rng=None, uv_u=None):
    """sweep a 2D profile (k,2) given in each frame's (a,b) axes along a polyline of centres."""
    centers = np.asarray(centers, float)
    k = len(profile)
    n = len(centers)
    V = []
    UV = []
    for i in range(n):
        a_, b_ = frames[i]
        ring = centers[i] + profile[:, :1] * a_ + profile[:, 1:2] * b_
        if jag is not None and rng is not None and i in (0, n - 1):
            t = centers[min(i + 1, n - 1)] - centers[max(i - 1, 0)]
            t /= np.linalg.norm(t)
            ring = ring + t * rng.uniform(-jag, jag, (k, 1))
        V.append(ring)
        u = (uv_u[i] if uv_u is not None else i)
        UV.append(np.column_stack([np.full(k, u), profile[:, 0] / max(float(np.ptp(profile[:, 0])), 1e-6)]))
    V = np.vstack(V)
    F = []
    for i in range(n - 1):
        for j in range(k):
            jj = (j + 1) % k
            F.append((i * k + j, i * k + jj, (i + 1) * k + jj, (i + 1) * k + j))
    if caps:
        F.append(tuple(range(k - 1, -1, -1)))
        F.append(tuple(range((n - 1) * k, n * k)))
    acc.add(V, F, tag, np.vstack(UV))


# =================================================================== (1) megastructure on a landmass (local frame)
def megastructure(lm, ztop, th_cam, rng, light=False):
    """architecture in the landmass LOCAL frame (top plateau z~0).  tags: 0 masonry, 1 dark carved stone."""
    acc = Acc()
    R0 = lm["R"]
    ex, ey = lm["el"]
    sc = R0 / 36.0
    f = np.array((math.cos(th_cam), math.sin(th_cam), 0.0))          # toward the camera (horizontal, local)
    s = np.array((-f[1], f[0], 0.0))                                   # screen-right-ish
    M = np.column_stack([s, f, (0, 0, 1.0)])                          # (s, f, z) -> local
    rot_deg = math.degrees(math.atan2(s[1], s[0]))

    def P(x, y):              # architecture coords (s, f) -> local xy
        v = M @ np.array((x, y, 0.0))
        return v[0], v[1]

    def zt(x, y):
        lx, ly = P(x, y)
        return float(ztop(lx, ly))

    # --- foundation slab: two masonry tiers, jagged outline, front torn away (courses read in the break)
    for tier, (scale_, h_) in enumerate(((0.86, 4.2), (0.66, 3.2))):
        if light and tier == 1:
            break
        k = 22
        a = np.linspace(0, 2 * math.pi, k, endpoint=False)
        rad = scale_ * R0 * (1 + rng.uniform(-0.1, 0.1, k))
        poly = np.stack([np.cos(a) * rad * ex, np.sin(a) * rad * ey], 1)
        # bite out the front-right (the tear) -> broken courses facing the camera
        loc_front = np.array(P(0.25 * R0, 0.6 * R0))
        dd = np.linalg.norm(poly - loc_front, axis=1)
        poly = np.where((dd < 0.42 * R0)[:, None], poly * rng.uniform(0.55, 0.75), poly)
        z0 = -1.5 + tier * 4.2 * sc
        prism(acc, poly, z0, z0 + h_ * sc, tag=0, bevel=0.6 * sc, top_jit=0.8 * sc, rng=rng)
    base = (-1.5 + 7.4 * sc - 0.2) if not light else (-1.5 + 4.2 * sc - 0.2)    # top of the slab tiers
    # --- suspended colonnade along the camera-facing edge
    ncol = 4 if light else 7
    heights = [18, 18, 11, 18, 6.5, 18, 14][:ncol]
    xs = np.linspace(-0.55 * R0, 0.3 * R0, ncol)
    yc = 0.42 * R0
    standing = []
    for i, (x, hh) in enumerate(zip(xs, heights)):
        hh *= sc
        cx, cy = P(x, yc)
        box(acc, (cx, cy, base), (3.6 * sc, 3.6 * sc, 1.3 * sc), rot_deg, 1, 0.3 * sc)
        snapped = hh < 15 * sc
        prism(acc, octa(1.35 * sc), base + 1.3 * sc, base + 1.3 * sc + hh, off=(cx, cy, 0), tag=0,
              bevel=0.0, top_jit=(1.6 * sc if snapped else None), rng=rng)
        if not snapped:
            box(acc, (cx, cy, base + 1.3 * sc + hh), (3.9 * sc, 3.9 * sc, 1.5 * sc), rot_deg, 1, 0.35 * sc)
            standing.append((i, cx, cy, base + 2.8 * sc + hh))
        else:      # fallen drums at its foot
            for d in range(2):
                ox, oy = P(x + rng.uniform(-3, 3) * sc, yc + rng.uniform(2.5, 6) * sc)
                Mr = rz(rng.uniform(0, 180)) @ np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0.0]])
                prism(acc, octa(1.3 * sc), -2.2 * sc, 2.2 * sc, M=Mr, off=(ox, oy, base + 1.3 * sc), tag=0)
    for a_, b_ in zip(standing[:-1], standing[1:]):      # lintel fragments between adjacent standing columns
        if b_[0] - a_[0] == 1 and rng.random() < 0.85:
            cx, cy = (a_[1] + b_[1]) / 2, (a_[2] + b_[2]) / 2
            span = math.hypot(b_[1] - a_[1], b_[2] - a_[2]) + 3.5 * sc
            box(acc, (cx, cy, a_[3]), (span, 3.0 * sc, 2.6 * sc), rot_deg, 1, 0.35 * sc, top_jit=0.6 * sc, rng=rng)
    # --- roofless chamber (left-back) with an arched doorway in the camera-facing wall
    def chamber(x0, y0, w, d, h, door=True):
        t = 2.4 * sc
        z0 = base
        for (cx, cy, ww, dd_, hh) in ((x0, y0 - d / 2, w, t, h), (x0 - w / 2, y0, t, d, h * 0.85),
                                      (x0 + w / 2, y0, t, d, h * 0.7)):
            lx, ly = P(cx, cy)
            r_ = rot_deg if ww > dd_ else rot_deg
            box(acc, (lx, ly, z0), (ww, dd_, hh), r_, 0, 0.3 * sc, top_jit=0.3 * hh, rng=rng)
        # front wall with doorway: two piers + lintel arch
        fy = y0 + d / 2
        dw = 0.3 * w
        for sgn in (-1, 1):
            px = x0 + sgn * (dw / 2 + (w - dw) / 4)
            lx, ly = P(px, fy)
            box(acc, (lx, ly, z0), ((w - dw) / 2, t, h * rng.uniform(0.75, 1.0)), rot_deg, 0, 0.3 * sc,
                top_jit=0.2 * h, rng=rng)
        # arched head over the doorway
        r_ = dw / 2
        n = 9
        cen = []
        frames = []
        for i in range(n):
            a = math.pi * i / (n - 1)
            px, py = P(x0 - math.cos(a) * r_, fy)
            cen.append((px, py, z0 + 0.62 * h + math.sin(a) * r_))
            rad = M @ np.array((-math.cos(a), 0, 0)) + np.array((0, 0, math.sin(a)))
            frames.append((rad, M @ np.array((0, 1.0, 0))))
        sweep(acc, cen, frames, chamfer_rect(1.6 * sc, t, 0.3 * sc), tag=1)

    if not light:
        chamber(-0.35 * R0, -0.05 * R0, 20 * sc, 15 * sc, 13 * sc)
    else:
        chamber(-0.2 * R0, 0.0, 16 * sc, 12 * sc, 10 * sc)
    # --- barrel-vaulted hall exposed in section at the tear (front-right)
    if not light:
        hx, hy = 0.28 * R0, 0.18 * R0
        span = 15 * sc
        L_ = 22 * sc
        wall_h = 9 * sc
        for sgn in (-1, 1):
            lx, ly = P(hx + sgn * span / 2, hy)
            box(acc, (lx, ly, base), (2.4 * sc, L_, wall_h), rot_deg, 0, 0.3 * sc, top_jit=1.2 * sc, rng=rng)
        prof = []
        n = 12
        for i in range(n):          # half-ring shell section, swept along the hall
            a = math.pi * i / (n - 1)
            prof.append((-math.cos(a) * span / 2, math.sin(a) * span / 2))
        inner = [(x * 0.84, y * 0.84) for (x, y) in prof[::-1]]
        shell = np.array(prof + inner)
        cen, frames = [], []
        for t_ in np.linspace(-L_ / 2, L_ / 2 * 0.55, 4):        # front end torn short -> section exposed
            px, py = P(hx, hy + t_)
            cen.append((px, py, base + wall_h))
            frames.append((M @ np.array((1.0, 0, 0)), np.array((0, 0, 1.0))))
        sweep(acc, cen, frames, shell, tag=1, jag=1.5 * sc, rng=rng)
    # --- bridge reaching off the right edge; outer span snapped and hanging
    nb = 2 if light else 3
    bx0 = 0.62 * R0 * ex
    deck_z = base + 3.5 * sc
    seg = 13 * sc
    for i in range(nb):
        x = bx0 + (i + 0.5) * seg
        lx, ly = P(x, 0.15 * R0)
        if i < nb - 1:
            box(acc, (lx, ly, deck_z), (seg * 1.02, 6.5 * sc, 2.4 * sc), rot_deg, 0, 0.3 * sc)
            # arch under the deck
            r_ = seg * 0.42
            n = 9
            cen, frames = [], []
            for k in range(n):
                a = math.pi * k / (n - 1)
                px, py = P(x - math.cos(a) * r_, 0.15 * R0)
                cen.append((px, py, deck_z - r_ * 0.95 + math.sin(a) * r_ * 0.9))
                frames.append((M @ np.array((-math.cos(a), 0, 0)) + np.array((0, 0, math.sin(a))),
                               M @ np.array((0, 1.0, 0))))
            sweep(acc, cen, frames, chamfer_rect(1.8 * sc, 6.0 * sc, 0.3 * sc), tag=1)
            lx2, ly2 = P(x + seg / 2, 0.15 * R0)
            box(acc, (lx2, ly2, deck_z - 14 * sc), (2.6 * sc, 5.5 * sc, 14 * sc), rot_deg, 0, 0.3 * sc)
        else:      # snapped outer span hanging from the break
            ang = -math.radians(rng.uniform(32, 48))      # outer end drops
            hinge = np.array(P(x - seg / 2, 0.15 * R0) + (deck_z + 2.4 * sc,))
            Rh = np.array([[math.cos(ang), 0, -math.sin(ang)], [0, 1, 0], [math.sin(ang), 0, math.cos(ang)]])
            Rh = M @ Rh @ M.T
            sub = Acc()
            box(sub, (seg / 2, 0, -2.4 * sc), (seg, 6.5 * sc, 2.4 * sc), 0, 0, 0.3 * sc, top_jit=0.8 * sc, rng=rng)
            Ms = M @ np.eye(3)
            V = (sub.verts() @ Ms.T) @ Rh.T + hinge
            acc.add(V, sub.F, 0)
    # --- rubble
    for _ in range(int(8 if light else 16)):
        a = rng.uniform(0, 2 * math.pi)
        rr = R0 * 0.75 * math.sqrt(rng.random())
        lx, ly = rr * math.cos(a) * ex, rr * math.sin(a) * ey
        sz = rng.uniform(1.4, 3.6) * sc
        box(acc, (lx, ly, base - 0.5), (sz, sz * rng.uniform(0.5, 1), sz * rng.uniform(0.4, 0.8)),
            rng.uniform(0, 180), rng.integers(0, 2), 0.25 * sc)
    return acc


# =================================================================== (2) celestial mechanism
RINGS = [
    # radius (x disc R), width m, thickness m, tilt about screen-x / screen-y (deg), arcs: (a0, a1, kind)
    # kind: 'stone' carved / 'metal' bronze band with teeth.  0 deg = screen right, 90 = up.
    dict(key="Inner", rk=1.36, w=2.3, t=1.8, tilt=(10.0, -6.0),
         arcs=[(97, 128, "metal"), (133, 176, "stone"), (12, 38, "stone"), (43, 72, "metal")]),
    dict(key="Track", rk=1.68, w=3.0, t=2.2, tilt=(-6.0, 9.0),        # the ritual stream rides this one
         arcs=[(150, 201, "stone"), (104, 146, "metal"), (62, 98, "stone"), (24, 50, "metal")]),
    dict(key="Outer", rk=2.45, w=3.6, t=2.5, tilt=(5.0, -14.0),
         arcs=[(160, 189, "stone"), (128, 154, "metal"), (99, 121, "stone")]),
]
SPOKES = [  # angle, from rk, to rk, kind, broken fraction kept
    (165.0, 1.40, 1.62, "stone", 1.0), (118.0, 1.40, 1.60, "metal", 0.7), (176.0, 1.76, 2.38, "stone", 0.55),
    (58.0, 1.40, 1.62, "metal", 1.0),
]


def ring_frame(tilt):
    """ring plane frame (ex, ey, n) facing the hero camera, tilted."""
    E = L.ECL_C
    n = np.array(L.CAMS["hero"][0], float) - E
    n /= np.linalg.norm(n)
    ex = np.cross((0, 0, 1.0), n)
    ex /= np.linalg.norm(ex)
    ey = np.cross(n, ex)
    Rx = L.rotmat(ex, math.radians(tilt[0]))
    Ry = L.rotmat(ey, math.radians(tilt[1]))
    T = Ry @ Rx
    return T @ ex, T @ ey, T @ n


def metal_profile(w, t):
    return np.array([(-w / 2, -t / 2), (w / 2, -t / 2), (w / 2, t / 2), (0.28 * w, t / 2), (0.22 * w, t / 2 + 0.38),
                     (-0.22 * w, t / 2 + 0.38), (-0.28 * w, t / 2), (-w / 2, t / 2)])


def _longest_ok(ok):
    best, cur, bs = (0, 0), 0, 0
    for i, o in enumerate(ok):
        if o:
            if cur == 0:
                bs = i
            cur += 1
            if cur > best[1] - best[0]:
                best = (bs, i + 1)
        else:
            cur = 0
    return best


def mechanism(rng):
    """-> dict(rings=Acc (tags 0 stone, 1 metal), chunks=Acc, drift=Acc, info).  Every arc is trimmed to its longest
    run that clears the hero keep-clear (disc x1.22, measured hand rect, skull box)."""
    E = L.ECL_C
    Rd = L.ECL_R
    rings = Acc()
    drift = Acc()
    info = []
    for rg in RINGS:
        ex, ey, n = ring_frame(rg["tilt"])
        r = rg["rk"] * Rd
        for (a0, a1, kind) in rg["arcs"]:
            a0j, a1j = a0 + rng.uniform(-2, 2), a1 + rng.uniform(-2, 2)
            steps = max(3, int(abs(a1j - a0j) / 1.2))
            aa = np.radians(np.linspace(a0j, a1j, steps))
            rds = np.array([math.cos(a) * ex + math.sin(a) * ey for a in aa])
            test = np.vstack([E + (r - rg["w"] / 2 - 0.3) * rds, E + (r + rg["w"] / 2 + 0.9) * rds])
            bad = mechanism_keepclear(test).reshape(2, -1).any(0)
            i0, i1 = _longest_ok(~bad)
            if i1 - i0 < 3:
                info.append({"ring": rg["key"], "arc": [a0, a1], "kind": kind, "dropped": True})
                continue
            aa = aa[i0:i1]
            a0j, a1j = math.degrees(aa[0]), math.degrees(aa[-1])
            cen = [E + r * (math.cos(a) * ex + math.sin(a) * ey) for a in aa]
            frames = [(math.cos(a) * ex + math.sin(a) * ey, n) for a in aa]
            prof = chamfer_rect(rg["w"], rg["t"], 0.35) if kind == "stone" else metal_profile(rg["w"], rg["t"] * 0.7)
            sweep(rings, cen, frames, prof, tag=0 if kind == "stone" else 1, jag=0.9, rng=rng, uv_u=aa * r)
            if kind == "metal":       # gear-tooth notches on the outer edge
                for a in np.radians(np.arange(a0j + 1.2, a1j - 1.0, 2.6)):
                    rd = math.cos(a) * ex + math.sin(a) * ey
                    tg = -math.sin(a) * ex + math.cos(a) * ey
                    c = E + (r + rg["w"] / 2 + 0.45) * rd
                    V = np.array([c + sx * 0.5 * tg + sy * 0.45 * rd + sz * 0.42 * n
                                  for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
                    rings.add(V, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)], 1)
            info.append({"ring": rg["key"], "arc": [round(a0j, 1), round(a1j, 1)], "kind": kind})
            for end, sgn in ((a0j, -1), (a1j, 1)):        # drifting pieces off the broken ends
                for _ in range(int(rng.integers(1, 4))):
                    da = rng.uniform(2.0, 4.5) * sgn
                    aa2 = np.radians(np.linspace(end + da * 0.2, end + da, 3))
                    er = math.radians(end)
                    off = (rng.uniform(1.5, 6.0) * (math.cos(er) * ex + math.sin(er) * ey)
                           + np.array((0, 0, -rng.uniform(1.0, 7.0))))
                    cen = [E + r * (math.cos(a) * ex + math.sin(a) * ey) + off for a in aa2]
                    fr = [(math.cos(a) * ex + math.sin(a) * ey, n) for a in aa2]
                    sub = Acc()
                    sweep(sub, cen, fr, prof * rng.uniform(0.55, 0.85), tag=0 if kind == "stone" else 1, jag=0.5,
                          rng=rng)
                    c0 = sub.verts().mean(0)
                    Mr = L.rotmat(rng.normal(size=3), math.radians(rng.uniform(10, 40)))
                    Vd = (sub.verts() - c0) @ Mr.T + c0
                    if not mechanism_keepclear(Vd).any():
                        drift.add(Vd, sub.F, sub.T[0])
    ex, ey, n = ring_frame((0.0, 0.0))
    for (ang, r0, r1, kind, keep) in SPOKES:        # spokes / bridges between rings
        a = math.radians(ang)
        rd = math.cos(a) * ex + math.sin(a) * ey
        rr = np.linspace(r0 * Rd, (r0 + (r1 - r0) * keep) * Rd, 5)
        cen = np.array([E + x * rd for x in rr])
        if mechanism_keepclear(cen).any():
            continue
        tg = -math.sin(a) * ex + math.cos(a) * ey
        sweep(rings, cen, [(tg, n)] * len(cen), chamfer_rect(1.7, 1.5, 0.3), tag=0 if kind == "stone" else 1,
              jag=(0.8 if keep < 1 else None), rng=rng)
    chunks = Acc()      # suspended foundation blocks: the RECEIVER where the ritual stream arrives (lower-left)
    for (ang, rk, size) in ((195.0, 1.72, (5.5, 4.0, 4.6)), (186.0, 1.98, (3.0, 2.6, 2.4)), (36.0, 1.95, (4.2, 3.0, 3.4))):
        a = math.radians(ang)
        c = E + rk * Rd * (math.cos(a) * ex + math.sin(a) * ey)
        sub = Acc()
        for k in range(3):
            box(sub, (0, 0, -size[2] / 2 + k * size[2] / 3), (size[0] * (1 - 0.12 * k), size[1] * (1 - 0.1 * k),
                                                              size[2] / 3 * 0.96), 0, 0, 0.25, top_jit=0.3, rng=rng)
        Mr = L.rotmat(rng.normal(size=3), math.radians(rng.uniform(8, 22)))
        Vc = sub.verts() @ Mr.T + c
        if not mechanism_keepclear(Vc).any():
            chunks.add(Vc, sub.F, 0)
        else:
            info.append({"chunk": ang, "dropped": True})
    return dict(rings=rings, drift=drift, chunks=chunks, info=info)


def mechanism_keepclear(V, margin=0.012):
    """vertex mask that violates the hero keep-clear (disc x1.22, measured hand rect, skull box)."""
    bad = L.bad_points("hero", V, None, ecl_k=1.22, margin=margin, keys=("board", "skull"))
    U, Vv, _ = L.project("hero", V)
    u0, v0, u1, v1 = L.HERO_HAND_SCREEN
    bad |= (U > u0 - margin) & (U < u1 + margin) & (Vv > v0 - margin) & (Vv < v1 + margin)
    return bad
