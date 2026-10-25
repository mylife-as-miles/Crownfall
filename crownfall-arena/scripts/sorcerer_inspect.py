"""Measure the supplied four-armed creature (vendor/sorcerer_v3_1, v3.1 rig) before placing it.

For every frame of each clip (Idle, Threat_Cast, Attack; the NLA tracks are muted so exactly one action drives the
rig) it records the evaluated mesh's lowest point, height and horizontal reach in rig space. It also renders
three key frames per clip with the file's own camera and lights.
Writes assets/CFCL_Sorcerer/inspect.json and renders/sorcerer/inspect_<clip>_<frame>.png.
Usage: python lib/run_blender.py scripts/sorcerer_inspect.py"""
import json
import os
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

SRC = os.path.join(CL, "vendor", "sorcerer_v3_1", "Crownfall_Sorcerer_Digits_v3_1.blend")
bpy.ops.wm.open_mainfile(filepath=SRC, load_ui=False)
sc = bpy.context.scene
rig = bpy.data.objects["Crownfall_FourArm_Rig"]
body = bpy.data.objects["Crownfall_Sorcerer_Deform"]
ad = rig.animation_data
for t in ad.nla_tracks:
    t.mute = True
out = {"source": os.path.basename(SRC), "fps": sc.render.fps, "bones": len(rig.data.bones),
       "tris": sum(len(p.vertices) - 2 for p in body.data.polygons), "clips": {}}
rest_inv = rig.matrix_world.inverted()
foot_bones = [b for b in ("mixamorig:LeftToeBase", "mixamorig:RightToeBase", "mixamorig:LeftFoot", "mixamorig:RightFoot")
              if b in rig.pose.bones]
for clip in ("Idle", "Threat_Cast", "Attack"):
    act = bpy.data.actions[clip]
    ad.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    frames = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        me = ev.to_mesh()
        M = rest_inv @ body.matrix_world
        vs = [M @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        zmin = min(v.z for v in vs)
        zmax = max(v.z for v in vs)
        rmax = max((v.x ** 2 + v.y ** 2) ** 0.5 for v in vs)
        xmin, xmax = min(v.x for v in vs), max(v.x for v in vs)
        ymin, ymax = min(v.y for v in vs), max(v.y for v in vs)
        feet = {b: round((rig.matrix_world @ rig.pose.bones[b].head).z, 4) for b in foot_bones}
        frames.append({"f": f, "zmin": round(zmin, 4), "zmax": round(zmax, 4), "reach_r": round(rmax, 4),
                       "x": [round(xmin, 3), round(xmax, 3)], "y": [round(ymin, 3), round(ymax, 3)], "feet": feet})
    zs = [fr["zmin"] for fr in frames]
    out["clips"][clip] = {"frames": [f0, f1], "seconds": round((f1 - f0) / sc.render.fps, 3),
                          "zmin_min": min(zs), "zmin_max": max(zs), "zmax_max": max(fr["zmax"] for fr in frames),
                          "reach_r_max": max(fr["reach_r"] for fr in frames),
                          "x_span": [min(fr["x"][0] for fr in frames), max(fr["x"][1] for fr in frames)],
                          "y_span": [min(fr["y"][0] for fr in frames), max(fr["y"][1] for fr in frames)],
                          "per_frame": frames}
    print("SORCCLIP", clip, json.dumps({k: v for k, v in out["clips"][clip].items() if k != "per_frame"}))
os.makedirs(os.path.join(CL, "assets", "CFCL_Sorcerer"), exist_ok=True)
json.dump(out, open(os.path.join(CL, "assets", "CFCL_Sorcerer", "inspect.json"), "w"), indent=1)
# key frames with the file's own camera / lights
rd = os.path.join(CL, "renders", "sorcerer")
os.makedirs(rd, exist_ok=True)
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 720, 900, 100
cam = bpy.data.objects.get("Camera")
if cam:
    sc.camera = cam
    cam.data.lens = cam.data.lens * 0.8          # a little wider so the raised arms stay in frame
for clip in ("Idle", "Threat_Cast", "Attack"):
    act = bpy.data.actions[clip]
    ad.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    for f in (f0, (f0 + f1) // 2, f1 - 8):
        sc.frame_set(f)
        sc.render.filepath = os.path.join(rd, f"inspect_{clip}_{f:03d}.png")
        bpy.ops.render.render(write_still=True)
print("SORCDONE")
