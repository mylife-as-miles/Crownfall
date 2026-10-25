"""Render 4 clean orthogonal views of a hero asset (skull / hand) as Meshy multi-image-to-3D input.
Usage: python lib/run_blender.py scripts/render_meshy_refs.py -- <asset_folder_name> <out_dir> <name_regex>"""
import sys, os, re, math
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
import cf_render as R, cf_integrate as I
argv = sys.argv[sys.argv.index("--") + 1:]
ASSET, OUT, PAT = argv[0], argv[1], argv[2]
R.reset_scene()
blend = I.latest_blend(os.path.join(CL, "assets", ASSET))
with bpy.data.libraries.load(blend, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if re.search(PAT, n)]
objs = []
for o in dst.objects:
    if o is not None and o.type == "MESH":
        bpy.context.scene.collection.objects.link(o)
        o.parent = None
        objs.append(o)
print("REF objects", [o.name for o in objs])
sc = bpy.context.scene
R.setup_render(sc, "EEVEE", (1024, 1024), 64)
R.setup_world(sc, top=(0.42, 0.42, 0.42), horizon=(0.5, 0.5, 0.5), strength=1.0)
sc.view_settings.look = "None" if "None" in [l for l in ("None",)] else sc.view_settings.look
os.makedirs(OUT, exist_ok=True)
R.turntable(objs, os.path.join(OUT, ASSET), views=(("front", 0, 8), ("left", 90, 8), ("back", 180, 8), ("right", -90, 8)),
            lens=60.0, dist_mult=float(argv[3]) if len(argv) > 3 else 1.2, res=(1024, 1024), samples=64, ground=False)
