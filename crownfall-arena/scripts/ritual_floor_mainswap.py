"""READ-ONLY check of CFCL_RitualFloor inside the real main scene (never saves the main file).

Opens main/Crownfall_Main_v016_hero.blend, reports the existing CFCL_RitualFloor_* objects (and their hide state),
the skull / hand / eclipse bounds in hero pixels, then removes the old ritual-floor objects, appends the given
version, applies the same per-family hide state the integrator used EXCEPT for the families listed in --unhide,
and renders the scene camera.
python lib/run_blender.py scripts/ritual_floor_mainswap.py --timeout 3000 -- <asset.blend> <out.png> [--samples 32]
"""
import sys
import os
import json
import math
import bpy
import numpy as np
from mathutils import Vector

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
args = sys.argv[sys.argv.index("--") + 1:]
asset_blend, out_png = args[0], args[1]
samples = int(args[args.index("--samples") + 1]) if "--samples" in args else 32
main_blend = os.path.join(CL, "main", "Crownfall_Main_v016_hero.blend")
bpy.ops.wm.open_mainfile(filepath=main_blend, load_ui=False)
sc = bpy.context.scene
cams = [o for o in bpy.data.objects if o.type == "CAMERA"]
cam = next((o for o in cams if o.name == "CF_CAM_hero"), None) or next((o for o in cams if "hero" in o.name.lower()
                                                                          and "low" not in o.name.lower()), None)
if cam is None:
    cd = bpy.data.cameras.new("SWAP_CAM_hero")
    cd.lens, cd.sensor_width, cd.clip_end = 24.0, 36.0, 4000.0
    cam = bpy.data.objects.new("SWAP_CAM_hero", cd)
    sc.collection.objects.link(cam)
    cam.location = (0, -30.0, 9.0)
    d = Vector((0, 20.0, 5.5)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
bpy.context.view_layer.update()
info = {"camera": cam.name if cam else None, "cam_loc": list(cam.location) if cam else None,
        "res": [sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage],
        "engine": sc.render.engine}


def px(p):
    from bpy_extras.object_utils import world_to_camera_view
    co = world_to_camera_view(sc, cam, Vector(p))
    return [round(co.x * sc.render.resolution_x, 1), round((1 - co.y) * sc.render.resolution_y, 1), round(co.z, 2)]


def obox(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    P = np.array([px(c)[:2] for c in cs])
    mn = [min(c[i] for c in cs) for i in range(3)]
    mx = [max(c[i] for c in cs) for i in range(3)]
    return {"world_min": [round(v, 2) for v in mn], "world_max": [round(v, 2) for v in mx],
            "px_bbox": [round(float(P[:, 0].min())), round(float(P[:, 1].min())), round(float(P[:, 0].max())),
                        round(float(P[:, 1].max()))]}


for key in ("CFCL_Hero_Skull", "CFCL_Hero_Hand", "CFCL_Eclipse_Body"):
    o = bpy.data.objects.get(key)
    if o:
        info[key] = obox(o) | {"hidden": o.hide_render}
old = [o for o in bpy.data.objects if o.name.startswith("CFCL_RitualFloor")]
fam_hidden = {}
for o in old:
    fam = o.name.replace("CFCL_RitualFloor_", "").split("_")[0]
    fam_hidden.setdefault(fam, [0, 0])
    fam_hidden[fam][0] += 1
    fam_hidden[fam][1] += int(o.hide_render)
info["old_ritual_floor_families_total_hidden"] = fam_hidden
info["old_ritual_floor_collections"] = sorted({c.name for o in old for c in o.users_collection})
parent_col = old[0].users_collection[0] if old else sc.collection
for o in old:
    bpy.data.objects.remove(o)
with bpy.data.libraries.load(asset_blend, link=False) as (src, dst):
    dst.objects = list(src.objects)
col = bpy.data.collections.new("CFCL_RitualFloor_SWAPPED")
sc.collection.children.link(col)
n = 0
for o in dst.objects:
    if o is not None:
        col.objects.link(o)
        n += 1
info["appended"] = n
g = bpy.data.objects.get("CFCL_RitualFloor_Monument_Gate")
if g:
    info["gate"] = obox(g)
st = [o for o in col.objects if o.name.startswith("CFCL_RitualFloor_Stream")]
if st:
    P = np.array([px(o.matrix_world.translation) for o in st])
    info["stream_px_extent"] = [float(P[:, 0].min()), float(P[:, 1].min()), float(P[:, 0].max()), float(P[:, 1].max())]
try:
    sc.eevee.taa_render_samples = samples
except Exception:
    pass
print("SWAPINFO", json.dumps(info, indent=1), flush=True)
os.makedirs(os.path.dirname(out_png), exist_ok=True)
sc.render.filepath = out_png
bpy.ops.render.render(write_still=True)
json.dump(info, open(out_png.replace(".png", "_info.json"), "w"), indent=1)
print("SWAP_DONE", out_png, flush=True)
