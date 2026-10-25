"""Claude-track INTEGRATION PREVIEW (test scene only - not a competing final environment).

Assembles the latest version of every Claude-track asset in a fresh scene, places them via each
asset's arrangement.json (+ layout_overrides.json), appends the board read-only, dresses with
vegetation if lib/cf_vegetation.py exists, builds sky/eclipse/fog/lights, and renders the review views.

Usage: python lib/run_blender.py scripts/integrate_preview.py --timeout 3000 -- <pass_tag> [views] [engine] [scale]
  views: comma list from hero,seated,seated_up,elevated,top,board_close,monuments (default all)
Saves work/claude_environment/preview/CFCL_IntegrationPreview_<pass>.blend (board not saved inside? -> it IS
included for review; this file is a preview, never a replacement for the board source).
"""
import sys, os, glob, json, re, math, time, traceback
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Vector, Euler
import cf_render as R, cf_atmos as A, cf_materials as M

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PASS = argv[0] if argv else "pass01"
VIEWS = argv[1].split(",") if len(argv) > 1 and argv[1] not in ("", "all") else \
    ["hero", "codex_hero", "seated", "seated_up", "elevated", "top", "board_close", "monuments"]
ENGINE = argv[2] if len(argv) > 2 else "EEVEE"
SCALE = float(argv[3]) if len(argv) > 3 else 1.0
ARRANGEMENT = argv[4] if len(argv) > 4 else "arrangement.json"
OUT = os.path.join(CL, "renders", "integration", PASS)
os.makedirs(OUT, exist_ok=True)
LOG = {"pass": PASS, "assets": [], "warnings": [], "views": {}}
t0 = time.time()


def latest_blend(folder):
    files = sorted(glob.glob(os.path.join(folder, "*_v[0-9][0-9][0-9].blend")))
    return files[-1] if files else None


R.reset_scene()
sc = bpy.context.scene
R.setup_render(sc, ENGINE, (1600, 900), 64)
for k, v in (("volumetric_end", 90.0), ("volumetric_tile_size", "4"), ("volumetric_samples", 96),
             ("volumetric_light_clamp", 0.0), ("shadow_resolution_scale", 1.0)):
    try:
        setattr(sc.eevee, k, v)
    except Exception:
        pass
root = bpy.data.collections.new("CFCL_PREVIEW"); sc.collection.children.link(root)

overrides = {}
ov_path = os.path.join(CL, "layout_overrides.json")
if os.path.exists(ov_path):
    overrides = json.load(open(ov_path))
skip_assets = set(overrides.get("skip_assets", []))

import cf_integrate as I
placed = {}
for folder in sorted(glob.glob(os.path.join(CL, "assets", "CFCL_*"))):
    asset = os.path.basename(folder)
    if asset in skip_assets or asset in ("CFCL_Sky_Eclipse", "CFCL_Veg_Kit", "CFCL_Materials"):
        continue
    if not I.latest_blend(folder):
        continue
    try:
        got = I.append_asset(folder, root, SCALE, LOG["warnings"], arrangement=ARRANGEMENT)
    except Exception as e:
        LOG["warnings"].append(f"{asset}: append failed {e}")
        continue
    placed.update(got)
    c_ = bpy.data.collections.get(asset)
    LOG["assets"].append({"asset": asset, "blend": c_.get("cfcl_blend") if c_ else None, "placed": len(got)})

# manual overrides: {"objects": {"name": {"location":..,"rotation_deg":..,"scale":..,"hide":bool}}}
for name, t in overrides.get("objects", {}).items():
    o = bpy.data.objects.get(name)
    if not o:
        LOG["warnings"].append(f"override target missing: {name}")
        continue
    if "location" in t: o.location = t["location"]
    if "rotation_deg" in t: o.rotation_euler = [math.radians(a) for a in t["rotation_deg"]]
    if "scale" in t: o.scale = t["scale"]
    if t.get("hide"): o.hide_render = o.hide_viewport = True

# board (read-only append)
R.append_board()

# vegetation dressing (if the surface agent's tool exists)
veg_report = {}
try:
    import importlib
    if os.path.exists(os.path.join(CL, "lib", "cf_vegetation.py")):
        import cf_vegetation as V
        kit = latest_blend(os.path.join(CL, "assets", "CFCL_Veg_Kit"))
        if kit:
            def exclude_local(p):
                # keep the board, its frame and the player's approach clear
                if math.hypot(p.x, p.y) < 0.55 and p.z > -0.12:
                    return True
                if -2.2 < p.y < 0.0 and abs(p.x) < 0.9 and p.z > -0.9:
                    return True
                return False
            for spec in overrides.get("dress", []):
                o = bpy.data.objects.get(spec["object"])
                if not o or o.hide_render:
                    continue
                try:
                    t_d = time.time()
                    kw = dict(spec.get("kw", {}))
                    if "families" in kw:
                        kw["families"] = tuple(kw["families"])
                    r = V.dress(o, kit, seed=spec.get("seed", 1), density=spec.get("density", 1.0),
                                scale=spec.get("scale", 1.0), exclude_fn=getattr(V, "board_exclude", exclude_local),
                                **kw)
                    print("[integrate] dressed", spec["object"], round(time.time() - t_d, 1), "s", flush=True)
                    veg_report[spec["object"]] = {k: (v if isinstance(v, (int, float, str)) else str(v)) for k, v in (r or {}).items()}
                except Exception as e:
                    LOG["warnings"].append(f"dress {spec['object']} failed: {e}")
except Exception as e:
    LOG["warnings"].append("vegetation import failed: " + repr(e))
LOG["vegetation"] = veg_report

# atmosphere + lights
A.build_world(sc)
acol = bpy.data.collections.new("CFCL_Atmos"); root.children.link(acol)
A.build_eclipse(acol)
A.build_sky_clouds(acol)
A.build_light_rig(acol)
A.build_lava_mist(acol)
A.build_fog_volume(acol, density=overrides.get("fog_density", 0.03))

# cameras
CAMS = {
    # research §6c solve (28 mm, +2 deg pitch) and Codex's current hero camera for like-for-like comparison
    "hero":        ((0, -1.31, 0.22), (0, 10.0, 0.615), 28),
    "codex_hero":  ((0, -1.05, 0.32), (0, 0.8, 0.22), 20),
    "seated":      ((0, -0.85, 0.55), (0, 0.15, 0), 24),
    "seated_up":   ((0, -0.85, 0.55), (0, 9, 1.5), 24),
    "elevated":    ((0, -7.0, 7.0), (0, 4, -1), 24),
    "top":         ((0, 4, 60), (0, 4.0001, 0), 30),
    "board_close": ((0.75, -0.9, 0.55), (0, 0, -0.05), 40),
    "monuments":   ((0.5, -3.0, 1.2), (0, 9, 2.0), 30),
}
CAMS.update({k: tuple(v) for k, v in overrides.get("cameras", {}).items()})
for v in VIEWS:
    if v not in CAMS:
        continue
    loc, tgt, lens = CAMS[v]
    cam = R.camera("CFCL_CAM_" + v, loc, tgt, lens)
    t1 = time.time()
    try:
        R.render_to(os.path.join(OUT, f"{PASS}_{v}.png"), cam)
        LOG["views"][v] = {"camera": [loc, tgt, lens], "seconds": round(time.time() - t1, 1)}
    except Exception as e:
        LOG["warnings"].append(f"render {v} failed: {e}")

# stats
mesh_objs = [o for o in sc.objects if o.type == "MESH" and not o.hide_render]
try:
    LOG["triangles_rendered"] = R.tri_count(mesh_objs)
except Exception as e:
    LOG["warnings"].append("tri count failed " + str(e))
LOG["objects_rendered"] = len(mesh_objs)
LOG["seconds_total"] = round(time.time() - t0, 1)
os.makedirs(os.path.join(CL, "preview"), exist_ok=True)
try:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CL, "preview", f"CFCL_IntegrationPreview_{PASS}.blend"), compress=True)
except Exception as e:
    LOG["warnings"].append("save failed " + str(e))
R.write_json(os.path.join(OUT, f"{PASS}_integration_log.json"), LOG)
print("INTEGRATION_DONE", json.dumps({k: LOG[k] for k in ("assets", "warnings")}, indent=1))
