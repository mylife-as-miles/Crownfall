"""Debug: render the rock moss shell with cf_edge as emission (read-only on the .blend)."""
import sys, os
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
args = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=args[0])
import cf_render as R
sc = bpy.context.scene
R.setup_render(sc, "EEVEE", (960, 540), 16)
R.setup_world(sc)
R.standard_lights(3.0, lava=False)
cam = R.camera("AB_cam", (-1.0, 0.0, 2.2), (-2.5, 2.4, 1.0), 32.0)
shell = bpy.data.objects.get("CFCL_Veg_Demo_Rock_MossShell")
m = bpy.data.materials.new("DBG_edge")
m.use_nodes = True
nt = m.node_tree
nt.nodes.clear()
a = nt.nodes.new("ShaderNodeAttribute"); a.attribute_type = "GEOMETRY"; a.attribute_name = "cf_edge"
e = nt.nodes.new("ShaderNodeEmission"); o = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(a.outputs["Fac"], e.inputs["Color"]); nt.links.new(e.outputs[0], o.inputs["Surface"])
shell.data.materials[0] = m
shell.data.materials[1] = m
print("attrs", [(x.name, x.domain, x.data_type) for x in shell.data.attributes], flush=True)
R.render_to(args[1] + "_D_cf_edge_emission.png", cam)
