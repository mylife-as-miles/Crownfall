"""Build + save the CFCL vegetation kit, then render previews.

python lib/run_blender.py scripts/cfcl_veg_kit.py --timeout 1800 -- --iter 01 [--lib dev] [--norender]
Saves assets/CFCL_Veg_Kit/CFCL_Veg_Kit_v###.blend (next free version, never overwrites) + meta_iterNN.json,
renders renders/CFCL_Veg_Kit/iterNN_*.png.
"""
import sys
import os
import glob
import json
import math
import time

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
import numpy as np
from mathutils import Vector, Matrix
import cf_render as R
import cf_sdf as S

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

t0 = time.time()
R.reset_scene()
sc = bpy.context.scene
kit, proxy = V.build_kit(seed=0)
objs = [o for f in kit.values() for o in f]
meta = {"asset": "CFCL_Veg_Kit", "iter": IT, "units": "m", "up": "+Z", "objects": []}
for o in objs:
    tris = R.tri_count([o])
    o["cf_tris"] = tris
    d = list(o["cf_dims"])
    meta["objects"].append({"name": o.name, "family": o["cf_family"], "variant": o["cf_variant"],
                            "dims": [round(x, 3) for x in d], "tris": tris,
                            "materials": [m.name for m in o.data.materials if m],
                            "length_m": round(float(o.get("cf_length", 0.0)), 3) if "cf_length" in o else None,
                            "footprint_r": round(float(o["cf_footprint"]), 3)})
    print(f"[veg_kit] {o.name:28s} tris {tris:6d} dims {np.round(d, 3)}", flush=True)
os.makedirs(V.KIT_DIR, exist_ok=True)
NOSAVE = bool(arg("--nosave", False))
vers = [int(os.path.basename(p)[14:17]) for p in glob.glob(os.path.join(V.KIT_DIR, "CFCL_Veg_Kit_v[0-9][0-9][0-9].blend"))]
ver = (max(vers) + 1) if vers else 1
path = os.path.join(V.KIT_DIR, f"CFCL_Veg_Kit_v{ver:03d}.blend")
if not NOSAVE:
    bpy.ops.wm.save_as_mainfile(filepath=path, copy=True, compress=True)
    meta["blend"] = os.path.relpath(path, CL)
    meta["time_build_s"] = round(time.time() - t0, 1)
    R.write_json(os.path.join(V.KIT_DIR, f"meta_iter{IT}.json"), meta)
    print("[veg_kit] saved", path, flush=True)
else:
    print("[veg_kit] --nosave: preview only (geometry identical to the latest saved kit for the same code)", flush=True)
if arg("--norender", False):
    sys.exit(0)

# ------------------------------------------------------------------ previews
OUT = os.path.join(CL, "renders", "CFCL_Veg_Kit")
os.makedirs(OUT, exist_ok=True)
for fam, cname in V.FAMILY_COLL.items():
    lc = V._layer_coll(bpy.context.view_layer.layer_collection, cname)
    if lc:
        lc.exclude = True
pv = bpy.data.collections.new("Preview")
sc.collection.children.link(pv)
R.setup_render(sc, "EEVEE", (1280, 720), 48)
R.setup_world(sc)
R.standard_lights(2.0, lava=False)


def dup(o, loc, rz=0.0, s=1.0):
    ob = bpy.data.objects.new(o.name + "_pv", o.data)
    ob.matrix_world = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(rz), 4, "Z") @ \
        Matrix.Diagonal((s, s, s, 1))
    pv.objects.link(ob)
    return ob


def ground(size, loc=(0, 0, 0), mat="Basalt", **kw):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc)
    g = bpy.context.active_object
    g.users_collection[0].objects.unlink(g)
    pv.objects.link(g)
    M.assign(g, mat, **kw)
    return g


# 1) ground families lineup
g = ground(30, (0, 2, 0), "Basalt", moss=0.0)
rows = [("ferns", 0.0, 1.4), ("crimson", 1.6, 1.0), ("tufts", 2.9, 0.6), ("cushions", 3.8, 0.7)]
for fam, y, dx in rows:
    for i, o in enumerate(kit[fam]):
        dup(o, ((i - 1) * dx * (1.4 if fam == "ferns" else 1.0), y, 0.0), rz=20 * i)
cam = R.camera("KitCam", (0.4, -3.6, 2.4), (0.0, 1.5, 0.15), 32.0)
R.render_to(os.path.join(OUT, f"iter{IT}_ground_families.png"), cam)
closes = [("ferns", 2, (1.96, 0.0, 0.0), (2.2, -1.75, 1.05), 40), ("crimson", 2, (1.0, 1.6, 0.0), (1.6, 0.6, 0.85), 40),
          ("tufts", 1, (0.0, 2.9, 0.0), (0.35, 2.15, 0.45), 45), ("cushions", 2, (0.7, 3.8, 0.0), (1.2, 3.05, 0.55), 45)]
for fam, vi, tgt, cpos, lens in closes:
    c = R.camera("Close_" + fam, cpos, (tgt[0], tgt[1], tgt[2] + (0.35 if fam == "ferns" else 0.18)), lens)
    R.render_to(os.path.join(OUT, f"iter{IT}_close_{fam}.png"), c)
for o in list(pv.objects):
    o.hide_render = True

# 2) hanging families from a stone lintel; fungi on the pillar face
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.4, 6.3))
lin = bpy.context.active_object
lin.users_collection[0].objects.unlink(lin)
pv.objects.link(lin)
lin.scale = (6.0, 0.8, 0.6)
M.assign(lin, "AncientStone")
bpy.ops.mesh.primitive_cube_add(size=1, location=(3.6, 0.4, 3.0))
pil = bpy.context.active_object
pil.users_collection[0].objects.unlink(pil)
pv.objects.link(pil)
pil.scale = (1.0, 0.8, 6.0)
M.assign(pil, "AncientStone")
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 1.2, 3.0))
wall = bpy.context.active_object
wall.users_collection[0].objects.unlink(wall)
pv.objects.link(wall)
wall.scale = (7.0, 0.8, 6.0)
M.assign(wall, "Basalt")
g2 = ground(30, (0, -2, 0), "Basalt", moss=0.0)
for i, o in enumerate(kit["vines"]):
    dup(o, (-2.0 + i * 1.6, 0.0, 6.0), rz=180)
for i, o in enumerate(kit["drips"]):
    dup(o, (-2.6 + i * 4.8, 0.0, 6.0), rz=180)
for i, o in enumerate(kit["fungi"]):
    dup(o, (3.2 - 0.5 * i, 0.0, 1.2 + i * 1.1), rz=180)
cam2 = R.camera("HangCam", (0.9, -7.6, 3.4), (0.2, 0.0, 3.5), 32.0)
R.render_to(os.path.join(OUT, f"iter{IT}_hanging.png"), cam2)
cam3 = R.camera("FungiCam", (1.8, -1.9, 3.0), (2.4, 0.0, 2.3), 40.0)
R.render_to(os.path.join(OUT, f"iter{IT}_close_fungi.png"), cam3)
cam4 = R.camera("VineClose", (-1.0, -2.3, 5.2), (-2.0, -0.05, 4.9), 40.0)
R.render_to(os.path.join(OUT, f"iter{IT}_close_vines.png"), cam4)
for o in list(pv.objects):
    o.hide_render = True

# 3) roots on their proxy edge block
v, q = proxy[1]
for i, o in enumerate(kit["roots"]):
    blk = S.to_blender_mesh(f"RootProxy_{i}", v, q, pv)
    blk.location = ((i - 1) * 3.2, 0, 0)
    M.assign(blk, "Basalt", moss=0.0)
    dup(o, ((i - 1) * 3.2, 0, 0))
g3 = ground(40, (0, 0, -1.85), "Basalt", moss=0.0)
cam5 = R.camera("RootCam", (1.6, 5.0, 2.4), (0.0, -0.5, -0.5), 30.0)
R.render_to(os.path.join(OUT, f"iter{IT}_roots.png"), cam5)
cam6 = R.camera("RootClose", (1.0, 1.9, 1.3), (0.0, -0.35, -0.25), 38.0)
R.render_to(os.path.join(OUT, f"iter{IT}_close_roots.png"), cam6)
print("[veg_kit] done", round(time.time() - t0, 1), "s", flush=True)
