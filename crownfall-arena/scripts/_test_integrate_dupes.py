# Headless unit test: repeated sources in arrangement.json must produce one object per placement.
import sys, os, json
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy, cf_render as R, cf_integrate as I
R.reset_scene()
root = bpy.data.collections.new("T"); bpy.context.scene.collection.children.link(root)
res = {}
for a in ("CFCL_Terrain_Ribs", "CFCL_Arch_RuinsKit", "CFCL_Arch_AltarDais"):
    w = []
    placed = I.append_asset(os.path.join(CL, "assets", a), root, 1.0, w)
    arr = json.load(open(os.path.join(CL, "assets", a, "arrangement.json")))
    vis = [o for o in bpy.data.collections[a].objects if not o.hide_render and o.parent is None]
    res[a] = {"placements": len(arr["placements"]), "placed": len(placed), "visible_top_level": len(vis), "warnings": w}
print("DUPTEST", json.dumps(res))
