"""Crownfall (Claude track) - architecture toolkit used by arch_altar_dais.py / arch_ruins_kit.py.

Masonry is built from explicit, individually-modelled stones:
  * `make_block`  - a gridded box (quad surface) in a local frame, with noise-varied rounded/chamfered
                    arrises, ball-limited planar chips (spalls), fracture remaps (broken tops/bottoms),
                    jagged crack faces, then mapped into world space through an arbitrary mapping
                    (annular sector, arch voussoir, taper, affine).
  * `lathe`       - revolved profiles (pedestal mouldings, column drums) with per-vertex deform hooks.
  * relief carving - `stroke`, `nailhead`, `lozenge_frieze`: real raised geometry (zig-zag lozenge/
                    chevron band + pyramidal nailheads) echoing the board's inlaid lozenges and its
                    pyramidal bronze corner bosses.
  * `chain_link`/`chain_along` - heavy bronze chain.
All geometry is accumulated as numpy arrays and turned into a handful of Blender meshes at the end.
Deterministic: every random choice comes from an explicit numpy Generator seed.
"""
import math
import os
import sys

import numpy as np

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
if os.path.join(CL, "lib") not in sys.path:
    sys.path.insert(0, os.path.join(CL, "lib"))
import cf_sdf as S  # noqa: E402

TAU = 2.0 * math.pi
D2R = math.pi / 180.0


# ----------------------------------------------------------------------------- small helpers
def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def fbm3(P, freq, octaves=3, seed=0):
    P = np.ascontiguousarray(np.asarray(P, float).reshape(-1, 3), np.float32)
    return S.fbm(P, freq, octaves, seed=seed).astype(np.float64)


def fbm2(u, v, freq, octaves=3, seed=0, w=0.0):
    u = np.asarray(u, float)
    v = np.asarray(v, float)
    P = np.stack([u.ravel(), v.ravel(), np.full(u.size, w)], 1)
    return fbm3(P, freq, octaves, seed).reshape(u.shape)


def normalize(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def rot_axis(axis, ang_deg):
    """3x3 rotation about unit axis (Rodrigues)."""
    a = normalize(np.asarray(axis, float))
    t = ang_deg * D2R
    c, s = math.cos(t), math.sin(t)
    x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


def rot_euler(rx=0.0, ry=0.0, rz=0.0):
    return S.rot_matrix(rx, ry, rz).astype(np.float64)


def M4(R=None, t=(0, 0, 0)):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = R
    M[:3, 3] = t
    return M


def rot_about(point, axis, ang_deg):
    p = np.asarray(point, float)
    R = rot_axis(axis, ang_deg)
    return M4(R, p - R @ p)


# ----------------------------------------------------------------------------- Piece
class Piece:
    """A chunk of geometry: V (N,3) float64 and F list of index lists."""

    def __init__(self, V, F, fm=None):
        self.V = np.asarray(V, float).reshape(-1, 3)
        if isinstance(F, np.ndarray):
            F = F.tolist()
        self.F = [list(f) for f in F]
        self.fm = list(fm) if fm is not None else [0] * len(self.F)

    def copy(self):
        return Piece(self.V.copy(), [list(f) for f in self.F], list(self.fm))

    def set_mat(self, idx):
        self.fm = [idx] * len(self.F)
        return self

    def tris(self):
        T = []
        for f in self.F:
            for i in range(1, len(f) - 1):
                T.append((f[0], f[i], f[i + 1]))
        return np.asarray(T, np.int64).reshape(-1, 3)

    def signed_volume(self):
        T = self.tris()
        if len(T) == 0:
            return 0.0
        a, b, c = self.V[T[:, 0]], self.V[T[:, 1]], self.V[T[:, 2]]
        return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)

    def flip(self):
        self.F = [f[::-1] for f in self.F]
        return self

    def fix_orientation(self):
        if self.signed_volume() < 0:
            self.flip()
        return self

    def vertex_normals(self):
        T = self.tris()
        V = self.V
        fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
        vn = np.zeros_like(V)
        for k in range(3):
            np.add.at(vn, T[:, k], fn)
        return normalize(vn)

    def transform(self, M):
        M = np.asarray(M, float)
        self.V = self.V @ M[:3, :3].T + M[:3, 3]
        return self

    def translate(self, t):
        self.V = self.V + np.asarray(t, float)
        return self

    def displace(self, amp, freq, seed=0, octaves=3, mask=None):
        if amp <= 0:
            return self
        n = self.vertex_normals()
        d = fbm3(self.V, freq, octaves, seed) * amp
        if mask is not None:
            d = d * mask
        self.V = self.V + n * d[:, None]
        return self

    def merge(self, other):
        n = len(self.V)
        self.V = np.concatenate([self.V, other.V])
        self.F.extend([[i + n for i in f] for f in other.F])
        self.fm.extend(other.fm)
        return self

    def bounds(self):
        return self.V.min(0), self.V.max(0)


def merge_pieces(pieces):
    out = Piece(np.zeros((0, 3)), [])
    for p in pieces:
        if p is not None and len(p.V):
            out.merge(p)
    return out


class Acc:
    """Accumulate pieces into one Blender mesh object."""

    def __init__(self):
        self.pieces = []

    def add(self, p):
        if p is None:
            return
        if isinstance(p, (list, tuple)):
            for q in p:
                self.add(q)
            return
        if len(p.V):
            self.pieces.append(p)

    def build(self, name, collection, mats, sharp_deg=34.0, smooth=True, origin=None):
        """mats: material name / bpy material, or a list of them (face index Piece.fm picks the slot)."""
        import bpy
        import cf_materials as M
        allp = merge_pieces(self.pieces)
        if origin is not None:
            allp.translate(-np.asarray(origin, float))
        me = bpy.data.meshes.new(name + "_Mesh")
        me.from_pydata(allp.V.tolist(), [], allp.F)
        mats = mats if isinstance(mats, (list, tuple)) else [mats]
        for mm in mats:
            me.materials.append(M.get(mm) if isinstance(mm, str) else mm)
        if len(mats) > 1:
            fm = np.clip(np.asarray(allp.fm, np.int32), 0, len(mats) - 1)
            me.polygons.foreach_set("material_index", fm)
        me.validate(clean_customdata=False)
        me.update()
        if smooth:
            me.shade_smooth()
            try:
                me.set_sharp_from_angle(angle=math.radians(sharp_deg))
            except Exception as e:  # pragma: no cover
                print("[arch_lib] sharp_from_angle failed", e)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        if origin is not None:
            ob.location = tuple(origin)
        return ob


# ----------------------------------------------------------------------------- gridded box blocks
def axis_coords(e, rb, step, dense=0.0):
    pts = [-e, e]
    inner = e
    if rb > 1e-5 and e - rb > 1e-3:
        pts += [-(e - rb), e - rb]
        inner = e - rb
    if dense > 0 and inner - dense > 0.01:
        pts += [-(inner - dense), inner - dense]
        inner = inner - dense
    n = max(1, int(math.ceil(2 * inner / max(step, 1e-3))))
    pts += list(np.linspace(-inner, inner, n + 1))
    return np.unique(np.round(np.asarray(pts, float), 7))


def box_surface(xs, ys, zs):
    nx, ny, nz = len(xs), len(ys), len(zs)
    mask = np.zeros((nx, ny, nz), bool)
    mask[[0, -1], :, :] = True
    mask[:, [0, -1], :] = True
    mask[:, :, [0, -1]] = True
    idx = -np.ones((nx, ny, nz), np.int64)
    I, J, K = np.nonzero(mask)
    idx[I, J, K] = np.arange(len(I))
    V = np.stack([xs[I], ys[J], zs[K]], 1).astype(float)
    Q = []
    a, b = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1), indexing='ij')
    a, b = a.ravel(), b.ravel()
    k = nz - 1
    Q.append(np.stack([idx[a, b, k], idx[a + 1, b, k], idx[a + 1, b + 1, k], idx[a, b + 1, k]], 1))
    k = 0
    Q.append(np.stack([idx[a, b, k], idx[a, b + 1, k], idx[a + 1, b + 1, k], idx[a + 1, b, k]], 1))
    b2, c = np.meshgrid(np.arange(ny - 1), np.arange(nz - 1), indexing='ij')
    b2, c = b2.ravel(), c.ravel()
    i = nx - 1
    Q.append(np.stack([idx[i, b2, c], idx[i, b2 + 1, c], idx[i, b2 + 1, c + 1], idx[i, b2, c + 1]], 1))
    i = 0
    Q.append(np.stack([idx[i, b2, c], idx[i, b2, c + 1], idx[i, b2 + 1, c + 1], idx[i, b2 + 1, c]], 1))
    a3, c3 = np.meshgrid(np.arange(nx - 1), np.arange(nz - 1), indexing='ij')
    a3, c3 = a3.ravel(), c3.ravel()
    j = ny - 1
    Q.append(np.stack([idx[a3, j, c3], idx[a3, j, c3 + 1], idx[a3 + 1, j, c3 + 1], idx[a3 + 1, j, c3]], 1))
    j = 0
    Q.append(np.stack([idx[a3, j, c3], idx[a3 + 1, j, c3], idx[a3 + 1, j, c3 + 1], idx[a3, j, c3 + 1]], 1))
    return V, np.concatenate(Q)


def round_corners(V, e, rb):
    e = np.asarray(e, float)
    rb = np.maximum(np.asarray(rb, float), 0.0)
    lim = np.maximum(e[None, :] - rb[:, None], 0.0)
    q = np.clip(V, -lim, lim)
    d = V - q
    L = np.linalg.norm(d, axis=1)
    m = L > 1e-9
    out = V.copy()
    out[m] = q[m] + d[m] / L[m, None] * rb[m, None]
    return out


def chip(V, p0, n, depth, R):
    n = normalize(n)
    d0 = float(n @ p0) - depth
    s = V @ n - d0
    m = (s > 0) & (np.linalg.norm(V - p0, axis=1) < R)
    V[m] -= s[m, None] * n
    return int(m.sum())


def random_chips(V, e, n, rng, scale=1.0, skip_top=False, skip_bottom=True, only_top=False,
                 prefer=None, prefer_p=0.7):
    """prefer=(free_axis, (sx,sy,sz)) : that arris gets prefer_p of the chips (e.g. the outer top lip)."""
    e = np.asarray(e, float)
    for _ in range(n):
        if prefer is not None and rng.uniform() < prefer_p:
            free = int(prefer[0])
            sgn = np.asarray(prefer[1], float).copy()
        else:
            for _try in range(6):
                free = int(rng.integers(3))
                sgn = rng.choice([-1.0, 1.0], 3)
                if skip_bottom and free != 2 and sgn[2] < 0:
                    continue
                if skip_top and free != 2 and sgn[2] > 0:
                    continue
                if only_top and not (free != 2 and sgn[2] > 0):
                    continue
                break
        p0 = sgn * e
        p0[free] = rng.uniform(-0.85, 0.85) * e[free]
        nv = sgn.copy()
        nv[free] = rng.uniform(-0.5, 0.5)
        nv = normalize(nv + rng.normal(0, 0.22, 3))
        depth = scale * rng.uniform(0.012, 0.045)
        R = depth * rng.uniform(2.0, 3.6)
        chip(V, p0, nv, depth, R)


def corner_chip(V, e, corner_sign, depth, rng):
    e = np.asarray(e, float)
    p0 = np.asarray(corner_sign, float) * e
    nv = normalize(np.asarray(corner_sign, float) + rng.normal(0, 0.25, 3))
    chip(V, p0, nv, depth, depth * 4.0)


def make_block(e, rb=0.02, step=0.12, step_z=None, dense=0.0, rb_var=0.6, chips=0, chip_scale=1.0,
               rng=None, mapping=None, center=(0, 0, 0), fracture_top=None, fracture_bottom=None,
               face_noise=None, sharp_faces=(), noise_amp=0.0018, noise_freq=7.0, seed=0,
               chip_opts=None, local_fn=None, frac_step=0.045, world_fn=None):
    """Gridded stone block.  e = half extents (local frame).  Returns Piece in world space.

    mapping(Vparent) -> world points, where Vparent = local + center (parent frame).
    fracture_top(x, y) -> new top z (local, within [-ez, ez]) : broken upper surface.
    fracture_bottom(x, y) -> new bottom z (local).
    face_noise: list of (axis, sign, fn(a, b)) -> displacement along axis of that face's verts
                (used for jagged matching crack faces).
    sharp_faces: list of (axis, sign) faces whose arrises stay sharp (fresh breaks / cracks).
    """
    rng = rng if rng is not None else np.random.default_rng(seed)
    ex, ey, ez = e = np.asarray(e, float)
    step_z = step_z or step
    xs = axis_coords(ex, rb, step, dense)
    ys = axis_coords(ey, rb, step, dense)
    zs = axis_coords(ez, rb, step_z, dense)
    if fracture_top is not None or fracture_bottom is not None:
        # denser top/bottom grids for jagged fracture surfaces
        xs = np.unique(np.concatenate([xs, np.linspace(-ex, ex, max(3, int(2 * ex / frac_step)) + 1)]))
        ys = np.unique(np.concatenate([ys, np.linspace(-ey, ey, max(3, int(2 * ey / frac_step)) + 1)]))
    V, Q = box_surface(xs, ys, zs)
    rbv = rb * (1.0 - rb_var + rb_var * np.clip(0.5 + 0.9 * fbm3(V * 1.0 + seed * 3.17, 6.0, 2, seed), 0, 1))
    sf = list(sharp_faces)
    if fracture_top is not None:
        sf.append((2, 1))
    if fracture_bottom is not None:
        sf.append((2, -1))
    if face_noise:
        for ax, sg, _fn in face_noise:
            sf.append((ax, sg))
    for ax, sg in sf:
        dist = e[ax] - sg * V[:, ax]
        rbv = rbv * smoothstep(0.0, 1.5 * rb + 1e-4, dist)
    V = round_corners(V, e, rbv)
    if chips:
        random_chips(V, e, chips, rng, chip_scale, **(chip_opts or {}))
    if fracture_top is not None:
        zf = np.clip(fracture_top(V[:, 0], V[:, 1]), -ez + 0.02, ez)
        V[:, 2] = -ez + (V[:, 2] + ez) * (zf + ez) / (2 * ez)
    if fracture_bottom is not None:
        zb = np.clip(fracture_bottom(V[:, 0], V[:, 1]), -ez, ez - 0.02)
        V[:, 2] = ez - (ez - V[:, 2]) * (ez - zb) / (2 * ez)
    if face_noise:
        for ax, sg, fn in face_noise:
            on = np.abs(V[:, ax] - sg * e[ax]) < 1e-6
            o = [k for k in range(3) if k != ax]
            V[on, ax] += fn(V[on, o[0]], V[on, o[1]])
    if local_fn is not None:
        V = local_fn(V)
    V = V + np.asarray(center, float)
    P = mapping(V) if mapping is not None else V
    pc = Piece(P, Q)
    pc.fix_orientation()
    if noise_amp > 0:
        pc.displace(noise_amp, noise_freq, seed=seed % 997)
    if world_fn is not None:
        pc.V = world_fn(pc.V)
    return pc


# ----------------------------------------------------------------------------- mappings
def map_patch(e, inner, outer, z0=0.0):
    """Local box (parent extents e) -> patch between curves inner(s), outer(s) (2D, s in [0,1]).
    x -> s, y -> t (inner->outer), z -> z0 + z."""
    ex, ey = float(e[0]), float(e[1])

    def f(V):
        s = np.clip((V[:, 0] + ex) / (2 * ex), -0.5, 1.5)
        t = (V[:, 1] + ey) / (2 * ey)
        a = inner(s)
        b = outer(s)
        xy = a * (1 - t)[:, None] + b * t[:, None]
        return np.stack([xy[:, 0], xy[:, 1], z0 + V[:, 2]], 1)
    return f


def sector_curves(r_in, r_out, th_a, th_b):
    """Annular sector; s=0 at th_b, s=1 at th_a (keeps local frame right-handed)."""
    def inner(s):
        th = th_b - s * (th_b - th_a)
        return np.stack([r_in * np.cos(th), r_in * np.sin(th)], 1)

    def outer(s):
        th = th_b - s * (th_b - th_a)
        return np.stack([r_out * np.cos(th), r_out * np.sin(th)], 1)
    return inner, outer


def sector_block(r_in, r_out, th_a, th_b, z_bot, z_top, gap=0.012, **kw):
    """Annular-sector stone (angles in radians).  Real gaps (joints) are taken off every side."""
    rm = 0.5 * (r_in + r_out)
    g_th = gap / rm * 0.5
    th_a2, th_b2 = th_a + g_th, th_b - g_th
    r_in2, r_out2 = r_in + gap * 0.5, r_out - gap * 0.5
    ex = 0.5 * (th_b2 - th_a2) * rm
    ey = 0.5 * (r_out2 - r_in2)
    ez = 0.5 * (z_top - z_bot)
    inner, outer = sector_curves(r_in2, r_out2, th_a2, th_b2)
    mp = map_patch((ex, ey, ez), inner, outer, z0=0.5 * (z_top + z_bot))
    return make_block((ex, ey, ez), mapping=mp, **kw), (ex, ey, ez), mp


def map_affine(M):
    M = np.asarray(M, float)

    def f(V):
        return V @ M[:3, :3].T + M[:3, 3]
    return f


def map_taper(ez, taper_x, taper_y, then=None):
    """Scale x,y linearly with z: factor 1 at z=-ez, taper at z=+ez."""
    def f(V):
        t = (V[:, 2] + ez) / (2 * ez)
        W = V.copy()
        W[:, 0] *= 1 + (taper_x - 1) * t
        W[:, 1] *= 1 + (taper_y - 1) * t
        return then(W) if then else W
    return f


def map_arch(cx, cz, r_in, r_out, a_lo, a_hi, y0, ex, ey):
    """Voussoir: local x along arc (a_lo..a_hi), local y radial (r_in..r_out), local z -> world Y (depth)."""
    def f(V):
        s = (V[:, 0] + ex) / (2 * ex)
        t = (V[:, 1] + ey) / (2 * ey)
        a = a_lo + s * (a_hi - a_lo)
        r = r_in + t * (r_out - r_in)
        return np.stack([cx + r * np.cos(a), y0 + V[:, 2], cz + r * np.sin(a)], 1)
    return f


# ----------------------------------------------------------------------------- lathe
def lathe(profile, nseg, deform=None, th0=0.0):
    """Revolve closed-at-poles profile [(r,z), ...] (first/last may have r==0 = pole).
    deform(R, TH, Z, ring_index) -> (R, Z) arrays for non-pole rings.  Returns Piece."""
    V = []
    F = []
    rings = []
    th = th0 + np.arange(nseg) * TAU / nseg
    for k, (r, z) in enumerate(profile):
        if r < 1e-7:
            rings.append(("pole", len(V)))
            V.append([0.0, 0.0, z])
        else:
            R = np.full(nseg, float(r))
            Z = np.full(nseg, float(z))
            if deform is not None:
                R, Z = deform(R, th, Z, k)
            base = len(V)
            for i in range(nseg):
                V.append([R[i] * math.cos(th[i]), R[i] * math.sin(th[i]), Z[i]])
            rings.append(("ring", base))
    for k in range(len(rings) - 1):
        ta, a = rings[k]
        tb, b = rings[k + 1]
        for i in range(nseg):
            j = (i + 1) % nseg
            if ta == "pole" and tb == "ring":
                F.append([a, b + j, b + i])
            elif ta == "ring" and tb == "pole":
                F.append([a + i, a + j, b])
            elif ta == "ring" and tb == "ring":
                F.append([a + i, a + j, b + j, b + i])
    pc = Piece(np.asarray(V), F)
    pc.fix_orientation()
    return pc


def lathe_sector(profile, th0, th1, nseg, deform=None):
    """Partial revolution of a pole-to-pole profile between th0..th1 (radians), closed by planar end caps.
    Used to cut drums/mouldings into individual jointed stones."""
    th = np.linspace(th0, th1, nseg + 1)
    V = []
    rings = []
    for k, (r, z) in enumerate(profile):
        if r < 1e-7:
            rings.append(("pole", len(V)))
            V.append([0.0, 0.0, z])
        else:
            Rr = np.full(nseg + 1, float(r))
            Z = np.full(nseg + 1, float(z))
            if deform is not None:
                Rr, Z = deform(Rr, th, Z, k)
            base = len(V)
            for i in range(nseg + 1):
                V.append([Rr[i] * math.cos(th[i]), Rr[i] * math.sin(th[i]), Z[i]])
            rings.append(("ring", base))
    F = []
    for k in range(len(rings) - 1):
        ta, a = rings[k]
        tb, b = rings[k + 1]
        for i in range(nseg):
            j = i + 1
            if ta == "pole" and tb == "ring":
                F.append([a, b + j, b + i])
            elif ta == "ring" and tb == "pole":
                F.append([a + i, a + j, b])
            elif ta == "ring" and tb == "ring":
                F.append([a + i, a + j, b + j, b + i])
    cap0 = [(a if t == "pole" else a) for t, a in rings]
    cap1 = [(a if t == "pole" else a + nseg) for t, a in rings]
    F.append(cap0)
    F.append(cap1[::-1])
    pc = Piece(np.asarray(V), F)
    pc.fix_orientation()
    return pc


# ----------------------------------------------------------------------------- relief carving
def _miter(P, w, closed):
    P = np.asarray(P, float)
    n = len(P)
    if closed:
        prev = np.roll(P, 1, 0)
        nxt = np.roll(P, -1, 0)
        t_in = normalize(P - prev)
        t_out = normalize(nxt - P)
    else:
        t_out = np.zeros_like(P)
        t_in = np.zeros_like(P)
        t_out[:-1] = normalize(P[1:] - P[:-1])
        t_out[-1] = t_out[-2]
        t_in[1:] = normalize(P[1:] - P[:-1])
        t_in[0] = t_in[1]
    n_in = np.stack([-t_in[:, 1], t_in[:, 0]], 1)
    n_out = np.stack([-t_out[:, 1], t_out[:, 0]], 1)
    m = normalize(n_in + n_out)
    cosv = np.maximum(np.einsum('ij,ij->i', m, n_in), 0.35)
    return m / cosv[:, None]


def _orient_open(pc, probe_face, up_vec):
    f = pc.F[probe_face]
    a, b, c = pc.V[f[0]], pc.V[f[1]], pc.V[f[2]]
    nrm = np.cross(b - a, c - a)
    if float(nrm @ up_vec) < 0:
        pc.flip()
    return pc


def stroke(pts_uv, mapfn, wb=0.014, wt=0.007, h=0.010, embed=0.004, closed=False):
    """Raised carved fillet following a polyline in (u,v); sloped sides.  mapfn(u,v,h)->(N,3)."""
    P = np.asarray(pts_uv, float)
    n = len(P)
    m = _miter(P, 1.0, closed)
    rows = []
    for (w, hh) in ((wb, -embed), (wt, h), (-wt, h), (-wb, -embed)):  # BL, TL, TR, BR
        Q = P + m * w
        rows.append(mapfn(Q[:, 0], Q[:, 1], np.full(n, hh)))
    V = np.concatenate(rows)  # index = r*n + i
    F = []
    segs = n if closed else n - 1
    for i in range(segs):
        j = (i + 1) % n
        for r in range(3):
            F.append([r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i])
    if not closed:
        F.append([0 * n + 0, 1 * n + 0, 2 * n + 0, 3 * n + 0][::-1])
        F.append([0 * n + n - 1, 1 * n + n - 1, 2 * n + n - 1, 3 * n + n - 1])
    pc = Piece(V, F)
    # probe: top face of segment 0 (rows 1->2)
    u0, v0 = 0.5 * (P[0] + P[1 % n])
    up = mapfn(np.array([u0]), np.array([v0]), np.array([0.01]))[0] - mapfn(np.array([u0]), np.array([v0]), np.array([0.0]))[0]
    return _orient_open(pc, 1, up)


def nailhead(uc, vc, au, av, hp, mapfn, embed=0.004, flat=0.18):
    """Pyramidal 'nailhead' boss on a diamond (lozenge) base; small flat top (worn)."""
    base_u = np.array([uc - au, uc, uc + au, uc])
    base_v = np.array([vc, vc - av, vc, vc + av])
    top_u = uc + (base_u - uc) * flat
    top_v = vc + (base_v - vc) * flat
    B = mapfn(base_u, base_v, np.full(4, -embed))
    T = mapfn(top_u, top_v, np.full(4, hp))
    V = np.concatenate([B, T])
    F = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]
    pc = Piece(V, F)
    up = mapfn(np.array([uc]), np.array([vc]), np.array([0.01]))[0] - mapfn(np.array([uc]), np.array([vc]), np.array([0.0]))[0]
    return _orient_open(pc, 4, up)


def lozenge_frieze(u0, u1, v_lo, v_hi, n_units, mapfn, keep=None, h=0.010, wb=0.014, wt=0.007,
                   nail_h=0.016, nail_scale=0.5, small_nails=True, closed=False, rng=None,
                   wear=0.0, embed=0.004, nail_keep=None, phases=(0, 1)):
    """Interlaced zig-zag (chevron) pair forming a chain of lozenges, a pyramidal nailhead in every
    lozenge and a half-size nailhead in every triangle.  phases=(0,) gives a single chevron band with
    nailheads inside each V.  keep(k)->bool drops damaged units.  Returns list of Pieces."""
    L = (u1 - u0) / n_units
    vm = 0.5 * (v_lo + v_hi)
    keepk = [True if keep is None else bool(keep(k)) for k in range(n_units)]
    pieces = []
    runs = []
    if closed and all(keepk):
        runs = [(0, n_units, True)]
    elif any(keepk):
        order = list(range(n_units))
        if closed:  # start right after a dropped unit so wrap-around runs stay continuous
            st = keepk.index(False)
            order = [st + 1 + i for i in range(n_units)]
        cur = None
        for kv in order:
            if keepk[kv % n_units]:
                cur = [kv, kv + 1] if cur is None else [cur[0], kv + 1]
            elif cur is not None:
                runs.append((cur[0], cur[1], False))
                cur = None
        if cur is not None:
            runs.append((cur[0], cur[1], False))
    for (s, t, cl) in runs:
        for phase in phases:
            pts = []
            npts = 2 * (t - s) + (0 if cl else 1)
            for i in range(npts):
                kk = 2 * s + i
                u = u0 + kk * L / 2
                lo = ((kk + phase) % 2 == 0)
                pts.append((u, v_lo if lo else v_hi))
            hh = h
            if wear > 0 and rng is not None:
                hh = h * (1 - wear * rng.uniform(0, 1))
            pieces.append(stroke(pts, mapfn, wb, wt, hh, embed, closed=cl))
        for kv in range(s, t):
            uk = u0 + kv * L
            first = (kv == s) and not cl
            if len(phases) == 2:
                cands = ([] if first else [uk]) + [uk + L / 2]
                for uc in cands:
                    if nail_keep is not None and not nail_keep(uc):
                        continue
                    pieces.append(nailhead(uc, vm, L / 4 * nail_scale, (v_hi - v_lo) / 2 * nail_scale, nail_h,
                                           mapfn, embed=embed))
                if small_nails:
                    for uc in (uk + L / 4, uk + 3 * L / 4):
                        for sgn in (-1, 1):
                            vc = vm + sgn * (v_hi - vm) * 0.66
                            pieces.append(nailhead(uc, vc, L / 4 * 0.30, (v_hi - v_lo) / 2 * 0.20, nail_h * 0.55,
                                                   mapfn, embed=embed))
            else:
                ph = phases[0]
                for j in range(2):
                    kk = 2 * kv + j
                    if first and j == 0:
                        continue
                    lo = ((kk + ph) % 2 == 0)
                    uc = u0 + kk * L / 2
                    vc = v_hi - 0.36 * (v_hi - v_lo) if lo else v_lo + 0.36 * (v_hi - v_lo)
                    if nail_keep is not None and not nail_keep(uc):
                        continue
                    pieces.append(nailhead(uc, vc, L / 4 * 0.42, (v_hi - v_lo) * 0.2, nail_h * 0.8, mapfn,
                                           embed=embed))
    return pieces


def map_cyl(R, z0=0.0, th0=0.0):
    """Cylinder surface: u = arc length at radius R (CCW), v = z offset, h = radial outward."""
    def f(u, v, h):
        th = th0 + np.asarray(u) / R
        r = R + np.asarray(h)
        return np.stack([r * np.cos(th), r * np.sin(th), z0 + np.asarray(v)], 1)
    return f


def fret_band(u0, u1, v_lo, v_hi, n_units, mapfn, h=0.012, wb=0.016, wt=0.008, embed=0.005, border=True):
    """Stepped fret (running key): one hooked key per unit standing on a continuous base fillet.
    Abstract geometric only (no glyphs)."""
    L = (u1 - u0) / n_units
    H = v_hi - v_lo
    key = [(0.08, 0.0), (0.08, 1.0), (0.86, 1.0), (0.86, 0.30), (0.36, 0.30), (0.36, 0.66)]
    out = []
    for k in range(n_units):
        ua = u0 + k * L
        pts = [(ua + x * L, v_lo + y * H) for x, y in key]
        out.append(stroke(pts, mapfn, wb, wt, h, embed))
    if border:
        out.append(stroke([(u0, v_lo - 0.6 * wb), (u1, v_lo - 0.6 * wb)], mapfn, wb, wt, h, embed))
        out.append(stroke([(u0, v_hi + 1.4 * wb), (u1, v_hi + 1.4 * wb)], mapfn, wb * 0.8, wt * 0.8, h * 0.8, embed))
    return out


def rosette(uc, vc, size, mapfn, h=0.012, wb=0.016, wt=0.008, embed=0.005):
    """Nested lozenges with a pyramidal centre boss and four corner nailheads (abstract, no emblem)."""
    out = []
    for f in (1.0, 0.62):
        a = size * f
        pts = [(uc - a, vc), (uc, vc - a), (uc + a, vc), (uc, vc + a)]
        out.append(stroke(pts, mapfn, wb, wt, h, embed, closed=True))
    out.append(nailhead(uc, vc, size * 0.30, size * 0.30, h * 1.8, mapfn, embed=embed))
    for du, dv in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        out.append(nailhead(uc + du * size * 1.32, vc + dv * size * 1.32, size * 0.13, size * 0.13, h * 1.2, mapfn,
                            embed=embed))
    return out


def map_radial(theta, z0):
    """Floor mapping along a radial line: u = radius, v = tangential offset (CCW), h = up."""
    c, s = math.cos(theta), math.sin(theta)

    def f(u, v, h):
        u, v, h = (np.asarray(a, float) for a in (u, v, h))
        return np.stack([u * c - v * s, u * s + v * c, z0 + h], 1)
    return f


def map_annulus(R, z0, th0=0.0):
    """Horizontal annulus: u = arc length at R, v = radial offset, h = up."""
    def f(u, v, h):
        th = th0 + np.asarray(u) / R
        r = R + np.asarray(v)
        return np.stack([r * np.cos(th), r * np.sin(th), z0 + np.asarray(h)], 1)
    return f


def map_plane(O, U, Vv, N):
    O, U, Vv, N = (np.asarray(a, float) for a in (O, U, Vv, N))

    def f(u, v, h):
        u, v, h = (np.asarray(a, float)[:, None] for a in (u, v, h))
        return O + u * U + v * Vv + h * N
    return f


def compose(mapfn, world_fn):
    """Relief mapfn in a block's local frame, then the block's mapping to world."""
    def f(u, v, h):
        return world_fn(mapfn(u, v, h))
    return f


# ----------------------------------------------------------------------------- chain
def chain_link(center, axis, pnorm, Lc=0.15, Wc=0.085, rw=0.017, npath=16, ntube=6, gap=False):
    """Stadium-shaped link.  axis: major axis dir, pnorm: link plane normal."""
    c = np.asarray(center, float)
    A = normalize(np.asarray(axis, float))
    Nn = normalize(np.asarray(pnorm, float))
    B = normalize(np.cross(Nn, A))
    rr = Wc / 2
    off = Lc / 2 - rr
    half = npath // 2
    pts = []
    tans = []
    for i in range(half):
        a = -math.pi / 2 + math.pi * i / (half - 1)
        pts.append((off + rr * math.cos(a), rr * math.sin(a)))
        tans.append((-math.sin(a), math.cos(a)))
    for i in range(half):
        a = math.pi / 2 + math.pi * i / (half - 1)
        pts.append((-off + rr * math.cos(a), rr * math.sin(a)))
        tans.append((-math.sin(a), math.cos(a)))
    pts = np.asarray(pts)
    tans = normalize(np.asarray(tans))
    n = len(pts)
    if gap:
        keep = list(range(2, n - 1))  # open link: drop a segment near the end
    else:
        keep = list(range(n))
    V = []
    for i in keep:
        p = c + A * pts[i, 0] + B * pts[i, 1]
        t = normalize(A * tans[i, 0] + B * tans[i, 1])
        out = normalize(np.cross(t, Nn))
        for k in range(ntube):
            ph = TAU * k / ntube
            V.append(p + rw * (math.cos(ph) * out + math.sin(ph) * Nn))
    V = np.asarray(V)
    m = len(keep)
    F = []
    segs = m if not gap else m - 1
    for i in range(segs):
        j = (i + 1) % m
        for k in range(ntube):
            k2 = (k + 1) % ntube
            F.append([i * ntube + k, i * ntube + k2, j * ntube + k2, j * ntube + k])
    if gap:
        F.append([k for k in range(ntube)][::-1])
        F.append([(m - 1) * ntube + k for k in range(ntube)])
    pc = Piece(V, F)
    pc.fix_orientation()
    return pc


def resample_polyline(P, step):
    P = np.asarray(P, float)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(s[-1] / step) + 1)
    ss = np.linspace(0, s[-1], n)
    out = np.stack([np.interp(ss, s, P[:, k]) for k in range(3)], 1)
    return out, ss


def chain_along(path_pts, Lc=0.15, Wc=0.085, rw=0.017, floor_fn=None, broken_end=False, twist0=0.0, rng=None,
                npath=12, ntube=5):
    """Place interlocking links along a 3D polyline. floor_fn(x,y)->z for links resting on ground."""
    pitch = Lc - 2 * rw - 0.006
    P, s = resample_polyline(path_pts, 0.01)
    total = s[-1]
    nlinks = max(1, int(total / pitch))
    pieces = []
    for i in range(nlinks):
        si = (i + 0.5) * pitch
        c = np.array([np.interp(si, s, P[:, k]) for k in range(3)])
        a0 = np.array([np.interp(max(si - pitch / 2, 0), s, P[:, k]) for k in range(3)])
        a1 = np.array([np.interp(min(si + pitch / 2, total), s, P[:, k]) for k in range(3)])
        T = normalize(a1 - a0)
        ref = np.array([0, 0, 1.0]) if abs(T[2]) < 0.9 else np.array([1.0, 0, 0])
        n1 = normalize(np.cross(T, ref))
        n2 = normalize(np.cross(T, n1))
        tw = twist0 + (rng.uniform(-12, 12) if rng is not None else 0.0)
        base = n1 if i % 2 == 0 else n2
        pn = rot_axis(T, tw) @ base
        lk = chain_link(c, T, pn, Lc, Wc, rw, npath=npath, ntube=ntube, gap=(broken_end and i == nlinks - 1))
        if floor_fn is not None:
            fz = floor_fn(c[0], c[1])
            mz = lk.V[:, 2].min()
            if mz < fz + 0.002 or c[2] < fz + Wc:
                lk.translate((0, 0, fz + 0.002 - mz))
        pieces.append(lk)
    return pieces


# ----------------------------------------------------------------------------- misc solids
def convex_hull_piece(points):
    """Convex hull of points via bmesh -> Piece (closed, outward)."""
    import bmesh
    import bpy  # noqa: F401
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    for g in res.get("geom_interior", []):
        if isinstance(g, bmesh.types.BMVert) and g.is_valid:
            bm.verts.remove(g)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bm.verts.index_update()
    V = np.array([v.co[:] for v in bm.verts])
    F = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    pc = Piece(V, F)
    pc.fix_orientation()
    return pc


def rubble_chunk(center, size, rng, seed=0, flat=0.6):
    """Irregular broken stone chunk: convex hull of jittered box corners + extra points."""
    sx, sy, sz = size
    pts = []
    for cx in (-1, 1):
        for cy in (-1, 1):
            for cz in (-1, 1):
                pts.append([cx * sx * rng.uniform(0.6, 1.0), cy * sy * rng.uniform(0.6, 1.0),
                            cz * sz * rng.uniform(0.6, 1.0)])
    for _ in range(6):
        d = normalize(rng.normal(0, 1, 3))
        pts.append(d * np.array([sx, sy, sz]) * rng.uniform(0.8, 1.05))
    pc = convex_hull_piece(pts)
    R = rot_euler(*rng.uniform(-25, 25, 2), rng.uniform(0, 360))
    pc.transform(M4(R))
    pc.translate(np.asarray(center, float))
    return pc


def sweep_sector(profile_rz, tha, thb, nseg, end_chamfer=0.008):
    """Revolve a closed (r,z) profile polygon between angles tha..thb (radians) with chamfered ends."""
    P = np.asarray(profile_rz, float)
    npf = len(P)
    cen = P.mean(0)
    size = np.linalg.norm(P - cen, axis=1).mean()
    rm = P[:, 0].mean()
    dc = end_chamfer / rm
    ths = [tha] + list(np.linspace(tha + dc, thb - dc, nseg + 1)) + [thb]
    V = []
    for i, th in enumerate(ths):
        Q = P if 0 < i < len(ths) - 1 else cen + (P - cen) * (1 - end_chamfer / max(size, 1e-3))
        for r, z in Q:
            V.append([r * math.cos(th), r * math.sin(th), z])
    F = []
    nr = len(ths)
    for i in range(nr - 1):
        for j in range(npf):
            j2 = (j + 1) % npf
            F.append([i * npf + j, i * npf + j2, (i + 1) * npf + j2, (i + 1) * npf + j])
    F.append([j for j in range(npf)][::-1])
    F.append([(nr - 1) * npf + j for j in range(npf)])
    pc = Piece(np.asarray(V), F)
    pc.fix_orientation()
    return pc


def rest_on(pc, z_floor, sink=0.0):
    pc.translate((0, 0, z_floor - pc.V[:, 2].min() - sink))
    return pc


def tri_count_piece(pc):
    return sum(len(f) - 2 for f in pc.F)
