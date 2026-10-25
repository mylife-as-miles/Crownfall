"""Material-ball sheets for cf_materials (surface agent).

Usage:  python lib/run_blender.py scripts/cfcl_mat_sheet.py --timeout 1800 -- --lib dev --iter 01 [--fast]
Renders (renders/CFCL_Materials/iterNN_*):
  rowA1/A2/B1/B2/B3 : sphere + broken block + cylinder per material under cf_render lights (lava bounce off)
  albedo_*          : same rows, Base Color routed to emission, Standard view -> measured albedo
  close_*           : close-ups (basalt, ancient stone, bone stone, moss, bark)
  lava_far / lava_close
Writes renders/CFCL_Materials/iterNN_cells.json (pixel rects per material) for the stats script.
"""
import sys
import os
import math
import json
import time

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
import numpy as np
from mathutils import Vector
import cf_sdf as S
import cf_render as R

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
    return default


LIB = arg("--lib", "dev")
IT = arg("--iter", "01")
FAST = bool(arg("--fast", False))
if LIB == "dev":
    import cf_materials_dev as M
else:
    import cf_materials as M
OUT = os.path.join(CL, "renders", "CFCL_Materials")
os.makedirs(OUT, exist_ok=True)
t0 = time.time()

R.reset_scene()
sc = bpy.context.scene
R.setup_render(sc, "EEVEE", (1280, 720), 32 if FAST else 48)
R.setup_world(sc)
R.standard_lights(3.0, lava=False)

# ---------------------------------------------------------------- base meshes
def broken_block():
    def f(P):
        Q = S.warp(P, 0.015, 3.0, seed=11)
        d = S.box(Q, (0, 0, 0.30), (0.38, 0.30, 0.30), round_r=0.025)
        # fractured corner: warped plane cut
        n = np.array([0.62, -0.55, 0.56], np.float32)
        n /= np.linalg.norm(n)
        pl = (Q - np.array([0.30, -0.22, 0.52], np.float32)) @ n + 0.025 * S.fbm(P, 7.0, 3, seed=4)
        d = S.smax(d, pl, 0.01)
        # chips along edges
        for c, r in (((-0.38, -0.30, 0.45), 0.07), ((0.38, 0.30, 0.6), 0.09), ((-0.2, 0.30, 0.0), 0.06),
                     ((0.1, -0.30, 0.6), 0.05)):
            d = S.ssub(d, S.sphere(Q, c, r), 0.01)
        d = d + 0.006 * S.ridged(P, 9.0, 3, seed=2) - 0.003
        return d
    v, q = S.mesh_sdf(f, (-0.45, -0.38, -0.02), (0.45, 0.38, 0.65), 0.011, verbose=False)
    ob = S.to_blender_mesh("BB_proto", v, q)
    return ob


def sphere(r=0.42):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=r)
    ob = bpy.context.active_object
    bpy.ops.object.shade_smooth()
    return ob


def cylinder(r=0.2, h=1.1):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=h, location=(0, 0, h / 2))
    ob = bpy.context.active_object
    mod = ob.modifiers.new("bev", "BEVEL")
    mod.width = 0.02
    mod.segments = 3
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    me.shade_smooth()
    return ob


protos = {"block": broken_block(), "sphere": sphere(), "cyl": cylinder()}
for p in protos.values():
    p.location = (0, 0, -50)
    p.hide_render = True
    M.bake_curvature(p)

ground = None


def make_ground():
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 4, 0))
    g = bpy.context.active_object
    g.name = "SheetGround"
    gm = bpy.data.materials.new("SheetGround")
    gm.use_nodes = True
    b = gm.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.025, 0.025, 0.024, 1)
    b.inputs["Roughness"].default_value = 0.9
    g.data.materials.append(gm)
    return g


ground = make_ground()


def place_cell(matname, x0, row_col, kw=None):
    mat = M.get(matname, **(kw or {}))
    objs = []
    for key, loc, rot in (("sphere", (x0 - 0.52, -0.1, 0.42), 0), ("block", (x0 + 0.42, 0.05, 0.0), 25),
                          ("cyl", (x0 - 0.05, 0.75, 0.0), 0)):
        src = protos[key]
        ob = bpy.data.objects.new(f"{matname}_{key}", src.data.copy())
        row_col.objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (0, 0, math.radians(rot))
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        objs.append(ob)
    return objs


def cam_rect(cam, objs):
    from bpy_extras.object_utils import world_to_camera_view
    xs, ys = [], []
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            p = world_to_camera_view(sc, cam, w)
            xs.append(p.x)
            ys.append(p.y)
    W, H = sc.render.resolution_x, sc.render.resolution_y
    x0, x1 = max(0, min(xs)) * W, min(1, max(xs)) * W
    y0, y1 = (1 - min(1, max(ys))) * H, (1 - max(0, min(ys))) * H
    return [int(x0), int(y0), int(x1), int(y1)]


def albedo_copy(mat):
    am = mat.copy()
    am.name = "ALB_" + mat.name
    nt = am.node_tree
    out = [n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial"][0]
    bs = [n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"][0]
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    bc = bs.inputs["Base Color"]
    if bc.is_linked:
        nt.links.new(bc.links[0].from_socket, em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = bc.default_value
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return am


cells = {}
ROWS = [
    ("A1", ["Basalt", "AncientStone", "BoneStone", "HandStone"]),
    ("A2", ["Lava", "LavaCrust", "Bronze", "Bark"]),
    ("B1", ["Moss", "MossDry", "Root", "Fungus"]),
    ("B2", ["Fern", "CrimsonLeaf", "Vine", "Sedge"]),
]
cam = R.camera("SheetCam", (0, -6.3, 1.9), (0, 0.25, 0.42), 30.0)
sc.camera = cam
for row, mats in ROWS:
    col = bpy.data.collections.new("Row_" + row)
    sc.collection.children.link(col)
    allobjs = {}
    for i, mn in enumerate(mats):
        x0 = (i - 1.5) * 1.95
        allobjs[mn] = place_cell(mn, x0, col)
    R.render_to(os.path.join(OUT, f"iter{IT}_row{row}.png"), cam)
    for mn, objs in allobjs.items():
        cells[f"{row}:{mn}"] = cam_rect(cam, objs)
    # albedo pass: emission of base colour, Standard view, transparent film
    vs = sc.view_settings
    prev = (vs.view_transform, vs.look, sc.render.film_transparent)
    vs.view_transform = "Standard"
    try:
        vs.look = "None"
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    ground.hide_render = True
    swaps = []
    for mn, objs in allobjs.items():
        for o in objs:
            m0 = o.data.materials[0]
            o.data.materials[0] = albedo_copy(m0)
            swaps.append((o, m0))
    R.render_to(os.path.join(OUT, f"iter{IT}_albedo_{row}.png"), cam)
    for o, m0 in swaps:
        o.data.materials[0] = m0
    vs.view_transform = prev[0]
    try:
        vs.look = prev[1]
    except Exception:
        pass
    sc.render.film_transparent = prev[2]
    sc.render.image_settings.color_mode = "RGB"
    ground.hide_render = False
    # close-ups for the first three materials of row A1 and B1
    if row in ("A1", "B1") and not FAST:
        for mn in mats[:3]:
            o = allobjs[mn][1]  # block
            tgt = o.location + Vector((0, 0, 0.32))
            c2 = R.camera("Close_" + mn, tgt + Vector((-0.75, -1.25, 0.55)), tgt + Vector((0, 0, -0.08)), 45.0)
            R.render_to(os.path.join(OUT, f"iter{IT}_close_{mn}.png"), c2)
    col.hide_render = True
    for o in col.objects:
        o.hide_render = True

# ---------------------------------------------------------------- lava
for o in sc.objects:
    if o.type == "MESH":
        o.hide_render = True
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 12, -0.02))
lp = bpy.context.active_object
lp.name = "LavaPlane"
M.assign(lp, "Lava")
bpy.ops.mesh.primitive_plane_add(size=8, location=(-7, 4, 0.0))
lc = bpy.context.active_object
M.assign(lc, "LavaCrust")
# a dark basalt bank to judge glow against rock
bpy.ops.mesh.primitive_cube_add(size=1, location=(4.5, 6, 0.6))
bank = bpy.context.active_object
bank.scale = (2.5, 3, 0.7)
M.assign(bank, "Basalt")
cl = R.camera("LavaFar", (0, -6, 9), (0, 12, 0), 35.0)
R.render_to(os.path.join(OUT, f"iter{IT}_lava_far.png"), cl)
cl2 = R.camera("LavaClose", (1.5, 4.2, 2.2), (2.5, 8.0, 0), 40.0)
R.render_to(os.path.join(OUT, f"iter{IT}_lava_close.png"), cl2)
cells["lava_far"] = [0, 0, 1280, 720]

R.write_json(os.path.join(OUT, f"iter{IT}_cells.json"), {"cells": cells, "lib": LIB, "iter": IT,
                                                       "time_s": round(time.time() - t0, 1)})
print("[mat_sheet] done", round(time.time() - t0, 1), "s")
