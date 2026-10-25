"""Pack selected KitBash3D 'Secrets of the Luminara' modules into assets/CFCL_KB3D/CFCL_KB3D_v###.blend + arrangement.json.

Each kit root (_grp hierarchy) is joined into one mesh "CFCL_KB3D_<short>" with transforms applied and its origin at the
base centre (kit fronts face -Y = towards the hero camera).  Kit material slot names (KB3D_SOL_*) are kept so
assets/CFCL_PBR/pbr_mapping.json can map them onto the CC0 stone library (the kit's own textures were not supplied).
Placements are WORLD METRES (appended like CFCL_RitualFloor); "snap" pieces are dropped onto the ground by the build.
Usage: python lib/run_blender.py scripts/kb3d_make_asset.py -- <kit.blend> <ver>"""
import sys, os, json
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Matrix, Vector
import cf_render as R

argv = sys.argv[sys.argv.index("--") + 1:]
KIT, VER = argv[0], argv[1]
ROOT = os.path.join(CL, "assets", "CFCL_KB3D")
PIECES = {  # short name: kit root prefix
    "FloorLarge": "KB3D_SOL_BuildModuleFloorLarge_A",
    "Colonnade": "KB3D_SOL_BuildModuleColonnade_B",
    "VaultedRoof": "KB3D_SOL_BuildModuleVaultedRoof_A",
    "Aqueduct": "KB3D_SOL_BuildModuleAqueductStraight_B",
    "BrokenPilars": "KB3D_SOL_BuildModuleBrokenPilars_A",
    "Entrance": "KB3D_SOL_BuildModuleEntrance_B",
}
# (piece, name, world xyz, rot xyz deg, uniform scale, snap)   - megastructure replaces CFCL_FarLand_Frag_ArchSpan
PLACE = [
    ("FloorLarge", "KB3D_Mega_Foundation", (-52, 120, 22.5), (-5, 9, 18), 1.0, False),
    ("Colonnade", "KB3D_Mega_Colonnade", (-55, 121, 23.4), (-5, 9, 18), 1.25, False),
    ("BrokenPilars", "KB3D_Mega_BrokenPilars", (-42, 116, 22.8), (-5, 9, 18), 1.3, False),
    ("VaultedRoof", "KB3D_Mega_VaultedRoof_Drift", (-50, 118, 38.5), (8, -14, 30), 1.0, False),
    ("Aqueduct", "KB3D_Mega_CollapsedAqueduct", (-33, 113, 15.5), (4, -22, 12), 1.25, False),
    ("Entrance", "KB3D_SkullFlank_Entrance", (-43, 84, 0), (0, 0, 20), 2.0, True),
]

bpy.ops.wm.open_mainfile(filepath=KIT, load_ui=False)
sc = bpy.context.scene


def tree(o):
    yield o
    for c in o.children:
        yield from tree(c)


keep = []
for short, prefix in PIECES.items():
    root = next((o for o in sc.objects if o.parent is None and o.name.startswith(prefix)), None)
    if root is None:
        print("MISSING", prefix)
        continue
    meshes = [o for o in tree(root) if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.data = o.data.copy()
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    mn, mx = R.bounds([ob])
    base = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    ob.data.transform(Matrix.Translation(-base))
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = "CFCL_KB3D_" + short
    keep.append(ob)
    print("PIECE", ob.name, len(ob.data.polygons), [round(v, 1) for v in ob.dimensions], sorted({s.material.name for s in ob.material_slots if s.material})[:6], flush=True)

for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.new("CFCL_KB3D")
sc.collection.children.link(col)
for o in keep:
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)
for c in list(bpy.data.collections):
    if c != col:
        bpy.data.collections.remove(c)
for im in list(bpy.data.images):        # kit textures were not supplied: drop the dangling references
    bpy.data.images.remove(im)
bpy.ops.outliner.orphans_purge(do_recursive=True)
os.makedirs(ROOT, exist_ok=True)
out = os.path.join(ROOT, f"CFCL_KB3D_{VER}.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
arr = {"asset": "CFCL_KB3D", "blend": os.path.basename(out), "units": "world metres",
       "placements": [{"source": "CFCL_KB3D_" + p, "name": n, "location": list(loc), "rotation_deg": list(rot),
                       "scale": [s, s, s], "snap": snap, "sink": 0.04} for (p, n, loc, rot, s, snap) in PLACE]}
json.dump(arr, open(os.path.join(ROOT, "arrangement.json"), "w"), indent=1)
print("SAVED", out, len(keep))
