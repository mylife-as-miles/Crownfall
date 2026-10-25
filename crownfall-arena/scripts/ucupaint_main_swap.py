"""Check a Ucupaint monument under the REAL main lighting (coordinator request).

python lib/run_blender.py scripts/ucupaint_main_swap.py --timeout 2400 -- <main.blend> <tag> skull=<ver> [hand=<ver>] [--res 1280x720] [--samples 32]

Opens the main hero blend READ-ONLY (never saved), renders the hero camera (0,-30,9)->(0,20,5.5) 24 mm with the
original monument (A), then appends our runtime objects, puts them on the original objects' exact world
matrices, hides the originals and renders again (B).  Writes renders/ucupaint/main_check/<tag>_{A_orig,B_ucu}.png
plus a crop around each monument and prints luma stats of the crops.
"""
import sys
import os
import math
import json
import bpy
from mathutils import Vector

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MAIN = argv[0]
TAG = argv[1]
vers = dict(a.split("=") for a in argv[2:] if "=" in a and not a.startswith("--"))
RES = (1280, 720)
SAMPLES = 32
if "--res" in argv:
    RES = tuple(int(x) for x in argv[argv.index("--res") + 1].split("x"))
if "--samples" in argv:
    SAMPLES = int(argv[argv.index("--samples") + 1])
OUT = os.path.join(CL, "renders", "ucupaint", "main_check")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=MAIN, load_ui=False)
SAVE_GUARD = bpy.data.filepath
try:   # 4 GB GPU shared with other agents: EEVEE crashed (0xC0000409) on some runs -> clamp GPU textures to 2K
    bpy.context.preferences.system.gl_texture_limit = "CLAMP_2048"
except Exception as e:
    print("[swap] texture limit not set", e)
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
try:
    sc.eevee.taa_render_samples = SAMPLES
except Exception:
    pass
sc.render.image_settings.file_format = "PNG"
cd = bpy.data.cameras.new("UCU_HERO24")
cd.lens = 24
cd.sensor_width = 36
cd.clip_end = 3000
cam = bpy.data.objects.new("UCU_HERO24", cd)
sc.collection.objects.link(cam)
cam.location = (0, -30.0, 9.0)
cam.rotation_euler = (Vector((0, 20, 5.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam

MON = {"skull": ("CFCL_Ucupaint_Skull", ["CFCL_Hero_Skull", "CFCL_Hero_Skull_Mandible"]),
       "hand": ("CFCL_Ucupaint_Hand", ["CFCL_Hero_Hand", "CFCL_Hero_Hand_FingerFragment"]),
       "altar": ("CFCL_Ucupaint_AltarDais", ["CFCL_Arch_BoardSkirt", "CFCL_Arch_DaisFloor", "CFCL_Arch_DaisRubble",
                                             "CFCL_Arch_Approaches", "CFCL_Arch_Stele_A", "CFCL_Arch_Stele_B",
                                             "CFCL_Arch_Stele_C", "CFCL_Arch_Stele_D"])}


def proj(p):
    from bpy_extras.object_utils import world_to_camera_view
    v = world_to_camera_view(sc, cam, p)
    return v.x, 1 - v.y


def crop_box(objs):
    pts = []
    for o in objs:
        for c in o.bound_box:
            pts.append(proj(o.matrix_world @ Vector(c)))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return max(0, min(xs)), max(0, min(ys)), min(1, max(xs)), min(1, max(ys))


info = {"main": MAIN, "objects_with_Skull_or_Hand": [o.name for o in bpy.data.objects
                                                      if ("Skull" in o.name or "Hero_Hand" in o.name)][:40]}
orig = {}
for k in vers:
    orig[k] = [bpy.data.objects.get(n) for n in MON[k][1]]
    orig[k] = [o for o in orig[k] if o is not None and not o.hide_render]
    info["orig_" + k] = [(o.name, [round(x, 3) for x in o.matrix_world.translation],
                          [round(math.degrees(a), 1) for a in o.matrix_world.to_euler()],
                          [round(x, 3) for x in o.matrix_world.to_scale()]) for o in orig[k]]
    info["crop_" + k] = crop_box(orig[k]) if orig[k] else None
ll = []
for o in bpy.data.objects:
    if o.type == "LIGHT":
        try:
            rc = o.light_linking.receiver_collection
            bc = o.light_linking.blocker_collection
            if rc or bc:
                ll.append((o.name, rc.name if rc else None, [x.name for x in rc.all_objects][:8] if rc else None,
                           bc.name if bc else None))
        except Exception:
            pass
info["light_linking"] = ll
print("[swap] info", json.dumps(info), flush=True)

pA = os.path.join(OUT, TAG + "_A_orig.png")
sc.render.filepath = pA
bpy.ops.render.render(write_still=True)
print("[swap] wrote", pA, flush=True)

for k, ver in vers.items():
    asset, names = MON[k]
    blend = os.path.join(CL, "assets", asset, "%s_v%03d.blend" % (asset, int(ver)))
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        loaded = [n for n in names if n in src.objects]
        dst.objects = list(loaded)
    for o_new, n in zip(dst.objects, loaded):
        if o_new is None:
            continue
        o_old = bpy.data.objects.get(n)
        # link into EVERY collection of the original: light-linking receiver / blocker collections included
        colls = list(o_old.users_collection) if o_old and o_old.users_collection else [sc.collection]
        for coll in colls:
            if o_new.name not in coll.objects:
                coll.objects.link(o_new)
        if o_old is not None:
            o_new.matrix_world = o_old.matrix_world.copy()
            for attr in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission",
                         "visible_volume_scatter", "visible_shadow", "is_holdout"):
                try:
                    setattr(o_new, attr, getattr(o_old, attr))
                except Exception:
                    pass
            try:   # the original may itself be a light-linking emitter/receiver via its own settings
                o_new.light_linking.receiver_collection = o_old.light_linking.receiver_collection
                o_new.light_linking.blocker_collection = o_old.light_linking.blocker_collection
            except Exception:
                pass
            print("[swap] collections", n, [c.name for c in colls], flush=True)
            o_old.hide_render = True
        o_new.hide_render = False
        print("[swap]", k, n, "->", o_new.name, flush=True)
pB = os.path.join(OUT, TAG + "_B_ucu.png")
sc.render.filepath = pB
bpy.ops.render.render(write_still=True)
print("[swap] wrote", pB, flush=True)
json.dump(info, open(os.path.join(OUT, TAG + "_info.json"), "w"), indent=1)
assert bpy.data.filepath == SAVE_GUARD   # never saved
print("[swap] done (main blend NOT saved)", flush=True)
