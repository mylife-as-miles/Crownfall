"""Place the supplied four-armed creature (vendor/sorcerer_v3_1, v3.1 rig, unchanged) in the King's Gambit arena
as a colossal environmental character overlooking the board.

The rig and mesh are appended as authored: skeleton, weights, 4K textures and the Idle / Threat_Cast / Attack actions.
One parent empty, CFCL_Sorcerer_Root, carries a uniform scale; the rig keeps an identity transform under it. The
rig's NLA tracks are muted, so exactly one action drives it, and nothing else animates its bones.

  candidates : load <ver_in>; for each named candidate, place the creature (and a stone dais when the spot has no
               flat top), render the hero camera at 50 % EEVEE -> renders/sorcerer/cand_<name>.png. Nothing is saved.
  final      : place at one candidate, check the robe/platform contact over every frame of every clip, save
               main/Crownfall_Main_<ver_out>.blend (ver_in is not modified), write assets/CFCL_Sorcerer/placement.json.
Usage: python lib/run_blender.py scripts/sorcerer_place.py -- <ver_in> candidates <name,...>
       python lib/run_blender.py scripts/sorcerer_place.py -- <ver_in> final <name> <ver_out>"""
import json
import math
import os
import re
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import cf_render as R  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
VER_IN, MODE, NAMES = argv[0], argv[1], argv[2].split(",")
VER_OUT = argv[3] if len(argv) > 3 else None
SRC = os.path.join(CL, "vendor", "sorcerer_v3_1", "Crownfall_Sorcerer_Digits_v3_1.blend")
PIECE_M = 2.3                    # a standing officer (knight / bishop / rook / queen) in this arena
SRC_H = 0.982                    # creature height in its own units (inspect.json, Idle zmax)
HEM_R = 0.445                    # widest robe / arm reach from the rig axis over all clips (inspect.json)
# x, y in arena metres; mult x a standing piece; rise = dais height above the ground (None = stand on what is there)
CANDS = {
    # round 1 (2026-10-25): the area past the board drops to an abyss (z ~ -7); spots behind the monuments were hidden
    "under_eclipse": dict(xy=(9.0, 84.0), mult=8.0, rise=1.6),
    "left_mesa":     dict(xy=(-50.0, 160.0), mult=10.0, rise=None),
    "tower_crown":   dict(xy=(22.0, 137.0), mult=10.0, rise=None),
    "right_ridge":   dict(xy=(44.0, 104.0), mult=10.0, rise=7.0),
    # round 2: head just under the eclipse disc (screen y ~31 %), feet above the far horizon, between skull and hand
    "front_eclipse_8x":  dict(xy=(10.0, 80.0), mult=8.0, top=1.0),
    "front_eclipse_10x": dict(xy=(12.0, 82.0), mult=10.0, top=-3.6),
    "behind_corona_10x": dict(xy=(14.0, 118.0), mult=10.0, top=-1.0),
}
SKIP = re.compile(r"Sorcerer|Crownfall_FourArm|Sky|Cloud|Smoke|Fog|Mist|Volume|Shatter|Eclipse|Ember|Haze|Corona|Dust|Veg_|Meshy_(coral|crimson|fungus)"
                  r"|Stream_\d+_Chunk|Glow|Beam|Spark|Lava(?!.*Cooled)", re.I)


def ground_z(sc, x, y, top=400.0):
    """highest solid surface under (x, y), ignoring atmosphere / fx / loose debris."""
    dg = bpy.context.evaluated_depsgraph_get()
    o = Vector((x, y, top))
    for _ in range(40):
        hit, loc, nrm, idx, ob, M = sc.ray_cast(dg, o, Vector((0, 0, -1)))
        if not hit:
            return 0.0, None
        if SKIP.search(ob.name) or ob.hide_render:
            o = loc - Vector((0, 0, 0.01))
            continue
        return loc.z, ob.name
    return 0.0, None


def stone_material():
    for n in ("CFCL_Arch_DaisFloor", "CFCL_Arch_Approaches"):
        ob = bpy.data.objects.get(n)
        if ob and ob.material_slots and ob.material_slots[0].material:
            return ob.material_slots[0].material
    return None


def build_dais(name, x, y, z_ground, z_top, r_top, col):
    """stepped octagonal drum: a sunk footing plus three tiers, flat top at z_top (radius r_top)."""
    bm = bmesh.new()
    rise = z_top - z_ground
    tiers = [(r_top + 3.2, z_ground - 4.0, z_ground + rise * 0.34), (r_top + 1.6, z_ground + rise * 0.34, z_ground + rise * 0.68),
             (r_top, z_ground + rise * 0.68, z_top)]
    for r, z0, z1 in tiers:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r, radius2=r * 0.985, depth=z1 - z0,
                              matrix=Matrix.Translation((0, 0, (z0 + z1) / 2)) @ Matrix.Rotation(math.pi / 16, 4, "Z"))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (x, y, 0)
    col.objects.link(ob)
    m = stone_material()
    if m:
        me.materials.append(m)
    ob["cfcl_pbr_k"] = 1.0
    return ob


def append_creature(col):
    with bpy.data.libraries.load(SRC, link=False) as (s, d):
        d.objects = ["Crownfall_FourArm_Rig", "Crownfall_Sorcerer_Deform"]
        d.actions = ["Idle", "Threat_Cast", "Attack"]
    rig, body = d.objects
    for o in (rig, body):
        col.objects.link(o)
    root = bpy.data.objects.new("CFCL_Sorcerer_Root", None)
    root.empty_display_type, root.empty_display_size = "ARROWS", 1.0
    col.objects.link(root)
    rig.parent = root
    rig.matrix_parent_inverse = Matrix.Identity(4)
    rig.location, rig.rotation_euler, rig.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
    ad = rig.animation_data
    for t in ad.nla_tracks:
        t.mute = True                                   # one action drives the rig; nothing competes with it
    ad.action = bpy.data.actions["Idle"]
    return root, rig, body


def place(sc, name, col, root):
    c = CANDS[name]
    x, y = c["xy"]
    H = c["mult"] * PIECE_M
    S = H / SRC_H
    zg, hit = ground_z(sc, x, y)
    dais = None
    if c.get("top") is not None or c.get("rise") is not None:
        z_top = c["top"] if c.get("top") is not None else zg + c["rise"]
        dais = build_dais("CFCL_Sorcerer_Dais", x, y, zg, z_top, HEM_R * S + 1.5, col)
    else:
        z_top = zg
    yaw = math.atan2(-x, y)                             # local -Y (the creature's front) toward the board centre
    root.location = (x, y, z_top)
    root.rotation_euler = (0, 0, yaw)
    root.scale = (S, S, S)
    return dict(name=name, xy=[x, y], ground_z=round(zg, 3), ground_hit=hit, top_z=round(z_top, 3), height_m=round(H, 2),
                scale=round(S, 3), mult=c["mult"], yaw_deg=round(math.degrees(yaw), 1),
                dais=dais.name if dais else None, dais_top_r=round(HEM_R * S + 1.5, 2) if dais else None)


def rim_light(col, root, H):
    """restrained warm rim from behind / above, aimed back at the creature (eclipse side)."""
    ld = bpy.data.lights.new("CFCL_Sorcerer_Rim", "AREA")
    ld.shape, ld.size = "DISK", H * 0.6
    ld.color = (1.0, 0.62, 0.36)
    ld.energy = 16.0 * H * H
    lo = bpy.data.objects.new("CFCL_Sorcerer_Rim", ld)
    col.objects.link(lo)
    p = root.location
    fwd = Vector((-math.sin(root.rotation_euler.z), math.cos(root.rotation_euler.z), 0))   # creature's back (+Y local)
    lo.location = p + fwd * H * 0.9 + Vector((0, 0, H * 1.05))
    lo.rotation_euler = (p + Vector((0, 0, H * 0.6)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    return lo


bpy.ops.wm.open_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER_IN}.blend"), load_ui=False)
sc = bpy.context.scene
col = bpy.data.collections.new("CF_40_SORCERER")
sc.collection.children.link(col)
root, rig, body = append_creature(col)
sc.frame_set(37)                                       # mid-Idle
out_dir = os.path.join(CL, "renders", "sorcerer")
os.makedirs(out_dir, exist_ok=True)
hero = bpy.data.objects.get("CF_CAM_hero") or R.camera("CF_CAM_hero", (0, -30.0, 9.0), (0, 20, 5.5), 24)
if MODE == "candidates":
    rep = {}
    for n in NAMES:
        d = bpy.data.objects.get("CFCL_Sorcerer_Dais")
        if d:
            bpy.data.objects.remove(d, do_unlink=True)
        info = place(sc, n, col, root)
        bpy.context.view_layer.update()
        sc.render.engine = "BLENDER_EEVEE"
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 50
        sc.camera = hero
        sc.render.filepath = os.path.join(out_dir, f"cand_{n}.png")
        bpy.ops.render.render(write_still=True)
        rep[n] = info
        print("SORCCAND", json.dumps(info))
    R.write_json(os.path.join(out_dir, "candidates.json"), rep)
else:
    n = NAMES[0]
    info = place(sc, n, col, root)
    rim = rim_light(col, root, info["height_m"])
    bpy.context.view_layer.update()
    # contact: every frame of every clip, robe hem against the platform top (creature space z=0 is the hem)
    contact = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for clip in ("Idle", "Threat_Cast", "Attack"):
        act = bpy.data.actions[clip]
        rig.animation_data.action = act
        lo, hi = 1e9, -1e9
        for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1):
            sc.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            ev = body.evaluated_get(dg)
            me = ev.to_mesh()
            zs = [(body.matrix_world @ v.co).z for v in me.vertices]
            ev.to_mesh_clear()
            lo, hi = min(lo, min(zs)), max(hi, min(zs))
        contact[clip] = {"hem_min_z": round(lo, 4), "hem_max_z": round(hi, 4),
                         "penetration_m": round(max(0.0, info["top_z"] - lo), 4),
                         "max_gap_m": round(max(0.0, hi - info["top_z"]), 4)}
    rig.animation_data.action = bpy.data.actions["Idle"]
    sc.frame_set(37)
    info.update(contact=contact, rim=rim.name, rim_energy_W=rim.data.energy, rig_bones=len(rig.data.bones),
                tris=sum(len(p.vertices) - 2 for p in body.data.polygons),
                clips={a: [int(bpy.data.actions[a].frame_range[0]), int(bpy.data.actions[a].frame_range[1])]
                       for a in ("Idle", "Threat_Cast", "Attack")},
                note="v3.1 rig appended unchanged; one parent scale; NLA muted, Idle active; nothing else drives its bones")
    R.write_json(os.path.join(CL, "assets", "CFCL_Sorcerer", "placement.json"), info)
    print("SORCFINAL", json.dumps(info))
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CL, "main", f"Crownfall_Main_{VER_OUT}.blend"))
