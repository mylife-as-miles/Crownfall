"""Read-only probe of a main .blend: world positions/size of the ritual-floor stream shards + eclipse objects
(-> renders/sky_shatter/probe_stream.json).  Never saves.
python lib/run_blender.py scripts/sky_shatter_probe_stream.py --timeout 900 -- main/Crownfall_Main_v018_hero.blend"""
import json
import os
import sys

import bpy
from mathutils import Vector

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, argv[0] if argv else r"main\Crownfall_Main_v018_hero.blend"))
out = {"stream": [], "eclipse": {}, "gate": [], "hand": [], "cams": {}}
for o in bpy.data.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    n = o.name
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    ctr = sum(bb, Vector()) / 8.0
    size = max((max(v[i] for v in bb) - min(v[i] for v in bb)) for i in range(3))
    rec = {"name": n, "c": [round(v, 2) for v in ctr], "size": round(size, 2)}
    if "RitualFloor" in n and ("Shard" in n or "Stream" in n):
        out["stream"].append(rec)
    elif n.startswith("CFCL_Eclipse_Body"):
        out["eclipse"] = rec
    elif "RitualFloor" in n and ("Gate" in n or "Monument" in n or "Arch" in n):
        out["gate"].append(rec)
    elif "Hero_Hand" in n or "Ucupaint_Hand" in n:
        out["hand"].append({**rec, "bmin": [round(min(v[i] for v in bb), 1) for i in range(3)],
                            "bmax": [round(max(v[i] for v in bb), 1) for i in range(3)]})
for o in bpy.data.objects:
    if o.type == "CAMERA":
        out["cams"][o.name] = [list(o.location), list(o.rotation_euler), o.data.lens]
json.dump(out, open(os.path.join(CL, "renders", "sky_shatter", "probe_stream.json"), "w"), indent=1)
print("[probe]", len(out["stream"]), "stream objs; eclipse", out["eclipse"], "hand", out["hand"][:2], flush=True)
