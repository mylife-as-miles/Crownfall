"""Pack the Meshy GLBs into assets/CFCL_Meshy/CFCL_Meshy_v###.blend (+ arrangement.json) for the main build.

Each model becomes object/mesh/material "CFCL_Meshy_<tag>", normalised to 1 m tall with its origin at the base centre,
textures packed.  Placements are in world metres (appended like RitualFloor, world_scale 1); "snap" placements are
dropped onto the ground by build_main_scene (ray cast, sunk by `sink` x height).
Usage: python lib/run_blender.py scripts/meshy_make_asset.py -- <ver>"""
import sys, os, json
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Matrix, Vector
import cf_render as R

VER = sys.argv[sys.argv.index("--") + 1:][0]
ROOT = os.path.join(CL, "assets", "CFCL_Meshy")
TAGS = ["rib_a", "rib_b", "landmass_a", "landmass_b", "roots_a", "roots_b", "coral_tree", "coral_shrub",
        "crimson_bush", "fungus"]

# (tag, name, world xyz, yaw deg, height m, snap)
PLACE = [
    ("landmass_a", "Meshy_Landmass_A", (72, 125, 38), -30, 18, False),     # upper right: ruins silhouetted on the haze
    ("landmass_b", "Meshy_Landmass_B", (-52, 120, 4.5), 18, 18.5, False),   # rock underside of the KB3D megastructure
    ("rib_a", "Meshy_Rib_A", (-44, 40, -3), 70, 24, False),                # left frame edge, curving inwards
    ("rib_b", "Meshy_Rib_B", (60, 80, -3), -60, 30, False),                # right, rising behind the pillars
    ("roots_a", "Meshy_Roots_SkullBase", (-21, 40, 0), 35, 9, True),       # climbing onto the skull's base
    ("roots_b", "Meshy_Roots_HandBase", (19, 43, 0), -70, 4.5, True),
    ("coral_tree", "Meshy_CoralTree_Hand", (9, 52, 0), 15, 9, True),       # crimson accent left of the hand
    ("coral_shrub", "Meshy_CoralShrub_Skull", (-29, 46, 0), 0, 4.5, True),
    ("coral_shrub", "Meshy_CoralShrub_Hand", (31, 38, 0), 40, 3.5, True),
    ("crimson_bush", "Meshy_Bush_RearL", (-30, 64, 0), 0, 5, True),
    ("crimson_bush", "Meshy_Bush_RearR", (40, 68, 0), 70, 5, True),
    ("crimson_bush", "Meshy_Bush_SkullL", (-36, 52, 0), 140, 4, True),
    ("fungus", "Meshy_Fungus_Skull", (-5, 37, 0), 200, 3, True),
    ("fungus", "Meshy_Fungus_Hand", (20, 39, 0), 30, 2.5, True),
]
# albedo value per model: Meshy bakes bright, evenly lit colour; pull the busy ones back into the scene's key
VALUE = {"roots_a": 0.62, "roots_b": 0.72, "rib_a": 0.85, "rib_b": 0.85}

R.reset_scene()
col = bpy.data.collections.new("CFCL_Meshy")
bpy.context.scene.collection.children.link(col)
for t in TAGS:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, t, t + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o != ob and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    mn, mx = R.bounds([ob])
    h = max(mx.z - mn.z, 1e-6)
    base = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    ob.data.transform(Matrix.Scale(1.0 / h, 4) @ Matrix.Translation(-base))
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = "CFCL_Meshy_" + t
    for i, s in enumerate(ob.material_slots):
        if s.material:
            s.material.name = "CFCL_Meshy_" + t + ("" if i == 0 else f"_{i}")
            nt = s.material.node_tree
            b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if t in VALUE and b is not None and b.inputs["Base Color"].is_linked:
                hs = nt.nodes.new("ShaderNodeHueSaturation")
                hs.inputs["Value"].default_value = VALUE[t]
                nt.links.new(b.inputs["Base Color"].links[0].from_socket, hs.inputs["Color"])
                nt.links.new(hs.outputs["Color"], b.inputs["Base Color"])
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    print("ASSET", ob.name, len(ob.data.polygons), [round(v, 2) for v in ob.dimensions], flush=True)
bpy.ops.file.pack_all()
out = os.path.join(ROOT, f"CFCL_Meshy_{VER}.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
arr = {"asset": "CFCL_Meshy", "blend": os.path.basename(out), "units": "world metres",
       "placements": [{"source": "CFCL_Meshy_" + t, "name": n, "location": list(p), "rotation_deg": [0, 0, yaw],
                       "scale": [h, h, h], "snap": snap, "sink": 0.06} for (t, n, p, yaw, h, snap) in PLACE]}
json.dump(arr, open(os.path.join(ROOT, "arrangement.json"), "w"), indent=1)
print("SAVED", out)
