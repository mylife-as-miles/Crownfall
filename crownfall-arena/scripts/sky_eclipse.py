"""Build CFCL_Sky_Eclipse asset (world, eclipse, light rig, lava mist) + test render. Re-runnable."""
import sys, os, time
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
import cf_render as R, cf_atmos as A, cf_materials as M
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = argv[0] if argv else "v001"
ITER = argv[1] if len(argv) > 1 else "iter01"
t0 = time.time()
R.reset_scene()
sc = bpy.context.scene
R.setup_render(sc, "EEVEE", (1280, 720), 48)
for k, v in (("volumetric_end", 90.0), ("volumetric_tile_size", "4"), ("volumetric_samples", 96), ("volumetric_light_clamp", 0.0)):
    try: setattr(sc.eevee, k, v)
    except Exception as e: print("eevee", k, e)
A.build_world(sc)
root = bpy.data.collections.new("CFCL_Sky_Eclipse"); sc.collection.children.link(root)
ecol = bpy.data.collections.new("CFCL_Sky_Eclipse_Body"); root.children.link(ecol)
lcol = bpy.data.collections.new("CFCL_LightRig"); root.children.link(lcol)
mcol = bpy.data.collections.new("CFCL_LavaMist"); root.children.link(mcol)
A.build_eclipse(ecol)
A.build_sky_clouds(ecol)
A.build_light_rig(lcol)
A.build_lava_mist(mcol)
A.build_fog_volume(mcol)
out = os.path.join(CL, "assets", "CFCL_Sky_Eclipse", f"CFCL_Sky_Eclipse_{VER}.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("SAVED", out)
# --- test-only context (not saved): board + simple dais/ground + stand-in pillars at the shared (Codex) scale
R.append_board()
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.62, depth=0.70, location=(0, 0, -0.404))
M.assign(bpy.context.active_object, "AncientStone")
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=3.6, depth=0.5, location=(0, 0, -1.01))
M.assign(bpy.context.active_object, "AncientStone")
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -4)); M.assign(bpy.context.active_object, "Basalt", moss=0.0)
for (x, y, sx, sy, rz) in ((-2.6, 4, 0.8, 8, 8), (2.6, 4, 0.8, 8, -8), (0, -1.6, 4.5, 0.7, 0)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, -3.95)); s_ = bpy.context.active_object
    s_.scale = (sx, sy, 1); s_.rotation_euler.z = __import__("math").radians(rz); M.assign(s_, "Lava")
for i, (x, y, h) in enumerate(((-3.0, 4, 8), (3.4, 5, 9), (-6, 12, 12), (7, 13, 10), (-1.2, 18, 6))):
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.6, radius2=0.12, depth=h, location=(x, y, -4 + h / 2))
    M.assign(bpy.context.active_object, "Basalt")
cams = {
  "hero": R.camera("CAM_hero", (0, -1.31, 0.22), (0, 10.0, 0.615), 28),
  "codex_hero": R.camera("CAM_codex_hero", (0, -1.05, 0.32), (0, 0.8, 0.22), 20),
}
for k, c in cams.items():
    R.render_to(os.path.join(CL, "renders", "sky", f"{ITER}_{k}.png"), c)
print("DONE", round(time.time() - t0, 1))
