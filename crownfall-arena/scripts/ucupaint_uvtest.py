"""Debug: why did smart_project not unwrap headless?  python lib/run_blender.py scripts/ucupaint_uvtest.py"""
import sys, os, math, time, traceback
import bpy
import numpy as np
CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CL, "scripts"))
import ucupaint_lib as UL

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
SRC = os.path.join(CL, "assets", "CFCL_Hero_Skull", "CFCL_Hero_Skull_v006.blend")
with bpy.data.libraries.load(SRC, link=False) as (src, dst):
    dst.objects = ["CFCL_Hero_Skull", "CFCL_Hero_Skull_Mandible"]
objs = []
for o in dst.objects:
    bpy.context.scene.collection.objects.link(o)
    objs.append(o)
for o in objs:
    print("OBJ", o.name, "uv_layers", [(u.name, u.active, u.active_render) for u in o.data.uv_layers],
          "polys", len(o.data.polygons), "mode", o.mode, "scale", tuple(o.scale), "loc", tuple(o.location))
    if len(o.data.uv_layers):
        uv = np.empty(len(o.data.loops) * 2, np.float32)
        o.data.uv_layers[0].data.foreach_get("uv", uv)
        print("  uv range", uv.reshape(-1, 2).min(0), uv.reshape(-1, 2).max(0))


def stats(tag):
    for o in objs:
        uvl = o.data.uv_layers.get("UVMap")
        uv = np.empty(len(o.data.loops) * 2, np.float32)
        uvl.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        print(tag, o.name, "range", uv.min(0), uv.max(0), UL.texel_stats([o], 4096))


for o in objs:
    me = o.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    me.uv_layers.active = uvl
stats("BEFORE")

import bmesh
from bpy_extras import bmesh_utils
def islands(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv.active
    n = len(bmesh_utils.bmesh_linked_uv_islands(bm, uvl)); bm.free(); return n
def comps(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    seen=set(); n=0
    for v in bm.verts:
        if v.index in seen: continue
        n+=1; st=[v]; seen.add(v.index)
        while st:
            x=st.pop()
            for e in x.link_edges:
                w=e.other_vert(x)
                if w.index not in seen: seen.add(w.index); st.append(w)
    bm.free(); return n
for o in objs: print("COMPONENTS", o.name, comps(o))
UL.set_active(objs[0], objs)

def lap_smooth(o, iters, fac=0.5):
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3).astype(np.float64)
    e = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", e); e = e.reshape(-1, 2)
    cnt = np.maximum(np.bincount(e[:, 0], minlength=n) + np.bincount(e[:, 1], minlength=n), 1)[:, None]
    orig = co.copy()
    for _ in range(iters):
        acc = np.zeros_like(co)
        for k in range(3):
            acc[:, k] = np.bincount(e[:, 0], weights=co[e[:, 1], k], minlength=n) + np.bincount(e[:, 1], weights=co[e[:, 0], k], minlength=n)
        co = co + fac * (acc / cnt - co)
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.update()
    return orig

for dirs, ms, meth in (("14", 250, "MINIMUM_STRETCH"), ("cube", 250, "MINIMUM_STRETCH")):
    t = time.time()
    info = UL.chart_unwrap(objs, dirs=dirs, min_faces=ms, method=meth)
    print("CHART", dirs, ms, meth, info, "islands", [UL.uv_islands(o) for o in objs], "secs", round(time.time() - t, 1),
          UL.texel_stats(objs, 4096), UL.stretch_stats(objs), flush=True)
raise SystemExit
def winding(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bad = 0; man = 0; nonman = 0; sharp = 0
    for e in bm.edges:
        if len(e.link_faces) == 2:
            man += 1
            l0 = e.link_loops[0]; l1 = e.link_loops[1]
            if l0.vert == l1.vert: bad += 1
        else: nonman += 1
        if not e.smooth: sharp += 1
    bm.free(); return dict(inconsistent=bad, manifold=man, nonmanifold=nonman, sharp=sharp)
for o in objs: print("WINDING", o.name, winding(o), "custom_normals", o.data.has_custom_normals)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.mesh.mark_sharp(clear=True)
bpy.ops.mesh.mark_seam(clear=True)
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0,
                         correct_aspect=True, scale_to_bounds=False, margin_method="FRACTION")
bpy.ops.object.mode_set(mode="OBJECT")
for o in objs: print("WINDING_AFTER", o.name, winding(o))
print("CONSISTENT islands", [islands(o) for o in objs], UL.texel_stats(objs, 4096))
raise SystemExit
for iters, ang, method in ((25, 66, "ANGLE_BASED"), (60, 66, "ANGLE_BASED"), (60, 70, "CONFORMAL")):
    t = time.time()
    origs = [lap_smooth(o, iters) for o in objs]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(ang), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False, margin_method="FRACTION")
    bpy.ops.object.mode_set(mode="OBJECT")
    n_sm = [islands(o) for o in objs]
    for o, oc in zip(objs, origs):
        o.data.vertices.foreach_set("co", oc.astype(np.float32).ravel()); o.data.update()
    t1 = time.time() - t
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.seams_from_islands(mark_seams=True, mark_sharp=False)
    bpy.ops.uv.unwrap(method=method, fill_holes=True, correct_aspect=True, margin_method="FRACTION", margin=0.0)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=0.003, pin=False, shape_method="CONCAVE")
    if iters == 60 and method == "ANGLE_BASED":
        try:
            bpy.ops.uv.export_layout(filepath=os.path.join(CL, "renders", "ucupaint", "_probe", "uv_skull.png"),
                                     size=(1024, 1024), opacity=0.3, mode="PNG", export_all=True)
        except Exception as ex:
            print("export_layout fail", ex)
    bpy.ops.object.mode_set(mode="OBJECT")
    print("SMOOTH", iters, "ang", ang, method, "islands_smooth", n_sm, "islands_final", [islands(o) for o in objs],
          "secs", round(t1, 1), round(time.time() - t, 1), UL.texel_stats(objs, 4096))
raise SystemExit
UL.set_active(objs[0], objs)
for ang, marg, pack in ((60, 0.0035, None), (80, 0.0, "CONCAVE"), (89, 0.0, "CONCAVE"), (89, 0.0, "AABB")):
    t = time.time()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(ang), island_margin=marg, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False, margin_method="FRACTION")
    t1 = time.time() - t
    if pack:
        bpy.ops.uv.select_all(action="SELECT")
        try:
            bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                                    merge_overlap=False, margin_method="FRACTION", margin=0.0025,
                                    pin=False, shape_method=pack)
        except Exception:
            traceback.print_exc()
    bpy.ops.object.mode_set(mode="OBJECT")
    print("ANG", ang, "marg", marg, "pack", pack, "smart_s", round(t1, 1), "total_s", round(time.time() - t, 1),
          "islands", [islands(o) for o in objs], UL.texel_stats(objs, 4096))
