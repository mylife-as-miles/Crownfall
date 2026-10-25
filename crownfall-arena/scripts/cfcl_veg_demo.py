"""Dress demo + contact test for cf_vegetation.dress().

python lib/run_blender.py scripts/cfcl_veg_demo.py --timeout 1800 -- --iter 01 [--lib dev] [--kit path]
Builds an SDF rock block (with overhang, ledges, crevices), a small eroded masonry arch and a stepped altar
drum with a board proxy at the origin; dresses all three (rock + arch scale 1, drum scale 0.35 with
V.board_exclude); renders mid + close views to renders/CFCL_Veg_Demo/iterNN_*; writes iterNN_report.json.
"""
import sys
import os
import math
import time
import json

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


IT = arg("--iter", "01")
if arg("--lib", "main") == "dev":
    import cf_materials_dev as M
else:
    import cf_materials as M
import cf_vegetation as V
V.set_material_lib(M)
KIT = arg("--kit", None) or V.latest_kit()
OUT = os.path.join(CL, "renders", "CFCL_Veg_Demo")
os.makedirs(OUT, exist_ok=True)
t0 = time.time()
R.reset_scene()
sc = bpy.context.scene
FLOOR = -0.76


def rock_sdf(P):
    Q = S.warp(P, 0.10, 0.7, seed=21)
    d = S.box(Q, (0, 0, 0.75), (1.3, 0.95, 0.95), round_r=0.15)
    slab = S.box(Q, (0.25, -0.35, 1.78), (1.05, 0.95, 0.2), R=S.rot_matrix(0, 4, 8), round_r=0.06)
    step = S.box(Q, (-0.95, 0.45, 1.15), (0.5, 0.6, 0.35), round_r=0.08)
    d = S.smin(d, slab, 0.06)
    d = S.smin(d, step, 0.1)
    d = S.ssub(d, S.box(Q, (0.2, -1.0, 1.45), (1.25, 0.25, 0.12), round_r=0.08), 0.05)
    for x, y, a in ((0.3, -0.2, 20), (-0.4, 0.5, -35), (0.75, 0.3, 75)):
        d = S.ssub(d, S.box(Q, (x, y, 2.0), (0.55, 0.025, 0.22), R=S.rot_matrix(0, 0, a), round_r=0.02), 0.02)
    d = d + 0.035 * S.ridged(P, 1.6, 3, seed=4) - 0.02 + 0.012 * S.fbm(P, 6.0, 2, seed=8)
    return d


def arch_sdf(P):
    Q = S.warp(P, 0.02, 2.0, seed=31)
    d = S.box(Q, (0, 0, 1.25), (1.1, 0.32, 1.25), round_r=0.03)
    Rx = S.rot_matrix(90, 0, 0)
    op = S.union(S.cylinder_z(Q, (0, 0, 1.25), 0.62, 0.6, R=Rx), S.box(Q, (0, 0, 0.6), (0.62, 0.6, 0.65)))
    d = S.subtract(d, op)
    d = S.ssub(d, S.box(Q, (0.95, 0, 2.55), (0.5, 0.6, 0.35), R=S.rot_matrix(0, 25, 0)), 0.03)   # broken top
    d0 = d.copy()
    for z in (0.42, 0.86, 1.30, 1.74, 2.18):                                                     # shallow joints
        g = np.maximum(S.box(Q, (0, 0, z), (1.3, 0.5, 0.008)), -(d0 + 0.014))
        d = S.smax(d, -g, 0.004)
    for c, r in (((-1.1, -0.32, 1.9), 0.12), ((1.1, 0.32, 0.5), 0.1), ((-0.6, -0.32, 2.5), 0.15)):
        d = S.ssub(d, S.sphere(Q, c, r), 0.02)
    d = d + 0.008 * S.ridged(P, 5.0, 3, seed=6) - 0.004
    return d


def drum_sdf(P):
    Q = S.warp(P, 0.006, 4.0, seed=41)
    d = S.cylinder_z(Q, (0, 0, -0.227), 0.62, 0.173)
    d = S.smin(d, S.cylinder_z(Q, (0, 0, -0.49), 0.70, 0.09), 0.01)
    d = S.smin(d, S.cylinder_z(Q, (0, 0, -0.67), 0.80, 0.09), 0.01)
    for c, r in (((0.55, -0.3, -0.06), 0.06), ((-0.62, 0.35, -0.42), 0.05), ((0.3, 0.75, -0.6), 0.07)):
        d = S.ssub(d, S.sphere(Q, c, r), 0.01)
    d = d + 0.004 * S.ridged(P, 9.0, 2, seed=7) - 0.002
    return d


rv, rq = S.mesh_sdf(rock_sdf, (-1.75, -1.6, -0.2), (1.75, 1.45, 2.2), 0.03)
rock = S.to_blender_mesh("Demo_Rock", rv, rq)
rock.location = (-2.6, 2.6, FLOOR)
rock.rotation_euler = (0, 0, math.radians(28))
av, aq = S.mesh_sdf(arch_sdf, (-1.25, -0.45, -0.1), (1.25, 0.45, 2.6), 0.022)
arch = S.to_blender_mesh("Demo_Arch", av, aq)
arch.location = (2.5, 2.9, FLOOR)
arch.rotation_euler = (0, 0, math.radians(-22))
dv, dq = S.mesh_sdf(drum_sdf, (-0.85, -0.85, -0.78), (0.85, 0.85, -0.05), 0.012)
drum = S.to_blender_mesh("Demo_AltarDrum", dv, dq)
bpy.context.view_layer.update()
for ob, mn in ((rock, "Basalt"), (arch, "AncientStone"), (drum, "AncientStone")):
    M.assign(ob, mn, curvature=True)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.0235))
board = bpy.context.active_object
board.name = "Demo_BoardProxy"
board.scale = (0.76, 0.76, 0.061)
bm_ = bpy.data.materials.new("BoardProxyMat")
bm_.use_nodes = True
bm_.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.06, 0.04, 1)
board.data.materials.append(bm_)
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 4, FLOOR))
ground = bpy.context.active_object
ground.name = "Demo_Ground"
M.assign(ground, "Basalt", moss=0.0)
bpy.context.view_layer.update()

reports = {}
reports["rock"] = V.dress(rock, KIT, seed=1, scale=1.0, density=1.0, exclude_fn=V.board_exclude)
reports["arch"] = V.dress(arch, KIT, seed=2, scale=1.0, density=1.0, exclude_fn=V.board_exclude)
reports["drum"] = V.dress(drum, KIT, seed=3, scale=0.35, density=1.2, exclude_fn=V.board_exclude,
                          families=("moss_shell", "cushions", "crimson", "ferns", "tufts", "drips"), moss_cover=0.25,
                          attract=[(0.0, 0.0, -0.1, 0.8)])
# board-margin check: closest vegetation vertex (world) to the board frame footprint, above z=-0.1
mind = 9.0
for o in bpy.data.objects:
    if not o.name.startswith("CFCL_Veg_") or o.type != "MESH" or o.users_collection[0].name == "CFCL_Veg_KitProtos":
        continue
    if "Demo_AltarDrum" not in o.users_collection[0].name:
        continue
    me = o.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world)
    w = co @ mw[:3, :3].T + mw[:3, 3]
    w = w[w[:, 2] > -0.1]
    if len(w):
        dx = np.maximum(np.abs(w[:, 0]) - 0.38, 0)
        dy = np.maximum(np.abs(w[:, 1]) - 0.38, 0)
        mind = min(mind, float(np.min(np.hypot(dx, dy))))
reports["board_margin_min_m"] = round(mind, 4)
reports["max_contact_gap_m"] = max(r["max_contact_gap_m"] for r in (reports["rock"], reports["arch"], reports["drum"]))
reports["kit"] = os.path.relpath(KIT, CL)
reports["time_dress_s"] = round(time.time() - t0, 1)
R.write_json(os.path.join(OUT, f"iter{IT}_report.json"), reports)
print("[veg_demo] REPORT", json.dumps({k: (v if not isinstance(v, dict) else {kk: v[kk] for kk in (
    "instance_count", "moss_faces", "max_contact_gap_m", "counts", "footprint_gap_max_m", "near_edge_frac")
    if kk in v}) for k, v in reports.items()}), flush=True)
demo_path = os.path.join(V.KIT_DIR, f"CFCL_Veg_DressDemo_iter{IT}.blend")
bpy.ops.wm.save_as_mainfile(filepath=demo_path, copy=True, compress=True)

# ------------------------------------------------------------------ renders
R.setup_render(sc, "EEVEE", (1280, 720), 48)
R.setup_world(sc)
R.standard_lights(3.0, lava=False)
views = [
    ("mid", (0.2, -4.6, 1.5), (0.0, 1.8, -0.1), 26.0),
    ("rock_top", (-1.0, 0.0, 2.2), (-2.5, 2.4, 1.0), 32.0),
    ("rock_overhang", (-2.2, -0.2, 0.2), (-2.4, 1.6, 0.4), 30.0),
    ("arch", (1.2, -0.6, 1.2), (2.5, 2.9, 0.6), 30.0),
    ("altar", (0.55, -1.25, 0.65), (0.15, 0.25, -0.2), 32.0),
]
for name, loc, tgt, lens in views:
    cam = R.camera("Demo_" + name, loc, tgt, lens)
    R.render_to(os.path.join(OUT, f"iter{IT}_{name}.png"), cam)
print("[veg_demo] done", round(time.time() - t0, 1), "s", flush=True)
