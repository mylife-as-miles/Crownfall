"""Crownfall (Claude track) - TOOLS INTEGRATOR shared helpers (scripts/tools_*.py).

Drives the installed Blender extensions headless and keeps every tool asset consistent with the main build:
  * env units: assets are authored in the old layout ("env") and build_main_scene.py places them with
    world = env * ENV_K + (0, 0, ENV_DZ)   (ENV_K = 4.6, ENV_DZ = 1.9435)
  * hero camera (world): (0,-30,9) -> (0,20,5.5), 24 mm, 16:9
  * placement rules: never in hero screen x 0.42-0.60, never near the eclipse (env (3,20,5.4) r 2),
    never inside the board/dais (env r < 4.6).
"""
import glob
import json
import math
import os
import re
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
if os.path.join(CL, "lib") not in sys.path:
    sys.path.insert(0, os.path.join(CL, "lib"))

import bpy  # noqa: E402
import addon_utils  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import cf_render as R  # noqa: E402

EXT_DIR = r"C:\Users\MILES\AppData\Roaming\Blender Foundation\Blender\5.2\extensions\blender_org"
ENV_K = 4.6
ENV_DZ = 0.76 * 4.6 - 0.054 * (2.3 / 0.08)          # 1.9435, identical to build_main_scene.py
M_ENV = Matrix.Translation((0, 0, ENV_DZ)) @ Matrix.Scale(ENV_K, 4)
HERO = ((0.0, -30.0, 9.0), (0.0, 20.0, 5.5), 24.0)
ECLIPSE_ENV = (1.5, 20.0, 5.4)          # cf_atmos v007 moved the eclipse x 3.0 -> 1.5
WORM = ((6.0, -14.0, 1.2), (0.0, 30.0, 14.0), 18.0)
GOD = ((0.0, -26.0, 30.0), (0.0, 2.0, -2.0), 26.0)
ECLIPSE_R_ENV = 2.0
BAND = (0.42, 0.60)
DAIS_R = 4.6


def enable(*pkgs):
    ok = {}
    for p in pkgs:
        mod = "bl_ext.blender_org." + p
        try:
            addon_utils.enable(mod, default_set=True, persistent=False)
            ok[p] = mod in sys.modules
        except Exception as e:  # pragma: no cover
            ok[p] = "FAIL " + repr(e)
    print("[tools] enabled", ok, flush=True)
    return ok


# ----------------------------------------------------------------------------- hero projection (numpy, exact pinhole)
def _hero_basis():
    cam = np.array(HERO[0], float)
    f = np.array(HERO[1], float) - cam
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return cam, f, r, u


def hero_project_env(P_env):
    """env points (N,3) -> (N,3): screen x (0..1 left->right), screen y (0..1 TOP->bottom), depth m."""
    P = np.asarray(P_env, float).reshape(-1, 3) * ENV_K + np.array([0, 0, ENV_DZ])
    cam, f, r, u = _hero_basis()
    d = P - cam
    z = d @ f
    zc = np.maximum(z, 1e-3)
    k = HERO[2] / 36.0
    sx = 0.5 + (d @ r) / zc * k
    sy = 0.5 - (d @ u) / zc * k * (16.0 / 9.0)
    return np.stack([sx, sy, z], 1)


def project_env(P_env, cam=HERO):
    """Generic pinhole projection for a (loc, target, lens) camera, 16:9, 36 mm sensor width."""
    P = np.asarray(P_env, float).reshape(-1, 3) * ENV_K + np.array([0, 0, ENV_DZ])
    c = np.array(cam[0], float)
    f = np.array(cam[1], float) - c
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    d = P - c
    z = np.maximum(d @ f, 1e-3)
    k = cam[2] / 36.0
    return np.stack([0.5 + (d @ r) / z * k, 0.5 - (d @ u) / z * k * (16.0 / 9.0), d @ f], 1)


def eclipse_screen_cam(cam):
    c = project_env([ECLIPSE_ENV], cam)[0]
    e = project_env([(ECLIPSE_ENV[0] + ECLIPSE_R_ENV, ECLIPSE_ENV[1], ECLIPSE_ENV[2])], cam)[0]
    return c[:2], abs(e[0] - c[0])


def silhouette_check(P_env, avoid_boxes_env=(), cams=(("hero", HERO), ("worm", WORM))):
    """Screen-space test per camera: overlap of the piece's screen bbox with the eclipse disc (+10 %) and with
    the screen bboxes of `avoid_boxes_env` (list of (name, Nx3 env points), e.g. the hand)."""
    out = {}
    for cn, cam in cams:
        s = project_env(P_env, cam)
        vis = (s[:, 2] > 1)
        if not vis.any():
            out[cn] = {"visible": False}
            continue
        sx, sy = s[vis, 0], s[vis, 1]
        bb = (float(sx.min()), float(sy.min()), float(sx.max()), float(sy.max()))
        ec, er = eclipse_screen_cam(cam)
        dd = np.hypot(sx - ec[0], (sy - ec[1]) * 9 / 16)
        rec = {"bbox": [round(v, 3) for v in bb], "eclipse_overlap_frac": round(float((dd < er * 1.1).mean()), 4)}
        for nm, Q in avoid_boxes_env:
            q = project_env(Q, cam)
            qb = (q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max())
            ix = max(0.0, min(bb[2], qb[2]) - max(bb[0], qb[0])); iy = max(0.0, min(bb[3], qb[3]) - max(bb[1], qb[1]))
            rec[nm + "_bbox_overlap"] = round(float(ix * iy), 5)
        out[cn] = rec
    return out


def eclipse_screen():
    c = hero_project_env([ECLIPSE_ENV])[0]
    e = hero_project_env([(ECLIPSE_ENV[0] + ECLIPSE_R_ENV, ECLIPSE_ENV[1], ECLIPSE_ENV[2])])[0]
    return c[:2], abs(e[0] - c[0])


def world_verts_env(objs, max_per=4000):
    out = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.evaluated_get(dg).to_mesh()
        n = len(me.vertices)
        if n:
            co = np.empty(n * 3, np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            if n > max_per:
                co = co[np.linspace(0, n - 1, max_per).astype(int)]
            M = np.array(o.matrix_world)
            co = co @ M[:3, :3].T + M[:3, 3]
            out.append(co)
        o.evaluated_get(dg).to_mesh_clear()
    return np.concatenate(out) if out else np.zeros((0, 3))


def placement_check(P_env):
    """Rules check for env-space points of ONE placed piece."""
    P_env = np.asarray(P_env, float)
    s = hero_project_env(P_env)
    vis = (s[:, 2] > 1) & (s[:, 0] > -0.05) & (s[:, 0] < 1.05) & (s[:, 1] > -0.05) & (s[:, 1] < 1.05)
    inband = vis & (s[:, 0] > BAND[0]) & (s[:, 0] < BAND[1])
    ec, er = eclipse_screen()
    dsc = np.hypot(s[:, 0] - ec[0], (s[:, 1] - ec[1]) * 9 / 16)
    r = np.hypot(P_env[:, 0], P_env[:, 1])
    d3 = np.linalg.norm(P_env - np.array(ECLIPSE_ENV), axis=1)
    return {"n": int(len(P_env)), "visible_frac": round(float(vis.mean()), 3) if len(vis) else 0,
            "in_band_frac": round(float(inband.mean()), 4) if len(vis) else 0,
            "screen_x": [round(float(s[vis, 0].min()), 3), round(float(s[vis, 0].max()), 3)] if vis.any() else None,
            "screen_y_top": [round(float(s[vis, 1].min()), 3), round(float(s[vis, 1].max()), 3)] if vis.any() else None,
            "eclipse_screen_gap_in_radii": round(float((dsc[vis].min() if vis.any() else 9) / max(er, 1e-6)), 2),
            "eclipse_3d_min_env": round(float(d3.min()), 2), "min_r_env": round(float(r.min()), 2)}


# ----------------------------------------------------------------------------- ground (terrain) in env units
GROUND_ASSETS = ("CFCL_Terrain_Central", "CFCL_Terrain_Abyss", "CFCL_FromCodex_CC0Banks", "CFCL_Arch_AltarDais")


def load_ground(collection_name="TOOLS_GroundRef", assets=GROUND_ASSETS, hide=True):
    """Append the terrain assets with their arrangement (env units). Returns list of (obj, BVHTree)."""
    import cf_integrate as I
    col = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(col)
    for a in assets:
        try:
            I.append_asset(os.path.join(CL, "assets", a), col, 1.0, [])
        except Exception as e:
            print("[tools] ground load fail", a, e)
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in list(col.all_objects):
        if o.type != "MESH" or o.hide_render:
            continue
        if any(k in o.name for k in ("Lava", "Vegetation", "Offering", "Bronze")):
            continue
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        n = len(me.vertices)
        if n < 3:
            oe.to_mesh_clear()
            continue
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(o.matrix_world)
        co = co @ M[:3, :3].T + M[:3, 3]
        me.calc_loop_triangles()
        tri = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", tri)
        oe.to_mesh_clear()
        bvh = BVHTree.FromPolygons(co.tolist(), tri.reshape(-1, 3).tolist(), all_triangles=True)
        out.append((o, bvh))
        if hide:
            o.hide_render = True
            o.hide_viewport = True
    return out


def ground_z(ground, x, y, z_top=60.0, z_min=-20.0):
    best = (None, None, None)
    for o, bvh in ground:
        loc, nor, idx, dist = bvh.ray_cast(Vector((x, y, z_top)), Vector((0, 0, -1)), z_top - z_min)
        if loc is not None and (best[0] is None or loc.z > best[0]):
            best = (loc.z, o.name, tuple(nor))
    return best


# ----------------------------------------------------------------------------- versions / docs
def asset_dir(asset):
    d = os.path.join(CL, "assets", asset)
    os.makedirs(d, exist_ok=True)
    return d


def next_version(asset):
    files = sorted(glob.glob(os.path.join(asset_dir(asset), f"{asset}_v[0-9][0-9][0-9].blend")))
    n = int(re.search(r"_v(\d{3})\.blend$", files[-1]).group(1)) + 1 if files else 1
    return n


def save_blend(asset, ver):
    p = os.path.join(asset_dir(asset), f"{asset}_v{ver:03d}.blend")
    if os.path.exists(p):
        raise RuntimeError("refusing to overwrite " + p)
    bpy.ops.wm.save_as_mainfile(filepath=p, compress=True, copy=True)
    print("[tools] saved", p, flush=True)
    return p


def write_json(path, data):
    R.write_json(path, data)


def tri_count(objs):
    return R.tri_count([o for o in objs if o.type == "MESH"])


def obj_bounds(objs):
    mn, mx = R.bounds(objs)
    return [round(v, 3) for v in mn], [round(v, 3) for v in mx]


# ----------------------------------------------------------------------------- preview rig
def preview_scene(res=(1280, 720), samples=48):
    sc = bpy.context.scene
    R.setup_render(sc, "EEVEE", res, samples)
    R.setup_world(sc)
    return sc


def to_world_scale(objs):
    """For previews only (after saving): move env-unit roots to world scale like the main build."""
    for o in objs:
        if o.parent is None:
            o.matrix_world = M_ENV @ o.matrix_world


def view_cam(name, loc, tgt, lens):
    cam = R.camera(name, loc, tgt, lens)
    cam.data.clip_end = 5000
    cam.data.clip_start = 0.1
    return cam


def render(path, cam):
    return R.render_to(path, cam)
