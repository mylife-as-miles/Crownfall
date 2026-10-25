"""Preview the v009+ worldbuilding pieces (CFCL_Ruin_SkullShrine, CFCL_Ruin_HandArcade) WITH the real hero skull and
hand assets at their main-build placements (world = env*4.6 + (0,0,1.94); hand group x1.25).  Read-only: nothing
is saved.  Renders renders/arch/monuments_<tag>_*.png.

python lib/run_blender.py scripts/arch_monument_preview.py --timeout 1200 -- --kitver 11 --tag v011
"""
import glob
import math
import os
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
for _p in (os.path.join(CL, "lib"), os.path.join(CL, "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402
import cf_render as R  # noqa: E402
import cf_materials as M  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
KITVER = int(ARGV[ARGV.index("--kitver") + 1]) if "--kitver" in ARGV else 11
TAG = ARGV[ARGV.index("--tag") + 1] if "--tag" in ARGV else f"v{KITVER:03d}"
RDIR = os.path.join(CL, "renders", "arch")
W = Matrix.Translation((0, 0, 1.94)) @ Matrix.Scale(4.6, 4)
SKULL = ((-2.85, 9.49, -0.38), 33.0, 1.0)
HAND = ((4.5, 10.0, -0.35), -22.0, 1.25)


def latest(folder, stem):
    f = sorted(glob.glob(os.path.join(CL, "assets", folder, stem + "_v*.blend")))
    return f[-1]


def append(path, names):
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    out = []
    for o in dst.objects:
        if o is not None:
            bpy.context.scene.collection.objects.link(o)
            out.append(o)
    return out


def place(objs, loc, yaw, scale):
    G = W @ Matrix.Translation(loc) @ Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Scale(scale, 4)
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = G @ mw


def main():
    R.reset_scene()
    sc = bpy.context.scene
    kit = latest("CFCL_Arch_RuinsKit", "CFCL_Arch_RuinsKit")
    kit = os.path.join(CL, "assets", "CFCL_Arch_RuinsKit", f"CFCL_Arch_RuinsKit_v{KITVER:03d}.blend")
    shrine = append(kit, {"CFCL_Ruin_SkullShrine"})
    arcade = append(kit, {"CFCL_Ruin_HandArcade"})
    for o in shrine + arcade:
        o.location = (0, 0, 0)
    bpy.context.view_layer.update()
    place(shrine, *SKULL)
    place(arcade, HAND[0], HAND[1], 1.0)
    skull = append(latest("CFCL_Hero_Skull", "CFCL_Hero_Skull"),
                   {"CFCL_Hero_Skull", "CFCL_Hero_Skull_Mandible", "CFCL_Hero_Skull_Rubble"})
    hand = append(latest("CFCL_Hero_Hand", "CFCL_Hero_Hand"),
                  {"CFCL_Hero_Hand", "CFCL_Hero_Hand_Mound", "CFCL_Hero_Hand_FingerFragment", "CFCL_Hero_Hand_Manacle"})
    place(skull, *SKULL)
    place(hand, *HAND)
    R.setup_render(sc, "EEVEE", (1280, 720), 40)
    R.setup_world(sc)
    R.standard_lights(scale=25.0)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 30, 0.15))
    M.assign(bpy.context.active_object, "Basalt", moss=0.3)
    # 21.85 m board stand-in (world)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, (0.008 - 1.556) / 2))
    b = bpy.context.active_object
    b.scale = (21.85, 21.85, 1.564)
    shots = [("hero", (0, -30, 9), (0, 20, 5.5), 24), ("god", (0, -26, 30), (0, 2, -2), 26),
             ("skull", (-1.5, 22.0, 7.0), (-13.1, 43.7, 3.0), 32), ("hand", (8.0, 25.0, 7.5), (20.7, 46.0, 4.5), 32),
             ("skull_side", (-30.0, 30.0, 6.0), (-13.1, 43.7, 2.5), 35)]
    for name, loc, tgt, lens in shots:
        R.render_to(os.path.join(RDIR, f"monuments_{TAG}_{name}.png"), R.camera("CAM_" + name, loc, tgt, lens))


main()
