"""READ-ONLY validation: open main/Crownfall_Main_v018_hero.blend, hide the old FarCliffs v002 pieces and the
tools' CFCL_FarLand_BasaltStacks, append CFCL_Terrain_FarCliffs (latest) + CFCL_Terrain_FarStacks (latest) through
cf_integrate (env -> world: x4.6, +1.943 Z), reuse the scene's own Basalt/AncientStone materials, render the
hero camera.  NEVER saves the main file.

Run:  python lib/run_blender.py scripts/terrain_farsil_mainswap.py -- --iter 1 [--pct 50] [--before]
"""
import os
import sys
import json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
A = {argv[i][2:]: (argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True)
     for i in range(len(argv)) if argv[i].startswith("--")}
ITER = int(A.get("iter", 1))
PCT = int(A.get("pct", 50))
SRC = os.path.join(CL, "main", "Crownfall_Main_v018_hero.blend")
OUT = os.path.join(CL, "renders", "terrain", "farsil")
os.makedirs(OUT, exist_ok=True)
K, DZ = 4.6, 1.943

bpy.ops.wm.open_mainfile(filepath=SRC)
import cf_integrate as CI
import cf_render as R
sc = bpy.context.scene
log = {"hidden": [], "placed": {}}
if not A.get("before"):
    for o in sc.objects:
        if o.name.startswith("CFCL_FarCliff_") or o.name.startswith("CFCL_FarLand_BasaltStacks"):
            o.hide_render = True
            o.hide_viewport = True
            log["hidden"].append(o.name)
    root = bpy.data.collections.new("CFCL_FarSil_Validation")
    sc.collection.children.link(root)
    warn = []
    for asset in ("CFCL_Terrain_FarCliffs", "CFCL_Terrain_FarStacks"):
        folder = os.path.join(CL, "assets", asset)
        placed = CI.append_asset(folder, root, world_scale=K, warnings=warn, arrangement="arrangement_wip.json")
        for n, o in placed.items():
            if o.parent is None:
                o.location.z += DZ
            for i, slot in enumerate(o.material_slots):        # use the scene's tuned materials
                m = slot.material
                if m is None:
                    continue
                base = m.name.split(".")[0]
                if base in bpy.data.materials and bpy.data.materials[base] is not m:
                    o.material_slots[i].material = bpy.data.materials[base]
        if A.get("tint"):                                   # diagnostic: show which silhouettes are ours
            tm = bpy.data.materials.new("val_tint_" + asset[-6:])
            tm.use_nodes = True
            nt = tm.node_tree
            bsdf = nt.nodes.get("Principled BSDF")
            col = (1.0, 0.05, 0.02, 1) if asset.endswith("Cliffs") else (0.05, 0.3, 1.0, 1)
            bsdf.inputs["Emission Color"].default_value = col
            bsdf.inputs["Emission Strength"].default_value = 3.0
            for o in placed.values():
                for i in range(len(o.material_slots)):
                    o.material_slots[i].material = tm
        log["placed"][asset] = sorted(placed)
    log["warnings"] = warn
cd = bpy.data.cameras.new("val_hero")
cd.lens = 24.0
cd.sensor_width = 36.0
cd.clip_end = 4000
cam = bpy.data.objects.new("val_hero", cd)
sc.collection.objects.link(cam)
cam.location = (0, -30.0, 9.0)
cam.rotation_euler = (Vector((0, 20, 5.5)) - Vector((0, -30.0, 9.0))).to_track_quat("-Z", "Y").to_euler()
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = PCT
tag = ("before" if A.get("before") else f"iter{ITER:02d}") + ("_tint" if A.get("tint") else "")
path = os.path.join(OUT, f"main_swap_{tag}_hero.png")
sc.render.filepath = path
bpy.ops.render.render(write_still=True)
log["render"] = path
with open(os.path.join(OUT, f"main_swap_{tag}_log.json"), "w") as f:
    json.dump(log, f, indent=1)
print("[farsil] rendered", path, "hidden", len(log["hidden"]))
