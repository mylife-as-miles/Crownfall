"""Turntable previews + stats for downloaded Meshy GLBs (assets/CFCL_Meshy/<tag>/<tag>.glb).
Usage: python lib/run_blender.py scripts/meshy_preview.py -- [tag ...]   -> renders/meshy/<tag>_<view>.png, renders/meshy/stats.json"""
import sys, os, json, glob
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
import cf_render as R

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.join(CL, "renders", "meshy")
os.makedirs(OUT, exist_ok=True)
glbs = sorted(glob.glob(os.path.join(CL, "assets", "CFCL_Meshy", "*", "*.glb")))
if argv:
    glbs = [g for g in glbs if os.path.basename(os.path.dirname(g)) in argv]
sp = os.path.join(OUT, "stats.json")
stats = json.load(open(sp)) if os.path.exists(sp) else {}
for g in glbs:
    tag = os.path.basename(os.path.dirname(g))
    R.reset_scene()
    bpy.ops.import_scene.gltf(filepath=g)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    mn, mx = R.bounds(objs)
    imgs = {i.name: list(i.size) for i in bpy.data.images if i.size[0] > 0}
    stats[tag] = {"tris": R.tri_count(objs), "objects": len(objs), "dims": [round(v, 3) for v in (mx - mn)],
                  "materials": sorted({s.material.name for o in objs for s in o.material_slots if s.material}),
                  "images": imgs}
    sc = bpy.context.scene
    R.setup_world(sc, top=(0.30, 0.31, 0.32), horizon=(0.42, 0.42, 0.41), strength=1.0)
    R.turntable(objs, os.path.join(OUT, tag), views=(("q_front", -35, 14), ("q_back", 145, 18)), lens=50.0,
                dist_mult=1.5, res=(900, 900), samples=48, ground=True)
    print("PREVIEW", tag, json.dumps(stats[tag])[:300], flush=True)
json.dump(stats, open(sp, "w"), indent=1)
