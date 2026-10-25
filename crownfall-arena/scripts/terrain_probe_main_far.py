"""READ-ONLY probe of the main hero scene: which far objects fill the hero frame flanks / behind the hand.
Opens main/Crownfall_Main_v018_hero.blend, NEVER saves.  Writes renders/terrain/probe_main_far.json."""
import os
import sys
import json
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
SRC = os.path.join(CL, "main", "Crownfall_Main_v018_hero.blend")
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
cams = [o for o in sc.objects if o.type == "CAMERA"]
cam = bpy.data.objects.get("CF_CAM_hero") or sc.camera
if cam is None:
    cd = bpy.data.cameras.new("probe_hero")
    cd.lens = 24.0
    cd.sensor_width = 36.0
    cam = bpy.data.objects.new("probe_hero", cd)
    sc.collection.objects.link(cam)
    cam.location = (0, -30.0, 9.0)
    d = Vector((0, 20, 5.5)) - Vector((0, -30.0, 9.0))
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    bpy.context.view_layer.update()
out = {"camera": cam.name if cam else None, "cams": [c.name for c in cams]}
if cam:
    out["cam_loc"] = list(cam.matrix_world.translation)
    out["cam_lens"] = cam.data.lens
    out["cam_rot"] = list(cam.rotation_euler)
res = []
W, H = 1920, 1080
for o in sc.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    ctr = sum(pts, Vector()) / 8
    d = (ctr - cam.matrix_world.translation).length
    if d < 60:
        continue
    sp = [world_to_camera_view(sc, cam, p) for p in pts]
    xs = [p.x * W for p in sp if p.z > 0]
    ys = [(1 - p.y) * H for p in sp if p.z > 0]
    if not xs:
        continue
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if x1 < 0 or x0 > W or y1 < 0 or y0 > H:
        continue
    cols = [c.name for c in o.users_collection]
    res.append(dict(name=o.name, coll=cols, dist=round(d, 1), screen=[round(x0), round(y0), round(x1), round(y1)],
                    dims=[round(v, 1) for v in o.dimensions], loc=[round(v, 1) for v in o.matrix_world.translation],
                    tris=sum(len(p.vertices) - 2 for p in o.data.polygons),
                    mats=[m.name for m in o.data.materials if m]))
res.sort(key=lambda r: r["dist"])
out["far_objects_in_hero"] = res
with open(os.path.join(CL, "renders", "terrain", "probe_main_far.json"), "w") as f:
    json.dump(out, f, indent=1)
for r in res:
    print(r["name"], r["coll"][:1], r["dist"], r["screen"], r["dims"], r["tris"])
print("CAM", out.get("camera"), out.get("cam_loc"), out.get("cam_lens"))
