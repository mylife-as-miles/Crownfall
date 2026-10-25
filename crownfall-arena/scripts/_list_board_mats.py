import bpy, os, sys
CL=r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
bpy.ops.wm.open_mainfile(filepath=os.path.join(CL,"main","Crownfall_Main_v013_hero.blend"), load_ui=False)
for o in bpy.context.scene.objects:
    if o.name.startswith(("CFCL_Board","CFCL_Arch_Stele","CFCL_Eclipse_Body")) and o.type=="MESH":
        print("MAT", o.name, [s.material.name for s in o.material_slots if s.material])
print("VEG", sorted({c.name for c in bpy.data.collections if c.name.startswith("CFCL_Veg_") and ("Shrine" in c.name or "Arcade" in c.name)}))
