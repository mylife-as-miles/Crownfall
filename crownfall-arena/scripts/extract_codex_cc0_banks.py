"""Extract the Codex-v002 pieces kept in the merge into a self-contained Claude asset (textures packed),
so the main scene no longer depends on Codex's files. Reads Codex's file only (no save to it)."""
import bpy, os, json, shutil
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
ROOT = os.path.dirname(os.path.dirname(CL))
SRC = os.path.join(ROOT, "outputs", "Crownfall_Environment_v002", "Crownfall_Environment_v002_WORKING.blend")
DST = os.path.join(CL, "assets", "CFCL_FromCodex_CC0Banks")
KEEP = {"ENV_Canyon10_MainBank_Left": (-1.9, 1.5, 0.0), "ENV_Canyon10_MainBank_Right": (1.9, 1.5, 0.0),
        "ENV_Canyon10_ClosedBackfill_-1": (-1.9, 1.5, 0.0), "ENV_Canyon10_ClosedBackfill_1": (1.9, 1.5, 0.0),
        "ENV_BankVegetation21_WestNear": (-1.9, 1.5, 0.0), "ENV_BankVegetation21_EastNear": (1.9, 1.5, 0.0)}
bpy.ops.wm.read_factory_settings(use_empty=True)
col = bpy.data.collections.new("CFCL_FromCodex_CC0Banks"); bpy.context.scene.collection.children.link(col)
with bpy.data.libraries.load(SRC, link=False) as (src, dst):
    dst.objects = [n for n in src.objects if n in KEEP]
placements, meta = [], []
dg = bpy.context.evaluated_depsgraph_get()
for o in dst.objects:
    if o is None: continue
    col.objects.link(o); o.parent = None
    loc = [o.location[i] + KEEP[o.name][i] for i in range(3)]
    placements.append({"source": o.name, "name": o.name, "location": [round(v, 4) for v in loc],
                       "rotation_deg": [round(__import__("math").degrees(a), 4) for a in o.rotation_euler],
                       "scale": [round(v, 5) for v in o.scale]})
    me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); t = len(me.loop_triangles); o.evaluated_get(dg).to_mesh_clear()
    meta.append({"name": o.name, "tris": t, "dims": [round(v, 3) for v in o.dimensions],
                 "materials": [s.material.name for s in o.material_slots if s.material]})
missing = [im.filepath for im in bpy.data.images if im.source == "FILE" and not im.packed_file and not os.path.exists(bpy.path.abspath(im.filepath))]
bpy.ops.file.pack_all()
packed = [im.name for im in bpy.data.images if im.packed_file]
blend = os.path.join(DST, "CFCL_FromCodex_CC0Banks_v001.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
json.dump({"asset": "CFCL_FromCodex_CC0Banks", "blend": os.path.basename(blend), "placements": placements},
          open(os.path.join(DST, "arrangement.json"), "w"), indent=1)
json.dump({"asset": "CFCL_FromCodex_CC0Banks", "source_file": SRC, "objects": meta, "packed_images": packed,
           "missing_images_at_pack_time": missing, "offset_note": "banks moved outward x +-1.9, y +1.5 vs Codex v002 so they flank the dais"},
          open(os.path.join(DST, "meta.json"), "w"), indent=1)
for f in ("SOURCES_AND_LICENSES.md", "SOURCE_REGISTER.json"):
    shutil.copy2(os.path.join(ROOT, "outputs", "Crownfall_Environment_v002", f), os.path.join(DST, "CODEX_" + f))
print("EXTRACT_OK", len(placements), "objects; packed", len(packed), "images; missing", missing)
