import sys, os
sys.path.insert(0, r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment\lib")
import bpy
import cf_render as R
from mathutils import Vector

R.reset_scene()
col = R.append_board()
print("BOARD collections:", [c.name for c in col.children])
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in col.all_objects:
    if o.type != 'MESH':
        print("  nonmesh", o.name, o.type)
        continue
    b0, b1 = R.bounds([o])
    mn = Vector(map(min, mn, b0)); mx = Vector(map(max, mx, b1))
    print(f"  {o.name:40s} min=({b0.x:.4f},{b0.y:.4f},{b0.z:.4f}) max=({b1.x:.4f},{b1.y:.4f},{b1.z:.4f}) tris={R.tri_count([o])}")
print("BOARD TOTAL min", tuple(round(v, 5) for v in mn), "max", tuple(round(v, 5) for v in mx))
me = bpy.data.meshes.new("t")
print("has set_sharp_from_angle:", hasattr(me, "set_sharp_from_angle"))
print("blender", bpy.app.version_string)
# lowest verts of board: which objects reach min z and footprint at min z
zs = []
for o in col.all_objects:
    if o.type == 'MESH':
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if w.z < mn.z + 0.002:
                zs.append((round(w.x, 3), round(w.y, 3)))
if zs:
    xs = [a for a, b in zs]; ys = [b for a, b in zs]
    print("bottom footprint x", min(xs), max(xs), "y", min(ys), max(ys), "n", len(zs))
