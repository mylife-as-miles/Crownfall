"""Crownfall (Claude track) - numpy signed-distance-field modelling toolkit.

Build organic hero forms (skull, hand, terrain) as SDFs, sample them on a grid,
mesh them with naive Surface Nets, and hand the quads to Blender.

Conventions: metres, +Z up, inside < 0.  All point arrays are float32 (N,3).
Runs inside Blender's Python (numpy bundled) or plain Python (no bpy needed
except for `to_blender_mesh`).
"""
import math
import numpy as np

F32 = np.float32

# --------------------------------------------------------------------------
# Noise (vectorised 3D Perlin + fBm / ridged variants)
# --------------------------------------------------------------------------
_rng = np.random.default_rng(91173)
_PERM = np.tile(_rng.permutation(256).astype(np.int32), 2)
_GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
                  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]], F32)


def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin(P, seed=0):
    """3D gradient noise in roughly [-1,1]. P: (N,3)."""
    off = F32(seed * 17.13 + 3.7)
    x = P[:, 0] + off
    y = P[:, 1] + off * 1.31
    z = P[:, 2] + off * 0.77
    xi = np.floor(x).astype(np.int32)
    yi = np.floor(y).astype(np.int32)
    zi = np.floor(z).astype(np.int32)
    xf = (x - xi).astype(F32)
    yf = (y - yi).astype(F32)
    zf = (z - zi).astype(F32)
    xi &= 255
    yi &= 255
    zi &= 255
    xj = (xi + 1) & 255
    yj = (yi + 1) & 255
    zj = (zi + 1) & 255
    u, v, w = _fade(xf), _fade(yf), _fade(zf)

    def g(ix, iy, iz, dx, dy, dz):
        h = _PERM[_PERM[_PERM[ix] + iy] + iz] % 12
        gr = _GRAD[h]
        return gr[:, 0] * dx + gr[:, 1] * dy + gr[:, 2] * dz

    x1 = xf - 1
    y1 = yf - 1
    z1 = zf - 1
    n000 = g(xi, yi, zi, xf, yf, zf)
    n100 = g(xj, yi, zi, x1, yf, zf)
    n010 = g(xi, yj, zi, xf, y1, zf)
    n110 = g(xj, yj, zi, x1, y1, zf)
    n001 = g(xi, yi, zj, xf, yf, z1)
    n101 = g(xj, yi, zj, x1, yf, z1)
    n011 = g(xi, yj, zj, xf, y1, z1)
    n111 = g(xj, yj, zj, x1, y1, z1)
    nx00 = n000 + u * (n100 - n000)
    nx10 = n010 + u * (n110 - n010)
    nx01 = n001 + u * (n101 - n001)
    nx11 = n011 + u * (n111 - n011)
    nxy0 = nx00 + v * (nx10 - nx00)
    nxy1 = nx01 + v * (nx11 - nx01)
    return (nxy0 + w * (nxy1 - nxy0)).astype(F32)


def fbm(P, freq=1.0, octaves=4, lacunarity=2.0, gain=0.5, seed=0):
    """Fractal Brownian motion, roughly [-1,1]."""
    total = np.zeros(len(P), F32)
    amp, f, norm = 1.0, freq, 0.0
    for o in range(octaves):
        total += F32(amp) * perlin(P * F32(f), seed + o * 31)
        norm += amp
        amp *= gain
        f *= lacunarity
    return total / F32(norm)


def ridged(P, freq=1.0, octaves=4, lacunarity=2.0, gain=0.5, seed=0):
    """Ridged multifractal in [0,1]; sharp creases at 1 (use for cracks/erosion)."""
    total = np.zeros(len(P), F32)
    amp, f, norm = 1.0, freq, 0.0
    for o in range(octaves):
        n = 1.0 - np.abs(perlin(P * F32(f), seed + o * 57))
        total += F32(amp) * n * n
        norm += amp
        amp *= gain
        f *= lacunarity
    return total / F32(norm)


def warp(P, amount=0.1, freq=1.0, seed=0, octaves=2):
    """Domain warp: returns displaced copy of P (organic irregularity)."""
    d = np.stack([fbm(P, freq, octaves, seed=seed + 101),
                  fbm(P, freq, octaves, seed=seed + 202),
                  fbm(P, freq, octaves, seed=seed + 303)], axis=1)
    return (P + F32(amount) * d).astype(F32)


# --------------------------------------------------------------------------
# Transforms
# --------------------------------------------------------------------------
def rot_matrix(rx=0.0, ry=0.0, rz=0.0):
    """XYZ Euler (degrees) -> 3x3 matrix (same convention as Blender XYZ)."""
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return (Rz @ Ry @ Rx).astype(F32)


def to_local(P, center=(0, 0, 0), R=None, scale=None):
    """World points -> primitive local frame (inverse of translate*rotate*scale)."""
    Q = P - np.asarray(center, F32)
    if R is not None:
        Q = Q @ R  # row-vector * R == R^T * column  (inverse rotation)
    if scale is not None:
        Q = Q / np.asarray(scale, F32)
    return Q.astype(F32)


# --------------------------------------------------------------------------
# Primitives (exact or good bounds)
# --------------------------------------------------------------------------
def length(Q):
    return np.sqrt(np.einsum('ij,ij->i', Q, Q)).astype(F32)


def sphere(P, c, r):
    return length(P - np.asarray(c, F32)) - F32(r)


def ellipsoid(P, c, radii, R=None):
    Q = to_local(P, c, R)
    r = np.asarray(radii, F32)
    k0 = length(Q / r)
    k1 = length(Q / (r * r))
    return (k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)).astype(F32)


def box(P, c, half, R=None, round_r=0.0):
    Q = np.abs(to_local(P, c, R)) - (np.asarray(half, F32) - F32(round_r))
    outside = length(np.maximum(Q, 0))
    inside = np.minimum(np.max(Q, axis=1), 0)
    return (outside + inside - F32(round_r)).astype(F32)


def capsule(P, a, b, r):
    a = np.asarray(a, F32)
    b = np.asarray(b, F32)
    pa = P - a
    ba = b - a
    h = np.clip((pa @ ba) / F32(ba @ ba), 0, 1)
    return length(pa - h[:, None] * ba) - F32(r)


def round_cone(P, a, b, r1, r2):
    """Tapered capsule from a (radius r1) to b (radius r2). iq's exact sdRoundCone."""
    a = np.asarray(a, F32)
    b = np.asarray(b, F32)
    ba = b - a
    l2 = F32(ba @ ba)
    rr = F32(r1 - r2)
    a2 = l2 - rr * rr
    il2 = F32(1.0 / l2)
    pa = P - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - y[:, None] * ba
    x2 = np.einsum('ij,ij->i', xv, xv)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d = np.empty(len(P), F32)
    m1 = np.sign(z) * a2 * z2 > k
    m2 = (~m1) & (np.sign(y) * a2 * y2 < k)
    m3 = ~(m1 | m2)
    d[m1] = np.sqrt(x2[m1] + z2[m1]) * il2 - r2
    d[m2] = np.sqrt(x2[m2] + y2[m2]) * il2 - r1
    d[m3] = (np.sqrt(x2[m3] * a2 * il2) + y[m3] * rr) * il2 - r1
    return d


def torus(P, c, R_major, r_minor, R=None):
    Q = to_local(P, c, R)
    qx = np.sqrt(Q[:, 0] ** 2 + Q[:, 1] ** 2) - F32(R_major)
    return (np.sqrt(qx * qx + Q[:, 2] ** 2) - F32(r_minor)).astype(F32)


def plane(P, normal=(0, 0, 1), offset=0.0):
    n = np.asarray(normal, F32)
    n = n / np.linalg.norm(n)
    return (P @ n - F32(offset)).astype(F32)


def cylinder_z(P, c, r, half_h, R=None):
    Q = to_local(P, c, R)
    d0 = np.sqrt(Q[:, 0] ** 2 + Q[:, 1] ** 2) - F32(r)
    d1 = np.abs(Q[:, 2]) - F32(half_h)
    out = np.sqrt(np.maximum(d0, 0) ** 2 + np.maximum(d1, 0) ** 2)
    return (out + np.minimum(np.maximum(d0, d1), 0)).astype(F32)


def polyline_tube(P, pts, radii):
    """Smoothly varying tube along a polyline (union of round cones)."""
    d = None
    for i in range(len(pts) - 1):
        di = round_cone(P, pts[i], pts[i + 1], radii[i], radii[i + 1])
        d = di if d is None else np.minimum(d, di)
    return d


# --------------------------------------------------------------------------
# Boolean operators (polynomial smooth versions)
# --------------------------------------------------------------------------
def union(a, b):
    return np.minimum(a, b)


def subtract(a, b):
    return np.maximum(a, -b)


def intersect(a, b):
    return np.maximum(a, b)


def smin(a, b, k):
    k = F32(max(k, 1e-6))
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return (b + (a - b) * h - k * h * (1 - h)).astype(F32)


def smax(a, b, k):
    return -smin(-a, -b, k)


def ssub(a, b, k):
    """Smooth subtraction a - b."""
    return smax(a, -b, k)


# --------------------------------------------------------------------------
# Grid sampling + Surface Nets meshing
# --------------------------------------------------------------------------
def sample_grid(sdf_fn, bmin, bmax, voxel, slab=24, verbose=True):
    """Evaluate sdf_fn(P)->d on a regular grid. Returns (F, origin, voxel).

    Grid is padded by 2 voxels so closed shapes stay closed.  Evaluated in
    z-slabs to bound memory (keep total grid <= ~220^3 on this machine).
    """
    bmin = np.asarray(bmin, F32) - 2 * voxel
    bmax = np.asarray(bmax, F32) + 2 * voxel
    n = np.ceil((bmax - bmin) / voxel).astype(int) + 1
    nx, ny, nz = (int(v) for v in n)
    if verbose:
        print(f"[cf_sdf] grid {nx}x{ny}x{nz} = {nx*ny*nz/1e6:.2f}M samples, voxel {voxel*1000:.1f} mm", flush=True)
    xs = (bmin[0] + np.arange(nx) * voxel).astype(F32)
    ys = (bmin[1] + np.arange(ny) * voxel).astype(F32)
    zs = (bmin[2] + np.arange(nz) * voxel).astype(F32)
    F = np.empty((nx, ny, nz), F32)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    X = X.ravel()
    Y = Y.ravel()
    for z0 in range(0, nz, slab):
        z1 = min(nz, z0 + slab)
        cnt = z1 - z0
        P = np.empty((len(X) * cnt, 3), F32)
        P[:, 0] = np.repeat(X[:, None], cnt, axis=1).ravel()
        P[:, 1] = np.repeat(Y[:, None], cnt, axis=1).ravel()
        P[:, 2] = np.tile(zs[z0:z1], len(X))
        F[:, :, z0:z1] = sdf_fn(P).reshape(nx, ny, cnt)
    return F, bmin, F32(voxel)


_CORNERS = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
                     [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], F32)
_EDGES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def surface_nets(F, origin, voxel):
    """Naive Surface Nets. Returns verts (M,3) float32 and quads (K,4) int, outward-wound."""
    nx, ny, nz = F.shape
    c = [F[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz]
         for dz in (0, 1) for dy in (0, 1) for dx in (0, 1)]  # index = dx + 2dy + 4dz
    ins = np.zeros(c[0].shape, np.uint8)
    for i, ci in enumerate(c):
        ins |= ((ci < 0).astype(np.uint8) << i)
    active = (ins != 0) & (ins != 255)
    idx = np.argwhere(active)
    vid = -np.ones(active.shape, np.int64)
    vid[active] = np.arange(len(idx))
    vals = np.stack([ci[active] for ci in c], axis=1)
    acc = np.zeros((len(idx), 3), F32)
    cnt = np.zeros(len(idx), F32)
    for a, b in _EDGES:
        va, vb = vals[:, a], vals[:, b]
        m = (va < 0) != (vb < 0)
        t = np.where(m, va / np.where(m, va - vb, 1), 0).astype(F32)
        p = _CORNERS[a][None, :] + t[:, None] * (_CORNERS[b] - _CORNERS[a])[None, :]
        acc[m] += p[m]
        cnt[m] += 1
    verts = (idx.astype(F32) + acc / np.maximum(cnt, 1)[:, None]) * voxel + origin
    inside = F < 0
    quads = []
    # x-edges
    s0 = inside[:-1, 1:-1, 1:-1]
    s1 = inside[1:, 1:-1, 1:-1]
    i, j, k = np.nonzero(s0 != s1)
    j = j + 1
    k = k + 1
    q = np.stack([vid[i, j - 1, k - 1], vid[i, j, k - 1], vid[i, j, k], vid[i, j - 1, k]], 1)
    flip = ~s0[i, j - 1, k - 1]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    # y-edges
    s0 = inside[1:-1, :-1, 1:-1]
    s1 = inside[1:-1, 1:, 1:-1]
    i, j, k = np.nonzero(s0 != s1)
    i = i + 1
    k = k + 1
    q = np.stack([vid[i - 1, j, k - 1], vid[i - 1, j, k], vid[i, j, k], vid[i, j, k - 1]], 1)
    flip = ~s0[i - 1, j, k - 1]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    # z-edges
    s0 = inside[1:-1, 1:-1, :-1]
    s1 = inside[1:-1, 1:-1, 1:]
    i, j, k = np.nonzero(s0 != s1)
    i = i + 1
    j = j + 1
    q = np.stack([vid[i - 1, j - 1, k], vid[i, j - 1, k], vid[i, j, k], vid[i - 1, j, k]], 1)
    flip = ~s0[i - 1, j - 1, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    quads = np.concatenate(quads, 0)
    quads = quads[(quads >= 0).all(1)]
    return verts.astype(F32), quads.astype(np.int32)


def mesh_sdf(sdf_fn, bmin, bmax, voxel, verbose=True):
    F, origin, vx = sample_grid(sdf_fn, bmin, bmax, voxel, verbose=verbose)
    v, q = surface_nets(F, origin, vx)
    if verbose:
        print(f"[cf_sdf] surface nets: {len(v)} verts, {len(q)} quads", flush=True)
    return v, q


# --------------------------------------------------------------------------
# Blender bridge
# --------------------------------------------------------------------------
def to_blender_mesh(name, verts, quads, collection=None, smooth=True):
    """Create a Blender mesh object from Surface-Nets output (fast foreach_set path)."""
    import bpy
    me = bpy.data.meshes.new(name + "_Mesh")
    nv, nf = len(verts), len(quads)
    me.vertices.add(nv)
    me.vertices.foreach_set("co", np.ascontiguousarray(verts, F32).ravel())
    me.loops.add(nf * 4)
    me.loops.foreach_set("vertex_index", np.ascontiguousarray(quads, np.int32).ravel())
    me.polygons.add(nf)
    me.polygons.foreach_set("loop_start", np.arange(0, nf * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob
