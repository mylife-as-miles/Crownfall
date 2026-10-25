"""List which objects occupy given pixel rects of a camera view (projected vertex samples).
Usage: python lib/run_blender.py scripts/pick_regions.py -- <main_ver> <json_rects_file>"""
import sys, os, json, random
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
argv = sys.argv[sys.argv.index("--") + 1:]
VER, RF = argv[0], argv[1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend"), load_ui=False)
sc = bpy.context.scene
spec = json.load(open(RF))
cam = bpy.data.objects.get(spec.get("camera", "CF_CAM_hero"))
if cam is None:
    sys.path.insert(0, os.path.join(CL, "lib")); import cf_render as R
    cam = R.camera("CF_CAM_pick", *spec.get("camera_params", [[0, -30.0, 9.0], [0, 20, 5.5], 24]))
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W_ if False else spec.get("res", [1920, 1080])[0], spec.get("res", [1920, 1080])[1], 100
bpy.context.view_layer.update()
W, H = spec.get("res", [1920, 1080])
rects = spec["rects"]
dg = bpy.context.evaluated_depsgraph_get()
hits = {k: {} for k in rects}
rnd = random.Random(1)
for o in sc.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    try:
        me = o.evaluated_get(dg).to_mesh()
    except Exception:
        continue
    vs = me.vertices
    n = len(vs)
    idx = range(n) if n <= 3000 else rnd.sample(range(n), 3000)
    mw = o.matrix_world
    for i in idx:
        p = world_to_camera_view(sc, cam, mw @ vs[i].co)
        if p.z <= 0 or not (0 <= p.x <= 1 and 0 <= p.y <= 1):
            continue
        x, y = p.x * W, (1 - p.y) * H
        for k, (x0, y0, x1, y1) in rects.items():
            if x0 <= x <= x1 and y0 <= y <= y1:
                h = hits[k].setdefault(o.name, [0, 1e9, [c.name for c in o.users_collection][:1]])
                h[0] += 1; h[1] = min(h[1], p.z)
    o.evaluated_get(dg).to_mesh_clear()
out = {k: sorted([[n, v[0], round(v[1], 1), v[2]] for n, v in d.items()], key=lambda t: -t[1])[:12] for k, d in hits.items()}
json.dump(out, open(RF.replace(".json", "_result.json"), "w"), indent=1)
for k, v in out.items():
    print("REGION", k); [print("   ", r) for r in v[:8]]
