"""CFCL_Terrain_Ribs - kit of 7 unique columnar-basalt 'ribs' (petrified ribcage of the fallen colossus).

Each rib = a jittered 5-7 sided basalt polygon swept along a bent centreline:
  * drums separated by cross-joint grooves every 1.5-4 m, small offsets/twists/scale steps between drums
  * chipped drum corners, erosion notches (upward shelves where moss collects)
  * non-linear taper, flared root sunk 1-2 m, rubble of broken column drums + shards around the root
  * fractured (oblique, jagged) tips; 2 variants keep an irregular sharp point; 1 snapped (upper piece lying)
Origin = root centre at ground contact (Z=0); rib bends toward local +X ("inward").

Run:  python lib/run_blender.py scripts/terrain_ribs.py -- --iter 1 [--norender]
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, bmesh, S, M, R, F32

ASSET = "CFCL_Terrain_Ribs"
args = T.get_args()
ITER = int(args.get("iter", 1))
OUT = os.path.join(T.RENDERS, "ribs")
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------------------------------------
def poly_corners(rng, n, fmin=0.84, fmax=1.07, jit=0.32):
    step = 2 * np.pi / n
    a = step * np.arange(n) + rng.uniform(-jit, jit, n) * step * 0.5
    f = rng.uniform(fmin, fmax, n)
    return a, f


def poly_points(a, f, m, rng, sj=(-0.015, 0.022)):
    n = len(a)
    C = np.stack([np.cos(a) * f, np.sin(a) * f], 1)
    pts = []
    for k in range(n):
        p0, p1 = C[k], C[(k + 1) % n]
        d = p1 - p0
        nr = np.array([d[1], -d[0]])
        nr /= np.linalg.norm(nr)
        for t in range(m):
            u = t / m
            p = p0 * (1 - u) + p1 * u
            if t:
                p = p + nr * rng.uniform(*sj)
            pts.append(p)
    return np.array(pts, F32)


def polygon(rng, n, m, fmin=0.84, fmax=1.07, jit=0.32):
    a, f = poly_corners(rng, n, fmin, fmax, jit)
    return poly_points(a, f, m, rng)


def planar_cut(q, phi, depth):
    """Clamp polygon points onto a plane (erosion / cleavage facet). depth = fraction of max projection."""
    if depth <= 0:
        return q
    v = np.array([math.cos(phi), math.sin(phi)], F32)
    pr = q @ v
    h = pr.max() * (1.0 - depth)
    q = q.copy()
    msk = pr > h
    q[msk] -= (pr[msk] - h)[:, None] * v[None, :]
    return q


class Rib:
    """One basalt rib. P = parameter dict, seed -> deterministic."""

    def __init__(self, P, seed):
        self.P = P
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        rng = self.rng
        self.L = L = P["L"]
        self.bury = bury = P.get("bury", 1.5)
        self.n, self.m = P["n"], P.get("m", 3)
        self.K = self.n * self.m
        self._make_joints()
        # ---- centreline (smooth bend + small kinks at the cross-joints: dislocated drums)
        ds = 0.05
        s = np.arange(-bury, L + 6.0, ds)
        u = np.clip(s / L, 0, 1)
        kth = np.zeros_like(s)
        kps = np.zeros_like(s)
        for sj in self.joints:
            kth[s > sj] += rng.uniform(-1, 1) * P.get("kink", 1.6)
            kps[s > sj] += rng.uniform(-1, 1) * P.get("kink", 1.6) * 0.6
        scurve = -P.get("scurve", 0.0) * np.clip((u - 0.62) / 0.38, 0, 1) ** 1.4   # counter-curve, last third
        th = np.radians(P["th0"] + (P["th1"] - P["th0"]) * u ** P.get("bp", 1.5)
                        + P.get("wob", 0.0) * np.sin(np.pi * u * P.get("wobk", 1.0)) + kth + scurve)
        psi = P.get("lat", 0.0) * np.sin(2 * np.pi * P.get("latf", 0.6) * u + P.get("latph", 0.0))             + np.radians(kps)
        Tg = np.stack([np.sin(th) * np.cos(psi), np.sin(psi), np.cos(th) * np.cos(psi)], 1)
        pos = np.cumsum(Tg * ds, 0)
        i0 = int(np.argmin(np.abs(s)))
        pos -= pos[i0]
        N = np.cross(np.array([0.0, 1.0, 0.0]), Tg)
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        B = np.cross(Tg, N)
        self._s, self._pos, self._T, self._N, self._B = s, pos, Tg, N, B
        # ---- section polygon (+ 1-3 longitudinal grooves along side middles)
        self.ca, self.cf = poly_corners(rng, self.n, P.get("fmin", 0.84), P.get("fmax", 1.07))
        self.poly = poly_points(self.ca, self.cf, self.m, rng)
        ng = P.get("grooves", 1)
        self.grooves = [(int(k), rng.uniform(0.07, 0.12)) for k in rng.choice(self.n, ng, replace=False)]
        # ---- drums
        self._make_drums()

    # --------------------------------------------------------------- curve queries
    def frame(self, s):
        s = float(s)
        out = []
        for arr in (self._pos, self._T, self._N, self._B):
            out.append(np.array([np.interp(s, self._s, arr[:, k]) for k in range(3)]))
        C, Tg, N, B = out
        Tg /= np.linalg.norm(Tg)
        N -= Tg * (N @ Tg)
        N /= np.linalg.norm(N)
        B = np.cross(Tg, N)
        return C, Tg, N, B

    def radius(self, s):
        P = self.P
        u = min(max(s / self.L, 0.0), 1.0)
        r = P["R0"] * (1.0 - (1.0 - P["rt"]) * u ** P.get("tp", 1.5))
        r *= 1.0 + P.get("fl", 0.45) * math.exp(-max(s, 0.0) / (P.get("fw", 0.9) * P["R0"]))
        ca, cs, cw = P.get("cond", (0.14, 0.55, 0.45))           # condyle-like swelling above the flare
        r *= 1.0 + ca * math.exp(-((s - cs * P["R0"]) / (cw * P["R0"])) ** 2)
        if s < 0:
            r *= 1.0 + 0.12 * (-s / max(self.bury, 1e-3))
        return r

    # --------------------------------------------------------------- drums / joints
    def _make_joints(self):
        P, rng = self.P, self.rng
        L = self.L
        tip_len = P.get("tip_len", 0.0) if P.get("tip") == "sharp" else 0.0
        joints = []
        D0 = 2.0 * P["R0"]
        jlo, jhi = P.get("jd", (0.55, 1.3))
        sj = rng.uniform(0.9, 1.5) * D0
        while sj < L - max(0.6 * D0, tip_len * 0.75):
            joints.append(sj)
            sj += rng.uniform(jlo, jhi) * D0
        self.joints = joints

    def _make_drums(self):
        P, rng = self.P, self.rng
        L = self.L
        joints = self.joints
        edges = [-self.bury] + joints + [L]
        n, m, K = self.n, self.m, self.K
        self.drums = []
        twist = math.radians(P.get("twist", 40.0))
        tilts = [np.zeros(2)]
        for _ in joints:
            a = rng.uniform(0, 2 * np.pi)
            t = math.tan(math.radians(rng.uniform(0.0, P.get("jtilt", 7.0))))
            tilts.append(np.array([math.cos(a), math.sin(a)]) * t)
        tilts.append(np.zeros(2))
        for i in range(len(edges) - 1):
            sb, st = edges[i], edges[i + 1]
            smid = 0.5 * (sb + st)
            cf = 1.0 + rng.uniform(-0.035, 0.035, n)       # per-corner drift
            w = np.zeros(K)
            for k in range(n):
                for t in range(m):
                    w[k * m + t] = cf[k] * (1 - t / m) + cf[(k + 1) % n] * (t / m)
            qd = poly_points(self.ca + rng.normal(0, 0.04, n), self.cf * (1 + rng.normal(0, 0.035, n)), m, rng)
            for gk, gd in self.grooves:
                qd[(gk * m + m // 2) % K] *= (1.0 - gd)
            d = dict(sb=sb, st=st,
                     tw=twist * max(smid, 0) / L + rng.normal(0, 0.03),
                     sig=1.0 + rng.uniform(-0.035, 0.03),
                     off=rng.normal(0, 0.03, 2) * (2.2 if rng.random() < 0.15 else 1.0),
                     q=qd,
                     tb=tilts[i], tt=tilts[i + 1],
                     chips_b=[], chips_t=[], notch=None, scar=None, crack=None)
            if i > 0 and rng.random() < P.get("pchip", 0.55):
                d["chips_b"].append((int(rng.integers(n)), rng.uniform(0.12, 0.3)))
            for _ in range(int(rng.random() < P.get("pchip", 0.55)) + int(rng.random() < 0.3)):
                d["chips_t"].append((int(rng.integers(n)), rng.uniform(0.12, 0.32)))
            if (st - sb) > 1.6 and sb > 0.5 and rng.random() < P.get("pnotch", 0.28):
                d["notch"] = (int(rng.integers(n)), int(rng.integers(1, 3)), rng.uniform(0.12, 0.26),
                              rng.uniform(0.3, 0.6))
            if sb > 0 and rng.random() < P.get("pscar", 0.3):      # broad spall scar along the drum
                d["scar"] = (int(rng.integers(n)), int(rng.integers(1, 3)), rng.uniform(0.12, 0.24), 0)
            if rng.random() < P.get("pcrack", 0.3):                 # vertical split along one corner
                d["crack"] = (int(rng.integers(n)), rng.uniform(0.08, 0.16))
            self.drums.append(d)
        # large erosion/cleavage planes: oblique facets spanning 1-3 drums, ending in a step at a joint
        self.planes = []
        if joints:
            for _ in range(int(P.get("nplanes", max(1, round(L / (6 * P["R0"])))))):
                j = int(rng.integers(len(joints)))
                s1 = joints[j]
                s0 = max(0.3, s1 - rng.uniform(1.0, 3.0) * 2 * P["R0"])
                self.planes.append(dict(s0=s0, s1=s1 - 0.001, phi=rng.uniform(0, 2 * np.pi),
                                        d0=rng.uniform(0.0, 0.05), d1=rng.uniform(0.14, 0.3)))

    def drum_at(self, s):
        for d in self.drums:
            if s <= d["st"] + 1e-6:
                return d
        return self.drums[-1]

    def _apply_chips(self, q, chips):
        q = q.copy()
        m, K = self.m, self.K
        for k, dep in chips:
            j = k * m
            for dj, wgt in ((0, 1.0), (1, 0.45), (-1, 0.45), (2, 0.12), (-2, 0.12)):
                q[(j + dj) % K] *= (1.0 - dep * wgt)
        return q

    def _apply_notch(self, q, notch):
        k0, span, dep, _ = notch
        q = q.copy()
        m, K = self.m, self.K
        j0, j1 = k0 * m, (k0 + span) * m
        for j in range(j0, j1 + 1):
            wgt = 0.6 if j in (j0, j1) else 1.0
            q[j % K] *= (1.0 - dep * wgt)
        return q

    def master_rings(self):
        """List of ring dicts (s, q, sig, off, tw, tilt) covering the whole rib."""
        rings = []
        P = self.P
        nd = len(self.drums)
        for i, d in enumerate(self.drums):
            sb, st = d["sb"], d["st"]
            g = float(np.clip(0.035 * self.radius(st), 0.008, 0.022))
            sb_r = sb + (g * 0.5 if i > 0 else 0.0)
            st_r = st - (g * 0.5 if i < nd - 1 else 0.0)
            ln = st_r - sb_r
            c = min(0.38, 0.2 * ln, 0.3 * self.radius(sb))
            ss = [sb_r, sb_r + c]
            nm = max(0, int(math.ceil((ln - 2 * c) / max(0.6, 1.4 * self.radius(sb)))) - 1)
            for k in range(nm):
                ss.append(sb_r + c + (ln - 2 * c) * (k + 1) / (nm + 1))
            ss += [st_r - c, st_r]
            notch = d["notch"]
            s_a = sb_r + notch[3] * ln if notch else None
            for idx, sv in enumerate(ss):
                q = d["q"]
                for pl in self.planes:
                    if pl["s0"] <= sv <= pl["s1"]:
                        t = (sv - pl["s0"]) / max(pl["s1"] - pl["s0"], 1e-3)
                        q = planar_cut(q, pl["phi"], pl["d0"] + (pl["d1"] - pl["d0"]) * t)
                endw = 0.35 if idx in (0, len(ss) - 1) else 1.0
                if d["scar"]:
                    k0, span, dep, _ = d["scar"]
                    q = self._apply_notch(q, (k0, span, dep * endw, 0))
                if d["crack"]:
                    kc, dep = d["crack"]
                    q = q.copy()
                    q[(kc * self.m) % self.K] *= 1.0 - dep * endw
                if idx == 0:
                    q = self._apply_chips(q, d["chips_b"])
                if idx == 1:
                    q = self._apply_chips(q, [(k, dp * 0.45) for k, dp in d["chips_b"]])
                if idx == len(ss) - 2:
                    q = self._apply_chips(q, [(k, dp * 0.45) for k, dp in d["chips_t"]])
                if idx == len(ss) - 1:
                    q = self._apply_chips(q, d["chips_t"])
                if notch and s_a is not None and sv >= s_a:
                    if not any(abs(r["s"] - s_a) < 1e-6 for r in rings):
                        # shelf: full ring then notched ring at the same s
                        rings.append(self._ring(s_a, d["q"], d, lerp=(s_a - sb) / max(st - sb, 1e-3)))
                        rings.append(self._ring(s_a, self._apply_notch(d["q"], notch), d,
                                                lerp=(s_a - sb) / max(st - sb, 1e-3)))
                    q = self._apply_notch(q, notch)
                rings.append(self._ring(sv, q, d, lerp=(sv - sb) / max(st - sb, 1e-3)))
            if i < nd - 1:
                dn = self.drums[i + 1]
                inset = self.rng.uniform(0.95, 0.972)
                qa = 0.5 * (d["q"] + dn["q"]) * inset
                rings.append(dict(s=st, q=qa, sig=0.5 * (d["sig"] + dn["sig"]), off=0.5 * (d["off"] + dn["off"]),
                                  tw=0.5 * (d["tw"] + dn["tw"]), tilt=d["tt"], dz=None))
        rings.sort(key=lambda r: r["s"])
        return rings

    def _ring(self, s, q, d, lerp=0.0, dz=None):
        lerp = min(max(lerp, 0.0), 1.0)
        return dict(s=s, q=q, sig=d["sig"], off=d["off"], tw=d["tw"], tilt=d["tb"] * (1 - lerp) + d["tt"] * lerp,
                    dz=dz)

    # --------------------------------------------------------------- geometry emit
    def ring_points(self, rg, rscale=1.0, extra_off=None):
        C, Tg, N, B = self.frame(rg["s"])
        r = self.radius(rg["s"]) * rscale
        c, sn = math.cos(rg["tw"]), math.sin(rg["tw"])
        xy = rg["q"] * rg["sig"] * r
        xy = np.stack([xy[:, 0] * c - xy[:, 1] * sn, xy[:, 0] * sn + xy[:, 1] * c], 1)
        fl = self.P.get("flat", 1.4) ** 0.5            # wide face toward the altar (local +X)
        xy = xy * np.array([1.0 / fl, fl])
        xy = xy + rg["off"] * r
        if extra_off is not None:
            xy = xy + extra_off
        dz = xy @ rg["tilt"]
        if rg.get("dz") is not None:
            dz = dz + rg["dz"]
        pts = C[None, :] + N[None, :] * xy[:, :1] + B[None, :] * xy[:, 1:2] + Tg[None, :] * dz[:, None]
        rad = N[None, :] * xy[:, :1] + B[None, :] * xy[:, 1:2]
        rad /= np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-6)
        return pts, rad, r

    def fracture_dz(self, r, xy_unit, tilt_deg, jag, sign=1.0):
        """Oblique jagged fracture: per-point offset along the axis."""
        rng = self.rng
        a = rng.uniform(0, 2 * np.pi)
        dvec = np.array([math.cos(a), math.sin(a)])
        t = math.tan(math.radians(tilt_deg))
        K = len(xy_unit)
        j = np.arange(K) / K
        jagv = (np.sin(2 * np.pi * j + rng.uniform(0, 6.3)) * 0.5
                + np.sin(2 * np.pi * 3 * j + rng.uniform(0, 6.3)) * 0.35
                + np.sin(2 * np.pi * 7 * j + rng.uniform(0, 6.3)) * 0.18)
        spikes = np.zeros(K)
        for _ in range(int(rng.integers(1, 4))):
            c = int(rng.integers(K))
            h = rng.uniform(0.25, 0.6)
            for dj, wgt in ((0, 1.0), (1, 0.55), (-1, 0.55), (2, 0.2), (-2, 0.2)):
                spikes[(c + dj) % K] = max(spikes[(c + dj) % K], h * wgt)
        dz = t * (xy_unit @ dvec) * r + jag * r * (jagv * 0.5 + spikes)
        return sign * dz, dvec, t

    def build(self, s0, s1, bottom="flat", top="broken", noise_amp=0.035, noise_freq=None):
        """Emit verts/faces for the rib between s0 and s1."""
        P, rng = self.P, self.rng
        K = self.K
        rings = [rg for rg in self.master_rings()]
        verts, rads, rrs, ring_idx = [], [], [], []
        faces = []

        def emit(rg, rscale=1.0, extra=None):
            p, rd, r = self.ring_points(rg, rscale, extra)
            ring_idx.append(sum(len(v) for v in verts))
            verts.append(p)
            rads.append(rd)
            rrs.append(np.full(len(p), r))
            return p

        # ---- bottom end
        r0 = self.radius(s0)
        d0 = self.drum_at(s0)
        if bottom == "broken":
            fdz, _, t0 = self.fracture_dz(r0, d0["q"], P.get("ftilt_b", 25), P.get("fjag", 0.22), sign=-1.0)
            pre_b = float(np.max(-fdz)) * 0.0 + float(np.max(fdz.clip(0))) + 0.3
            bot_ring = self._ring(s0, d0["q"], d0, dz=fdz)
            lo = s0 + max(pre_b, 0.3)
        else:
            bot_ring = self._ring(s0, d0["q"], d0)
            lo = s0 + 0.25
        # ---- top end
        tip_rings = []
        if top == "broken":
            r1 = self.radius(s1)
            d1 = self.drum_at(s1)
            fdz, _, _ = self.fracture_dz(r1, d1["q"], P.get("ftilt", 30), P.get("fjag", 0.22))
            hi = s1 + min(float(np.min(fdz)), 0.0) - 0.3
            top_ring = self._ring(s1, d1["q"], d1, dz=fdz)
        else:  # sharp but irregular: broken shoulder, then an off-centre spalled spike
            tl = P.get("tip_len", 3.0)
            hi = s1 - tl
            top_ring = None
            d1 = self.drum_at(s1)
            a_ap = rng.uniform(0, 2 * np.pi)
            apex = np.array([math.cos(a_ap), math.sin(a_ap)]) * 0.45
            nsteps = max(5, int(tl / 0.4))
            spall_k = int(np.argmax(self.poly[::self.m] @ -apex))   # spall on the side opposite the apex lean
            sh = rng.uniform(0.25, 0.4)                               # shoulder position along tip
            for k in range(0, nsteps + 1):
                v = k / (nsteps + 1)
                sv = hi + tl * v
                w = 1.0 if v < sh else 0.7 * (0.18 + 0.82 * ((1 - v) / (1 - sh)) ** 0.8)
                q = d1["q"]
                if v >= sh:
                    q = self._apply_notch(q, (spall_k, 2, 0.45 * (v - sh) / (1 - sh), 0))
                rg = self._ring(sv, q, d1)
                rg["_w"] = w
                rg["_apex"] = apex * (0.0 if v < sh else 0.25 + 0.75 * (v - sh) / (1 - sh))
                tip_rings.append(rg)
                if k > 0 and v >= sh and tip_rings[-2]["_w"] == 1.0:
                    # shoulder ledge: insert a ring at the same s with the full radius before the step
                    full = self._ring(sv, d1["q"], d1)
                    full["_w"] = 1.0
                    full["_apex"] = apex * 0.0
                    tip_rings.insert(len(tip_rings) - 1, full)
        mid = [rg for rg in rings if lo < rg["s"] < hi]
        # ---- emit ring stack
        emit(bot_ring)
        for rg in mid:
            emit(rg)
        if top == "broken":
            emit(top_ring)
        else:
            for rg in tip_rings:
                r_here = self.radius(rg["s"])
                emit(rg, rscale=rg["_w"], extra=rg["_apex"] * r_here)
        nr = len(verts)
        for i in range(nr - 1):
            a, b = ring_idx[i], ring_idx[i + 1]
            for j in range(K):
                faces.append([a + j, a + (j + 1) % K, b + (j + 1) % K, b + j])
        V = np.concatenate(verts, 0)
        RD = np.concatenate(rads, 0)
        RR = np.concatenate(rrs, 0)
        nV = len(V)
        extra_v, extra_rd, extra_rr = [], [], []

        def cap(ring_i, sign, jag_scale):
            """Jagged fracture cap on ring ring_i; sign=+1 top, -1 bottom."""
            nonlocal nV
            a = ring_idx[ring_i]
            ring = V[a:a + K]
            C = ring.mean(0)
            s_here = s1 if sign > 0 else s0
            _, Tg, _, _ = self.frame(s_here)
            inner = C + (ring - C) * rng.uniform(0.42, 0.58)
            hj = rng.uniform(-0.12, 0.22, K) * self.radius(s_here) * jag_scale
            inner = inner + Tg[None, :] * (sign * hj[:, None])
            ctr = C + Tg * sign * rng.uniform(-0.05, 0.28) * self.radius(s_here) * jag_scale \
                + rng.normal(0, 0.12, 3) * self.radius(s_here) * 0.5
            bi = nV
            ci = nV + K
            extra_v.append(inner)
            extra_v.append(ctr[None, :])
            extra_rd.append(np.zeros((K + 1, 3)))
            extra_rr.append(np.full(K + 1, self.radius(s_here)))
            nV += K + 1
            for j in range(K):
                f = [a + j, a + (j + 1) % K, bi + (j + 1) % K, bi + j]
                t = [bi + j, bi + (j + 1) % K, ci]
                if sign < 0:
                    f, t = f[::-1], t[::-1]
                faces.append(f)
                faces.append(t)

        if bottom == "broken":
            cap(0, -1.0, 1.0)
        else:
            a = ring_idx[0]
            faces.append(list(range(a + K - 1, a - 1, -1)))
        if top == "broken":
            cap(nr - 1, 1.0, 1.0)
        else:
            a = ring_idx[nr - 1]
            C, Tg, _, _ = self.frame(s1)
            last = V[a:a + K]
            apex_pt = last.mean(0) + Tg * self.P.get("tip_len", 3.0) / (max(5, int(self.P.get("tip_len", 3.0) / 0.4)) + 1) * 1.4
            extra_v.append(apex_pt[None, :])
            extra_rd.append(np.zeros((1, 3)))
            extra_rr.append(np.full(1, 0.1))
            ai = nV
            nV += 1
            for j in range(K):
                faces.append([a + j, a + (j + 1) % K, ai])
        if extra_v:
            V = np.concatenate([V] + extra_v, 0)
            RD = np.concatenate([RD] + extra_rd, 0)
            RR = np.concatenate([RR] + extra_rr, 0)
        # ---- low-frequency surface undulation (radial)
        if noise_freq is None:
            noise_freq = 0.22 / self.P["R0"]
        if noise_amp > 0:
            n1 = S.fbm(V.astype(F32) * F32(noise_freq), 1.0, 3, seed=self.seed % 97)
            V = V + RD * (n1 * noise_amp * RR)[:, None]
        return V.astype(F32), faces


# ---------------------------------------------------------------------------------------------
def fragment(rng, r, length, n=None, seed=0):
    """Broken basalt column drum (both ends fractured), local Z axis, base at z=0."""
    tmax = math.degrees(math.atan(0.2 * length / r))
    P = dict(L=length, R0=r, rt=rng.uniform(0.85, 0.98), tp=1.0, n=n or int(rng.integers(5, 8)), m=2,
             th0=0.0, th1=rng.uniform(-4, 4), bury=0.0, fl=0.0, twist=rng.uniform(-10, 10),
             jd=(0.6, 1.1), cond=(0.0, 0.5, 0.5), flat=1.0, grooves=1, pnotch=0.0, pchip=0.6,
             ftilt=min(rng.uniform(8, 30), tmax), ftilt_b=min(rng.uniform(8, 30), tmax),
             fjag=min(0.18, 0.12 * length / r))
    rb = Rib(P, seed)
    return rb.build(0.0, length, bottom="broken", top="broken", noise_amp=0.03)


def block_chunk(rng, size, dims=None, ncut=None):
    """Angular fractured block: a box cleaved by 2-5 random planes (crisp planar faces, no blobs)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = dims if dims else (size * rng.uniform(0.75, 1.0), size * rng.uniform(0.45, 0.85),
                                    size * rng.uniform(0.28, 0.6))
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    for _ in range(int(ncut if ncut is not None else rng.integers(2, 6))):
        no = rng.normal(size=3)
        no /= np.linalg.norm(no)
        h = 0.5 * (abs(no[0]) * sx + abs(no[1]) * sy + abs(no[2]) * sz)
        co = no * h * rng.uniform(0.4, 0.82)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co.tolist(), plane_no=no.tolist(),
                                     clear_outer=True)
        edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bm.verts.index_update()
    V = np.array([v.co[:] for v in bm.verts], F32)
    Fc = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return V, Fc


def place(V, R3, t):
    return (V @ R3.T + np.asarray(t, F32)).astype(F32)


def root_rubble(acc, rng, R0, seed, count=7, lean_against=3):
    """Pile of broken column drums + angular shards half-burying the flared root.
    Pieces near the root sit higher (piled against it), further ones sink into the ground."""
    mound = 0.7 * R0

    def lift(dist):
        return mound * max(0.0, 1.0 - (dist - 1.0 * R0) / (2.2 * R0))

    for i in range(count):
        big = i < 3
        r = rng.uniform(0.42, 0.66) * R0 if big else rng.uniform(0.2, 0.45) * R0
        ln = rng.uniform(1.4, 3.2) * r if big else rng.uniform(0.9, 2.4) * r
        V, Fc = fragment(rng, r, ln, seed=seed * 31 + i)
        V = V - np.array([0, 0, ln * 0.5], F32)
        ang = rng.uniform(0, 2 * np.pi)
        if i < lean_against:
            tilt = rng.uniform(28, 50)
            dist = R0 * rng.uniform(1.0, 1.25) + ln * 0.3
            R3 = T.rot3(0, 0, math.degrees(ang) + 180) @ T.rot3(0, tilt, 0)
        else:
            dist = rng.uniform(1.15, 2.7) * R0
            R3 = T.rot3(rng.uniform(70, 105), rng.uniform(-25, 25), math.degrees(ang) + rng.uniform(-60, 60))
        V = place(V, R3, (math.cos(ang) * dist, math.sin(ang) * dist, 0))
        V[:, 2] += -V[:, 2].min() - rng.uniform(0.2, 0.45) * r + lift(dist) * 0.7
        acc.add(V, Fc)
    for i in range(count * 3 + 6):
        sz = rng.uniform(0.25, 0.9) * R0 * (1.0 if i % 3 else 1.5)
        V, Fc = block_chunk(rng, sz)
        ang = rng.uniform(0, 2 * np.pi)
        dist = (rng.uniform(0.9, 2.0) if i % 2 else rng.uniform(1.6, 3.4)) * R0
        V = place(V, T.rot3(rng.uniform(-35, 35), rng.uniform(-35, 35), rng.uniform(0, 360)),
                  (math.cos(ang) * dist, math.sin(ang) * dist, 0))
        V[:, 2] += -V[:, 2].min() - rng.uniform(0.15, 0.35) * sz + lift(dist)
        acc.add(V, Fc)


# ---------------------------------------------------------------------------------------------
def link_local(a=0.17, b=0.10, r=0.04, nu=10, nv=5):
    """One stadium-ish chain link in local XY (long axis X); returns verts (nu*nv,3), quad faces."""
    V = []
    for i in range(nu):
        u = 2 * np.pi * i / nu
        c = np.array([a * math.cos(u), b * math.sin(u), 0.0])
        t = np.array([-a * math.sin(u), b * math.cos(u), 0.0])
        t /= np.linalg.norm(t)
        n = np.cross(t, [0, 0, 1.0])
        for j in range(nv):
            v = 2 * np.pi * j / nv
            V.append(c + r * (math.cos(v) * n + math.sin(v) * np.array([0, 0, 1.0])))
    F = [[i * nv + j, i * nv + (j + 1) % nv, ((i + 1) % nu) * nv + (j + 1) % nv, ((i + 1) % nu) * nv + j]
         for i in range(nu) for j in range(nv)]
    return np.array(V, F32), F


def chain_along(acc, path, scale=1.0):
    """Heavy chain following a dense polyline: links every ~1.45 a, alternating 90 deg roll."""
    a, b, r = 0.17 * scale, 0.10 * scale, 0.04 * scale
    LV, LF = link_local(a, b, r)
    path = np.asarray(path, float)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    step = 1.45 * a
    k = 0
    for d in np.arange(0, cum[-1], step):
        i = min(int(np.searchsorted(cum, d, side="right")) - 1, len(seg) - 1)
        t = (d - cum[i]) / max(seg[i], 1e-6)
        p = path[i] + (path[i + 1] - path[i]) * t
        X = (path[i + 1] - path[i]) / max(seg[i], 1e-6)
        up = np.array([0, 0, 1.0]) if abs(X[2]) < 0.9 else np.array([1.0, 0, 0])
        Z = up - X * (up @ X)
        Z /= np.linalg.norm(Z)
        Y = np.cross(Z, X)
        if k % 2:
            Y, Z = Z, -Y
        Rm = np.stack([X, Y, Z], 1)
        acc.add((LV @ Rm.T + p).astype(F32), LF)
        k += 1
    return k


def catenary(p0, p1, sag, n=40):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    t = np.linspace(0, 1, n)[:, None]
    return p0 + (p1 - p0) * t - np.array([0, 0, 1.0]) * sag * 4 * t * (1 - t)


def rib_wrap_point(rib, s, phi, pad=0.06):
    C, Tg, N, B = rib.frame(s)
    r = rib.radius(s)
    fl = rib.P.get("flat", 1.4) ** 0.5
    return C + N * math.cos(phi) * (r / fl * 1.12 + pad) + B * math.sin(phi) * (r * fl * 1.12 + pad)


def collar_mesh(rib, s_c, height=0.55, nth=64, nv=9, gap=(0.0, 1.2), seed=0):
    """Broken carved masonry collar around the rib: lozenge chain with chevron infill (board/dais vocabulary)."""
    rng = np.random.default_rng(seed)
    fl = rib.P.get("flat", 1.4) ** 0.5
    g0 = rng.uniform(0, 2 * np.pi)
    ths = [g0 + gap[1] + (2 * np.pi - gap[1]) * i / (nth - 1) for i in range(nth)]   # open arc (missing piece)
    V = []
    rows = []
    for layer, (rad_k, inset) in enumerate(((1.16, 1.0), (1.0, 0.0))):   # outer carved face, inner face
        for jv in range(nv):
            v = jv / (nv - 1)
            s = s_c + (v - 0.5) * height
            C, Tg, N, B = rib.frame(s)
            r = rib.radius(s)
            row = []
            for th in ths:
                rr = rad_k
                if layer == 0:
                    u = ((th - g0) * 4 / (2 * np.pi)) % 1.0           # 4 lozenges round the band
                    du, dv = abs(u - 0.5) * 2, abs(v - 0.5) * 2
                    groove = abs(du + dv - 1.0) < 0.22                # lozenge outline
                    chev = (dv < 0.5) and (abs(((u * 2) % 1.0) - 0.5) * 2 - dv * 1.6) < 0.12 and du < 0.55
                    rim = v < 0.1 or v > 0.9
                    rr = rad_k + (0.05 if rim else 0.0) - (0.075 if (groove or chev) and not rim else 0.0)
                row.append(len(V))
                V.append(C + N * math.cos(th) * r / fl * rr + B * math.sin(th) * r * fl * rr)
            rows.append(row)
    F = []
    for layer in range(2):
        for jv in range(nv - 1):
            a_, b_ = rows[layer * nv + jv], rows[layer * nv + jv + 1]
            for i in range(nth - 1):
                f = [a_[i], a_[i + 1], b_[i + 1], b_[i]]
                F.append(f if layer == 0 else f[::-1])
    o0, o1, i0, i1 = rows[0], rows[nv - 1], rows[nv], rows[2 * nv - 1]
    for i in range(nth - 1):                                          # top / bottom annuli
        F.append([o1[i], o1[i + 1], i1[i + 1], i1[i]])
        F.append([o0[i + 1], o0[i], i0[i], i0[i + 1]])
    for e in (0, nth - 1):                                            # broken ends of the arc
        F.append([rows[0][e], rows[nv - 1][e], rows[2 * nv - 1][e], rows[nv][e]])
    return np.array(V, F32), F


def join_into(main, others):
    others = [o for o in others if o is not None]
    if not others:
        return main
    with bpy.context.temp_override(active_object=main, object=main, selected_objects=[main] + others,
                                   selected_editable_objects=[main] + others):
        bpy.ops.object.join()
    return main


VARIANTS = {
    # long sweeping C-curves (mid/far use)
    "A": dict(L=16.0, R0=0.86, rt=0.24, tp=3.0, n=6, m=4, th0=-6, th1=46, bp=2.2, lat=0.06, latf=0.5,
              twist=45, fl=0.5, bury=0.7, tip="broken", ftilt=48, fjag=0.3, grooves=2, pnotch=0.3, seed=11),
    "B": dict(L=13.0, R0=0.70, rt=0.26, tp=2.6, n=5, m=4, th0=-3, th1=40, bp=1.25, scurve=26, lat=-0.05,
              twist=-70, fl=0.45, bury=0.6, tip="broken", ftilt=52, fjag=0.28, grooves=2, pnotch=0.25, seed=23),
    # mid-height
    "C": dict(L=10.0, R0=0.62, rt=0.28, tp=2.8, n=7, m=3, th0=0, th1=30, bp=1.0, wob=7, wobk=1.6, kink=3.0, lat=0.05, twist=30,
              fl=0.45, bury=0.6, tip="broken", ftilt=38, fjag=0.32, grooves=1, pnotch=0.3, seed=37),
    "D": dict(L=8.5, R0=0.52, rt=0.34, tp=2.4, n=5, m=4, th0=-4, th1=40, bp=2.0, lat=0.08, latf=0.8,
              twist=-40, fl=0.5, bury=0.5, tip="sharp", tip_len=1.1, grooves=1, pnotch=0.25, seed=41),
    # snapped: lower stump + upper piece lying half-sunk beside it
    "E": dict(L=11.0, R0=0.60, rt=0.28, tp=2.6, n=6, m=3, th0=2, th1=30, bp=1.3, lat=0.04, twist=35,
              fl=0.45, bury=0.6, tip="broken", ftilt=42, fjag=0.3, snap=4.9, grooves=2, pnotch=0.3, seed=53),
    # short broken stumps (slight curve only)
    "F": dict(L=6.5, R0=0.50, rt=0.62, tp=1.6, n=6, m=3, th0=2, th1=17, bp=1.2, lat=0.03, twist=20,
              fl=0.5, bury=0.55, tip="broken", ftilt=46, fjag=0.4, grooves=1, pnotch=0.35, seed=67),
    "G": dict(L=4.6, R0=0.50, rt=0.72, tp=1.4, n=7, m=3, th0=-2, th1=15, bp=1.1, lat=0.02, twist=-12,
              fl=0.45, bury=0.5, tip="broken", ftilt=34, fjag=0.45, grooves=1, pnotch=0.4, seed=79),
    # ---- v005 additions (variety + composition tools)
    # very thick squat broken stump (1:4)
    "H": dict(L=4.2, R0=1.12, rt=0.82, tp=1.3, n=7, m=4, th0=3, th1=11, bp=1.0, lat=0.02, twist=10,
              fl=0.42, bury=0.6, tip="broken", ftilt=26, fjag=0.55, grooves=2, pnotch=0.5, pscar=0.5,
              jd=(0.45, 0.8), seed=89),
    # slender whip rib (1:22), long sweeping curve
    "I": dict(L=14.5, R0=0.33, rt=0.22, tp=2.0, n=5, m=3, th0=-7, th1=58, bp=1.7, scurve=12, lat=0.05,
              twist=60, fl=0.55, bury=0.5, tip="broken", ftilt=44, fjag=0.3, grooves=1, pnotch=0.2,
              jd=(0.9, 1.7), kink=2.2, seed=97),
    # snapped halfway: the fallen upper half lies across a rubble pile
    "J": dict(L=12.5, R0=0.68, rt=0.3, tp=2.4, n=6, m=3, th0=1, th1=26, bp=1.3, lat=0.04, twist=25,
              fl=0.45, bury=0.6, tip="broken", ftilt=40, fjag=0.32, snap=6.0, fall="across", grooves=2,
              pnotch=0.3, seed=101),
    # aggressively leaning (~40-55 deg from vertical) C-curve
    "K": dict(L=10.5, R0=0.6, rt=0.3, tp=2.4, n=6, m=3, th0=36, th1=56, bp=1.2, lat=0.04, twist=-35,
              fl=0.6, bury=0.7, tip="broken", ftilt=36, fjag=0.32, grooves=2, pnotch=0.3, seed=103),
    # ruin-integrated: carved lozenge/chevron collar, wrapped bronze chain with hanging tail, lodged ruin block
    "L": dict(L=9.6, R0=0.64, rt=0.3, tp=2.6, n=6, m=4, th0=1, th1=27, bp=1.3, lat=0.04, twist=28,
              fl=0.45, bury=0.6, tip="broken", ftilt=38, fjag=0.32, grooves=1, pnotch=0.25,
              extras=("collar", "chain", "block"), seed=107),
    # twin ribs from one root bed with a heavy bronze chain slung between them
    "M": dict(L=10.0, R0=0.56, rt=0.28, tp=2.6, n=6, m=3, th0=-2, th1=32, bp=1.3, lat=0.05, twist=40,
              fl=0.5, bury=0.6, tip="broken", ftilt=42, fjag=0.3, grooves=1, pnotch=0.25,
              twin=dict(L=7.4, R0=0.46, th0=4, th1=24, off=(-0.3, 2.5), yaw=-18, ftilt=48), seed=109),
}

V5_NEW = ("H", "I", "J", "K", "L", "M")


def build_variant(key, col):
    P = dict(VARIANTS[key])
    seed = P.pop("seed")
    rng = np.random.default_rng(seed * 7 + 1)
    rib = Rib(P, seed)
    acc = T.MeshAcc()
    if "snap" in P:
        sb = P["snap"]
        V, Fc = rib.build(-rib.bury, sb, bottom="flat", top="broken")
        acc.add(V, Fc)
        # upper piece: fractured both ends, laid down beside the stump, leaning on rubble
        V2, F2 = rib.build(sb, rib.L, bottom="broken", top=P["tip"])
        C0, T0, _, _ = rib.frame(sb)
        V2 = V2 - C0.astype(F32)
        # orthonormal frame of the piece: a = chord, b = bend direction (local X), c = a x b
        a = np.array(rib.frame(rib.L)[0] - C0, F32)
        a /= np.linalg.norm(a)
        b = np.array([1, 0, 0], F32) - a * a[0]
        b /= np.linalg.norm(b)
        c = np.cross(a, b)
        # world frame: chord lies almost flat pointing away along +Y, bend horizontal
        A = np.array([0.32, 0.95, -0.14 if P.get("fall") == "across" else -0.025], F32)
        A /= np.linalg.norm(A)
        Bw = np.cross(np.array([0, 0, 1], F32), A)
        Bw /= np.linalg.norm(Bw)
        Cw = np.cross(A, Bw)
        Rm = np.stack([A, Bw, Cw], 1) @ np.stack([a, b, c], 0)
        V2 = V2 @ Rm.T
        V2 = V2 + np.array([P["R0"] * 1.25, P["R0"] * 1.4, 0], F32)
        if P.get("fall") == "across":
            # resting across a rubble pile: the broken end sits high on the pile, the tip end in the ground
            V2[:, 2] += -V2[:, 2].min() - 0.25 * P["R0"]
            mid = V2.mean(0)
            for kk in range(5):
                bs_ = rng.uniform(0.5, 0.95) * P["R0"] * 1.6
                Vb, Fb = T.block_chunk(rng, bs_)
                c = np.array([P["R0"] * 1.3, P["R0"] * 1.5, 0]) + (mid - np.array([P["R0"] * 1.3, P["R0"] * 1.5, 0])) \
                    * rng.uniform(0.0, 0.55) + rng.normal(0, 0.35, 3) * P["R0"]
                Vb = place(Vb, T.rot3(*rng.uniform(-30, 30, 2), rng.uniform(0, 360)), (c[0], c[1], 0))
                Vb[:, 2] += -Vb[:, 2].min() - 0.15 * bs_
                acc.add(Vb, Fb)
            # lift the near half so it lies ON the pile (linear lift fading toward the tip)
            d_ax = (V2 - V2[:, :].min(0)) @ np.array([0.32, 0.95, 0.0], F32)
            lift = np.clip(1.0 - d_ax / max(d_ax.max(), 1e-3) * 1.6, 0, 1) * P["R0"] * 1.15
            V2[:, 2] += lift
        else:
            V2[:, 2] += -V2[:, 2].min() - 0.5 * P["R0"]
        acc.add(V2, F2)
        # chunk that fell off at the break (sits at the stump foot)
        Vf, Ff = fragment(rng, P["R0"] * 0.55, 1.8, seed=seed + 5)
        Vf = place(Vf - np.array([0, 0, 0.9], F32), T.rot3(80, 10, 140), (-P["R0"] * 1.6, P["R0"] * 0.9, 0))
        Vf[:, 2] += -Vf[:, 2].min() - 0.3
        acc.add(Vf, Ff)
    else:
        V, Fc = rib.build(-rib.bury, rib.L, bottom="flat", top=P["tip"])
        acc.add(V, Fc)
    twin = P.get("twin")
    if twin:
        Q = dict(P)
        Q.pop("twin", None)
        Q.update(L=twin["L"], R0=twin["R0"], th0=twin["th0"], th1=twin["th1"], ftilt=twin["ftilt"])
        rib2 = Rib(Q, seed + 13)
        V3, F3 = rib2.build(-rib2.bury, rib2.L, bottom="flat", top="broken")
        R3 = T.rot3(0, 0, twin["yaw"])
        off = np.array([twin["off"][0], twin["off"][1], 0.0], F32)
        acc.add(place(V3, R3, off), F3)
    root_rubble(acc, rng, P["R0"] * (1.25 if twin else 1.0), seed,
                count=(12 if P["R0"] > 1.0 else 9) if P["L"] > 20 or P["R0"] > 1.0 else 7)
    ob = T.mesh_obj("CFCL_Rib_" + key, acc.verts(), acc.f, col, smooth=True, sharp_angle=28)
    tip = rib.frame(rib.L)[0]
    ob["cf_deflection_ratio"] = round(float(math.hypot(tip[0], tip[1]) / rib.L), 3)
    ob["cf_length_m"] = rib.L
    ob["cf_joints"] = len(rib.joints)
    M.assign(ob, "Basalt", curvature=True)
    extras = []
    ex = P.get("extras", ())
    if "collar" in ex:
        Vc, Fc_ = collar_mesh(rib, 0.36 * rib.L, height=0.8, nth=96, nv=13, seed=seed)
        oc = T.mesh_obj("tmp_collar", Vc, Fc_, col, smooth=True, sharp_angle=35)
        M.assign(oc, "AncientStone", curvature=True)
        extras.append(oc)
    if "block" in ex:
        Vb, Fb = T.block_chunk(rng, 0.0, dims=(0.95, 0.55, 0.48), ncut=3)
        Cb, Tb, Nb, Bb = rib.frame(0.62 * rib.L)
        Rm = np.stack([Bb, Nb, Tb], 1) @ T.rot3(0, 18, 25)
        pos = Cb + Bb * rib.radius(0.62 * rib.L) * 0.9
        ob_b = T.mesh_obj("tmp_block", (Vb @ Rm.T + pos).astype(F32), Fb, col, smooth=True, sharp_angle=30)
        M.assign(ob_b, "AncientStone", curvature=True)
        extras.append(ob_b)
    chain_acc = T.MeshAcc()
    if "chain" in ex:
        s0, s1 = 0.44 * rib.L, 0.53 * rib.L
        path = [rib_wrap_point(rib, s0 + (s1 - s0) * t, 2 * np.pi * 1.35 * t) for t in np.linspace(0, 1, 90)]
        end = path[-1]
        foot = np.array([end[0] + 1.1, end[1] - 0.6, 0.15])
        path += list(catenary(end, foot, 0.25, 30))[1:]
        chain_along(chain_acc, path, scale=1.5)
    if twin:
        pa = rib_wrap_point(rib, 0.56 * rib.L, -0.5 * np.pi, pad=0.0)
        Cq = rib2.frame(0.62 * rib2.L)
        pb_local = rib_wrap_point(rib2, 0.62 * rib2.L, 0.5 * np.pi, pad=0.0)
        pb = (R3 @ pb_local) + off
        chain_along(chain_acc, catenary(pa, pb, 0.9, 60), scale=1.6)
    if chain_acc.v:
        och = T.mesh_obj("tmp_chain", chain_acc.verts(), chain_acc.f, col, smooth=True, sharp_angle=60)
        M.assign(och, "Bronze", curvature=True)
        extras.append(och)
    if extras:
        join_into(ob, extras)
        ob.name = "CFCL_Rib_" + key
    return ob


# ---------------------------------------------------------------------------------------------
def arrangement():
    """Two concentric inward-leaning arcs (near/mid/far) from terrain_layout_data (research-ideal layout)."""
    pl = LD.rib_placements()
    clean = [{k: p[k] for k in ("source", "name", "location", "rotation_deg", "scale")} for p in pl]
    return clean, pl


def main():
    R.reset_scene()
    col = T.new_collection(ASSET)
    obs = []
    for k in VARIANTS:
        ob = build_variant(k, col)
        obs.append(ob)
        T.log(k, "tris", R.tri_count([ob]), "dims", [round(x, 2) for x in ob.dimensions],
              "deflection", ob["cf_deflection_ratio"], "joints", ob["cf_joints"])
    # save asset first (clean)
    path, ver = T.next_version_path(ASSET, ITER)
    T.save_blend(path)
    infos = [T.obj_info(o) for o in obs]
    arr, arr_full = arrangement()
    T.write_json(os.path.join(T.ASSETS, ASSET, "arrangement.json"),
                 {"asset": ASSET, "blend": os.path.basename(path), "placements": arr})
    T.write_json(os.path.join(T.ASSETS, ASSET, "meta.json"),
                 {"asset": ASSET, "blend": os.path.basename(path), "version": ver, "objects": infos,
                  "origin": "root centre at ground contact (Z=0), rib bends toward local +X",
                  "material_slots": ["CFCL_Basalt", "CFCL_AncientStone (L collar/block)", "CFCL_Bronze (L, M chains)"],
                  "budget_tris_each": 20000,
                  "placement_notes": [{"name": p["name"], "tier": p["tier"], "note": p["note"]} for p in arr_full],
                  "arrangement_rules": "Rib local +X points toward the arena centre (yaw = atan2(-y,-x) + jitter). "
                                       "Negative Y scale = mirrored variant. Roots sit 0.5-0.7 m below their "
                                       "placement Z (buried); root Z values match the banks/ledges in "
                                       "CFCL_Terrain_Central and CFCL_Terrain_Abyss.",
                  "variants": {k: {kk: vv for kk, vv in v.items() if kk != "seed"} for k, v in VARIANTS.items()}})
    if args.get("norender"):
        return
    # ------------------------------------------------------------ renders
    sc = bpy.context.scene
    R.setup_world(sc)
    R.standard_lights(scale=3.0)
    T.preview_ground(0.0, 400.0)
    bpy.context.view_layer.update()
    hum = T.human_proxy((1.6, -1.2, 0))
    for o in obs:
        o.location = (0, 0, 0)
    pre = os.path.join(OUT, f"iter{ITER:02d}")
    views = (("front", 0, 10), ("q_left", -45, 16), ("side", 90, 8), ("q_back", 150, 20))
    if args.get("quick"):
        views = views[:3]
    only_new = args.get("newonly")
    for o in obs:
        if only_new and o.name.split("_")[-1] not in V5_NEW:
            continue
        T.hide_all_but([o, hum, bpy.data.objects["CFCL_PreviewGround"]], obs)
        R.turntable([o], f"{pre}_{o.name}", views=views, lens=40, dist_mult=1.9, res=(900, 700), samples=32)
    # lineup
    xs = 0.0
    for o in obs:
        o.hide_render = False
        o.hide_viewport = False
        w = o.dimensions.x
        o.location = (xs - (R.bounds([o])[0].x - o.location.x), 0, 0)
        xs += w + 2.0
        bpy.context.view_layer.update()
    hum.location = (-2, -2, 0)
    bpy.context.view_layer.update()
    mn, mx = R.bounds(obs)
    ctr = (mn + mx) / 2
    wid = (mx.x - mn.x) * 1.08
    dcam = (wid / 2) / math.tan(math.atan(18 / 35))
    cam = R.camera("CFCL_Lineup", (ctr.x, ctr.y - dcam, 5), (ctr.x, ctr.y, 5), lens=35)
    R.setup_render(sc, "EEVEE", (1600, 700), 32)
    R.render_to(f"{pre}_lineup.png", cam)
    cam2 = R.camera("CFCL_Lineup2", (mn.x - 8, ctr.y - 20, 1.2), (ctr.x - 4, ctr.y, 4), lens=24)
    R.render_to(f"{pre}_lineup_low.png", cam2)


main()
