"""Crownfall (Claude track) - shared helpers for the TERRAIN scripts (terrain_*.py).

Only used by terrain_* scripts.  Runs inside Blender (via lib/run_blender.py).
"""
import os
import sys
import json
import math
import time

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
for p in (os.path.join(CL, "lib"), os.path.join(CL, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler
import cf_sdf as S
import cf_materials as M
import cf_render as R

F32 = np.float32
ASSETS = os.path.join(CL, "assets")
RENDERS = os.path.join(CL, "renders", "terrain")


def get_args():
    argv = sys.argv
    a = argv[argv.index("--") + 1:] if "--" in argv else []
    d = {}
    i = 0
    while i < len(a):
        if a[i].startswith("--"):
            k = a[i][2:]
            if i + 1 < len(a) and not a[i + 1].startswith("--"):
                d[k] = a[i + 1]
                i += 2
            else:
                d[k] = True
                i += 1
        else:
            i += 1
    return d


def log(*a):
    print("[terrain]", *a, flush=True)


def new_collection(name, parent=None):
    col = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(col)
    return col


def mesh_obj(name, verts, faces, col=None, smooth=True, sharp_angle=None, recalc=True):
    """verts (N,3); faces: list of index sequences (mixed sizes ok) or (K,n) int array."""
    verts = np.ascontiguousarray(np.asarray(verts, F32))
    if isinstance(faces, np.ndarray):
        flat = faces.astype(np.int32).ravel()
        sizes = np.full(len(faces), faces.shape[1], np.int32)
    else:
        sizes = np.array([len(f) for f in faces], np.int32)
        flat = np.concatenate([np.asarray(f, np.int32) for f in faces]) if len(faces) else np.zeros(0, np.int32)
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
    me = bpy.data.meshes.new(name + "_Mesh")
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(len(flat))
    me.loops.foreach_set("vertex_index", flat)
    me.polygons.add(len(sizes))
    me.polygons.foreach_set("loop_start", starts)
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if recalc:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    shade(ob, smooth, sharp_angle)
    return ob


def shade(ob, smooth=True, sharp_angle=None):
    me = ob.data
    if smooth:
        try:
            me.shade_smooth()
        except Exception:
            for p in me.polygons:
                p.use_smooth = True
        if sharp_angle is not None:
            try:
                me.set_sharp_from_angle(angle=math.radians(sharp_angle))
            except Exception as e:
                log("set_sharp_from_angle failed", e)
    else:
        for p in me.polygons:
            p.use_smooth = False


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me2
    me2.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def decimate_to(ob, target_tris):
    t = R.tri_count([ob])
    if t <= target_tris:
        return t
    mod = ob.modifiers.new("dec", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = max(0.01, min(1.0, target_tris / t * 0.985))
    try:
        mod.use_collapse_triangulate = True
    except Exception:
        pass
    apply_modifiers(ob)
    return R.tri_count([ob])


def sdf_object(name, fn, bmin, bmax, voxel, col=None, target_tris=None, sharp_angle=50):
    t0 = time.time()
    v, q = S.mesh_sdf(fn, bmin, bmax, voxel)
    ob = mesh_obj(name, v, q, col, smooth=True, sharp_angle=None, recalc=False)
    if target_tris:
        decimate_to(ob, target_tris)
    shade(ob, True, sharp_angle)
    log(f"{name}: sdf mesh {time.time() - t0:.1f}s, tris {R.tri_count([ob])}")
    return ob


def keep_largest_part(ob, min_frac=0.0):
    """Delete loose parts smaller than the largest (removes SDF specks)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    parts = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        parts.append(comp)
    parts.sort(key=len, reverse=True)
    biggest = len(parts[0]) if parts else 0
    kill = []
    for comp in parts[1:]:
        if len(comp) < max(biggest * min_frac, 1) or min_frac == 0.0:
            kill.extend(comp)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    return len(parts)


def drop_small_parts(ob, min_verts=60):
    """Remove loose parts with fewer than min_verts vertices."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    seen = set()
    kill = []
    nparts = 0
    for v in bm.verts:
        if v.index in seen:
            continue
        nparts += 1
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        if len(comp) < min_verts:
            kill.extend(comp)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    return nparts


def set_origin(ob, world_point):
    """Move object origin to world_point without moving geometry."""
    wp = Vector(world_point)
    local = ob.matrix_world.inverted() @ wp
    ob.data.transform(Matrix.Translation(-local))
    ob.matrix_world = ob.matrix_world @ Matrix.Translation(local)


def obj_info(ob):
    mn, mx = R.bounds([ob])
    return {
        "name": ob.name,
        "dims": [round(mx.x - mn.x, 3), round(mx.y - mn.y, 3), round(mx.z - mn.z, 3)],
        "bounds_min": [round(mn.x, 3), round(mn.y, 3), round(mn.z, 3)],
        "bounds_max": [round(mx.x, 3), round(mx.y, 3), round(mx.z, 3)],
        "location": [round(c, 4) for c in ob.location],
        "tris": R.tri_count([ob]),
        "materials": [m.name for m in ob.data.materials if m],
    }


def next_version_path(asset, want=None):
    d = os.path.join(ASSETS, asset)
    os.makedirs(d, exist_ok=True)
    v = int(want) if want else 1
    while os.path.exists(os.path.join(d, f"{asset}_v{v:03d}.blend")):
        v += 1
    return os.path.join(d, f"{asset}_v{v:03d}.blend"), v


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True, compress=True)
    log("SAVED", path)


def latest_blend(asset):
    d = os.path.join(ASSETS, asset)
    if not os.path.isdir(d):
        return None
    fs = sorted(f for f in os.listdir(d) if f.startswith(asset + "_v") and f.endswith(".blend"))
    return os.path.join(d, fs[-1]) if fs else None


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def hide_all_but(keep, objs):
    for o in objs:
        o.hide_render = o not in keep
        o.hide_viewport = o not in keep


def preview_ground(z=0.0, radius=200.0, name="CFCL_PreviewGround"):
    if name in bpy.data.objects:
        return bpy.data.objects[name]
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=radius, fill_type="NGON", location=(0, 0, z))
    g = bpy.context.active_object
    g.name = name
    M.assign(g, "Basalt")   # never pass kwargs: that rebuilds (and unlinks) the shared material
    return g


def human_proxy(loc=(0, 0, 0), col=None, name="CFCL_ScaleHuman_1p8m"):
    """1.8 m human-height capsule for scale reading (render-only, never saved in assets)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.22, depth=1.8, location=(loc[0], loc[1], loc[2] + 0.9))
    o = bpy.context.active_object
    o.name = name
    mat = bpy.data.materials.get("CFCL_ScaleProxy") or bpy.data.materials.new("CFCL_ScaleProxy")
    mat.diffuse_color = (0.8, 0.1, 0.1, 1)
    try:
        mat.use_nodes = True
        b = mat.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (0.75, 0.08, 0.06, 1)
    except Exception:
        pass
    o.data.materials.append(mat)
    return o


# ------------------------------------------------------------------ small geometry helpers
def convex_shard(rng, size, squash=(1.0, 0.8, 0.55), npts=14, sharp=True):
    """Random faceted rock shard (convex hull of jittered points). Returns verts, faces (lists)."""
    p = rng.normal(size=(npts, 3))
    p /= np.linalg.norm(p, axis=1, keepdims=True)
    p *= rng.uniform(0.65, 1.0, (npts, 1))
    p *= np.asarray(squash) * size * 0.5
    bm = bmesh.new()
    for c in p:
        bm.verts.new(c.tolist())
    res = bmesh.ops.convex_hull(bm, input=bm.verts, use_existing_faces=False)
    # remove interior/unused geometry
    unused = [g for g in res.get("geom_unused", []) if isinstance(g, bmesh.types.BMVert)]
    if unused:
        bmesh.ops.delete(bm, geom=unused, context='VERTS')
    bm.verts.index_update()
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return np.array([[v.x, v.y, v.z] for v in verts], F32), faces


def rot3(rx, ry, rz):
    return np.asarray(S.rot_matrix(rx, ry, rz), F32)


class MeshAcc:
    """Accumulate several (verts, faces) parts into one mesh."""

    def __init__(self):
        self.v = []
        self.f = []
        self.n = 0
        self.tags = []

    def add(self, verts, faces, tag=0):
        verts = np.asarray(verts, F32)
        for fc in faces:
            self.f.append([int(i) + self.n for i in fc])
            self.tags.append(tag)
        self.v.append(verts)
        self.n += len(verts)

    def verts(self):
        return np.concatenate(self.v, 0) if self.v else np.zeros((0, 3), F32)


def block_chunk(rng, size, dims=None, ncut=None):
    """Angular fractured block: a box cleaved by 2-5 random planes (crisp planar faces)."""
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


def assign_two_materials(ob, base="Basalt", top="AncientStone", up=0.6, zmin=None):
    """Slot 0 = base, slot 1 = top; faces whose normal points up (and above zmin) get the top material."""
    me = ob.data
    me.materials.clear()
    me.materials.append(M.get(base))
    me.materials.append(M.get(top))
    n = len(me.polygons)
    nrm = np.zeros(n * 3, F32)
    me.polygons.foreach_get("normal", nrm)
    ctr = np.zeros(n * 3, F32)
    me.polygons.foreach_get("center", ctr)
    nrm = nrm.reshape(-1, 3)
    ctr = ctr.reshape(-1, 3)
    m = nrm[:, 2] > up
    if zmin is not None:
        m &= ctr[:, 2] > zmin
    me.polygons.foreach_set("material_index", m.astype(np.int32))
    return int(m.sum())
