"""Terrain layout preview: every CFCL_Terrain_* asset placed through its arrangement.json with the SAME helper
Codex integration uses (lib/cf_integrate.append_asset), plus the board (read-only append), a disc stand-in for
the optional dais (Z=-0.76, r=3.6), the hero skull/hand assets if present (context only), the shared sky /
eclipse / light / fog rig (lib/cf_atmos).  Renders hero, seated, elevated and a top orthographic view.

Run:  python lib/run_blender.py scripts/terrain_layout.py -- --iter 1 [--nomonuments]
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import terrain_common as T
import terrain_layout_data as LD
from terrain_common import np, bpy, M, R

args = T.get_args()
ITER = int(args.get("iter", 1))
OUT = os.path.join(T.RENDERS, "layout")
os.makedirs(OUT, exist_ok=True)


def main():
    import cf_integrate as CI
    import cf_atmos as A
    R.reset_scene()
    sc = bpy.context.scene
    root = T.new_collection("CFCL_LayoutPreview")
    warn = []
    placed = {}
    for asset in ("CFCL_Terrain_Central", "CFCL_Terrain_Abyss", "CFCL_Terrain_Ribs", "CFCL_Terrain_FarCliffs",
                  "CFCL_Terrain_Islands"):
        folder = os.path.join(T.ASSETS, asset)
        if CI.latest_blend(folder):
            placed[asset] = CI.append_asset(folder, root, warnings=warn)
            T.log(asset, "placed", len(placed[asset]))
    if not args.get("nomonuments"):
        for asset in ("CFCL_Hero_Skull", "CFCL_Hero_Hand", "CFCL_Arch_RuinsKit", "CFCL_Arch_FarRuins",
                      "CFCL_Arch_AltarDais", "CFCL_FromCodex_CC0Banks"):
            folder = os.path.join(T.ASSETS, asset)
            if CI.latest_blend(folder):
                try:
                    placed[asset] = CI.append_asset(folder, root, warnings=warn)
                except Exception as e:
                    warn.append(f"{asset}: {e}")
    for w in warn:
        T.log("WARN", w)
    bcol = R.append_board()
    # MAIN SCENE: massive board (2.3 m squares in world = x28.75; env = world / 4.6 -> x6.25), base on the dais
    from mathutils import Matrix
    bs = 28.75 / 4.6
    Mb = Matrix.Translation((0, 0, -0.76 + 0.054 * bs)) @ Matrix.Scale(bs, 4)
    for o in bcol.all_objects:
        if o.parent is None:
            o.matrix_world = Mb @ o.matrix_world
    if "CFCL_Arch_AltarDais" not in placed:
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=4.4, depth=0.1, location=(0, 0, -0.81))
        dais = bpy.context.active_object
        dais.name = "CFCL_StandIn_Dais"
        M.assign(dais, "AncientStone")
    A.build_world(sc)
    rig = T.new_collection("CFCL_PreviewRig")
    A.build_light_rig(rig)
    A.build_fog_volume(rig, density=0.016)
    try:
        A.build_lava_mist(rig, z0=-5.5, z1=-1.2, extent=70.0, density=0.05)
    except Exception as e:
        T.log("mist failed", e)
    try:
        A.build_eclipse(rig)
    except Exception as e:
        T.log("eclipse failed", e)
    R.setup_render(sc, "EEVEE", (1280, 720), 48)
    pre = os.path.join(OUT, f"iter{ITER:02d}")
    # ---- gameplay rule: nothing may block the board in the world cameras -> ray-cast check (board top grid)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    from mathutils import Vector
    rib_names = set()
    for n, o in placed.get("CFCL_Terrain_Ribs", {}).items():
        rib_names.add(o.name)
    block = {}
    bz = (0.0 - 1.94) / 4.6 + 0.01                     # board playing surface in env units
    gx = np.linspace(-2.6, 2.6, 17)
    for k in ("w_god", "w_hero", "w_high34", "w_worm"):
        c = LD.CAMS[k]
        cam_p = Vector(c["loc"])
        hits = {}
        for x in gx:
            for y in gx:
                tgt = Vector((x, y, bz))
                d = tgt - cam_p
                dist = d.length
                ok, loc, nrm, idx, ob, mtx = sc.ray_cast(dg, cam_p, d.normalized(), distance=dist - 0.05)
                if ok and ob is not None and ob.name in rib_names:
                    hits[ob.name] = hits.get(ob.name, 0) + 1
        block[k] = hits
        T.log("BOARD-BLOCK", k, hits if hits else "clear")
    T.write_json(os.path.join(OUT, f"iter{ITER:02d}_board_block.json"), block)
    for k in ("w_god", "w_hero", "w_high34", "w_worm", "hero_low"):
        c = LD.CAMS[k]
        R.render_to(f"{pre}_{k}.png", R.camera("CFCL_Layout_" + k, c["loc"], c["target"], c["lens"]))
    cd = bpy.data.cameras.new("CFCL_Layout_Top")
    cd.type = "ORTHO"
    cd.ortho_scale = 46
    cd.clip_end = 500
    co = bpy.data.objects.new("CFCL_Layout_Top", cd)
    sc.collection.objects.link(co)
    co.location = (0, 5, 60)
    for o in sc.objects:              # fog box would grey the plan view
        if o.name.startswith(("CFCL_Fog_Volume", "CFCL_LavaMist")):
            o.hide_render = True
    sc.render.resolution_x, sc.render.resolution_y = 1100, 1100
    R.render_to(f"{pre}_top.png", co)
    T.write_json(os.path.join(OUT, f"iter{ITER:02d}_warnings.json"), {"warnings": warn,
                 "placed": {k: len(v) for k, v in placed.items()}})


main()
