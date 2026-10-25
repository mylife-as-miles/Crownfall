"""Pack the Crownfall game's own piece sculpts (web/src/assets/generated.ts STILL_MODELS: White = Ivory Kingdom,
Black = Sun Empire, the game's DEFAULT_ARMY_SKINS) into assets/CFCL_Pieces/CFCL_Pieces_v###.blend + arrangement.json.

Each sculpt is normalised to 1 m tall (origin = base centre); placements put the 32 figures on the opening position
at the game's heights (web/src/scene/pieces.ts PIECE_HEIGHT, in squares) x 2.3 m per square, snapped onto the tiles.
Square centres follow the board contract: ((f-3.5)*2.3, (r-3.5)*2.3), a1 dark at White's left (-Y side).
Usage: python lib/run_blender.py scripts/pieces_make_asset.py -- <ver> [face_sign]"""
import sys, os, json, math, random
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Matrix, Vector
import cf_render as R
sys.path.insert(0, os.path.join(CL, "scripts"))
import pieces_weapons as PW

argv = sys.argv[sys.argv.index("--") + 1:]
VER = argv[0]
FACE_NEG_Y = (argv[1] if len(argv) > 1 else "negy") == "negy"   # glTF +Z forward imports facing -Y
ROOT = os.path.join(CL, "assets", "CFCL_Pieces")
SQ = 2.3
HEIGHT = {"p": 0.78, "n": 0.98, "b": 1.0, "r": 0.99, "q": 1.0, "k": 1.12}   # squares (game PIECE_HEIGHT)
SKIN = {"w": "ivory", "b": "sun"}
BACK = "rnbqkbnr"

def _glb_read(p):
    import struct
    b = open(p, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    js = json.loads(b[20:20 + n])
    rest = b[20 + n:]
    binc = rest[8:8 + struct.unpack_from("<I", rest, 0)[0]] if len(rest) >= 8 else b""
    return js, binc


def merge_clip(rig_p, clip_p, out_p):
    """Copy the clip GLB's animation (skinless node TRS tracks) into the rigged GLB, retargeted by node name, so the
    glTF importer builds a proper armature action on the real rig."""
    import struct
    R_, Rb = _glb_read(rig_p)
    A, Ab = _glb_read(clip_p)
    pad = (-len(Rb)) % 4
    base = len(Rb) + pad
    Rb = Rb + b"\0" * pad + Ab
    bv0, ac0 = len(R_.get("bufferViews", [])), len(R_.get("accessors", []))
    for bv in A.get("bufferViews", []):
        bv = dict(bv, buffer=0, byteOffset=bv.get("byteOffset", 0) + base)
        R_.setdefault("bufferViews", []).append(bv)
    for ac in A.get("accessors", []):
        R_.setdefault("accessors", []).append(dict(ac, bufferView=ac["bufferView"] + bv0))
    by_name = {n.get("name"): i for i, n in enumerate(R_["nodes"])}
    anims = []
    for an in A.get("animations", []):
        ch = []
        for c in an["channels"]:
            nm = A["nodes"][c["target"]["node"]].get("name")
            if nm in by_name:
                ch.append({"sampler": c["sampler"], "target": {"node": by_name[nm], "path": c["target"]["path"]}})
        sm = [dict(s, input=s["input"] + ac0, output=s["output"] + ac0) for s in an["samplers"]]
        anims.append({"name": an.get("name", "clip"), "channels": ch, "samplers": sm})
    R_["animations"] = anims          # the rig's own clip0 is a single rest key: replace it
    R_["buffers"] = [{"byteLength": len(Rb)}]
    jb = json.dumps(R_, separators=(",", ":")).encode()
    jb += b" " * ((-len(jb)) % 4)
    Rb += b"\0" * ((-len(Rb)) % 4)
    total = 12 + 8 + len(jb) + 8 + len(Rb)
    with open(out_p, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(jb), b"JSON") + jb)
        f.write(struct.pack("<I4s", len(Rb), b"BIN\0") + Rb)
    return sum(len(a["channels"]) for a in anims)


# v024 (critic: cloned poses): several frozen frames per figure - combat stance early/late and an advancing step for
# the soldiery, two breaths of the idle for the crown
VARIANTS = {"royal": [("idle", 0.30), ("idle", 0.72)],
            "troop": [("idle", 0.22), ("idle", 0.68), ("walk", 0.30)]}


def make_variant(skin, kind, clip, frac, vname):
    tag = f"{skin}_{kind}"
    before = set(bpy.data.objects)
    char_bounds = None
    rig_p = os.path.join(ROOT, "src", tag + "_rigged.glb")
    clip_p = os.path.join(ROOT, "src", f"{tag}_{clip}.glb")
    posed = None
    if os.path.exists(rig_p) and os.path.exists(clip_p):
        merged = os.path.join(ROOT, "src", f"{tag}_{vname}_posed_src.glb")
        nch = merge_clip(rig_p, clip_p, merged)
        bpy.ops.import_scene.gltf(filepath=merged)
        rig_objs = [o for o in bpy.data.objects if o not in before]
        arm = next((o for o in rig_objs if o.type == "ARMATURE"), None)
        act = arm.animation_data.action if arm and arm.animation_data else None
        if arm and act and nch:
            f0, f1 = act.frame_range
            bpy.context.scene.frame_set(int(f0 + (f1 - f0) * frac))
            dg = bpy.context.evaluated_depsgraph_get()
            parts = []
            # only the skinned character mesh (the rig GLBs also carry a stray helper "Icosphere")
            for m in [o for o in rig_objs if o.type == "MESH" and any(md.type == "ARMATURE" for md in o.modifiers)]:
                me = bpy.data.meshes.new_from_object(m.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
                po = bpy.data.objects.new(m.name + "_posed", me)
                po.matrix_world = m.matrix_world.copy()
                bpy.context.scene.collection.objects.link(po)
                parts.append(po)
            # v026 (critic: empty-handed mannequins): the game's loadout, mounted on the posed hand bones
            cmn, cmx = R.bounds(parts)
            char_bounds = (cmn.copy(), cmx.copy())
            pbs = arm.pose.bones
            rhb, lhb = pbs.get("RightHand"), pbs.get("LeftHand")
            if rhb and lhb:
                parts += PW.build(skin, kind, arm.matrix_world @ rhb.head, arm.matrix_world @ lhb.head, cmx.z - cmn.z)
            posed = parts
            print("POSED", tag, vname, act.name, round(frac, 2), "armed" if rhb and lhb else "unarmed", flush=True)
        for o in rig_objs:
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
    if posed is None:
        bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "src", tag + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in new:
        try:                       # objects merged by join() are already gone
            if o != ob and o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass
    mn, mx = char_bounds if char_bounds else R.bounds([ob])      # size by the body, not by a spear
    h = max(mx.z - mn.z, 1e-6)
    ob.data.transform(Matrix.Scale(1.0 / h, 4) @ Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    ob.matrix_world = Matrix.Identity(4)
    ob.name = ob.data.name = f"CFCL_Piece_{tag}_{vname}"
    for i, s in enumerate(ob.material_slots):
        if s.material:
            if not s.material.name.startswith("CFCL_Wpn_"):
                s.material.name = f"CFCL_Piece_{tag}" + ("" if i == 0 else f"_{i}")
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    print("PIECE", ob.name, len(ob.data.polygons), [round(v, 2) for v in (mx - mn) / h], flush=True)
    return ob.name


R.reset_scene()
col = bpy.data.collections.new("CFCL_Pieces")
bpy.context.scene.collection.children.link(col)
SOURCES = {}
for skin in SKIN.values():
    for kind in HEIGHT:
        SOURCES[(skin, kind)] = [make_variant(skin, kind, clip, frac, f"v{i}")
                                 for i, (clip, frac) in enumerate(VARIANTS["royal" if kind in "kq" else "troop"])]
bpy.ops.file.pack_all()
out = os.path.join(ROOT, f"CFCL_Pieces_{VER}.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)

rnd = random.Random(1972)
pl = []
for side, ranks in (("w", (0, 1)), ("b", (7, 6))):
    face = 180.0 if (side == "w") == FACE_NEG_Y else 0.0     # White looks north (+Y), Black looks south (-Y)
    for f in range(8):
        for ri, r in enumerate(ranks):
            kind = BACK[f] if ri == 0 else "p"
            h = HEIGHT[kind] * SQ
            jit = 0.0 if kind in "kq" else 0.08
            src = SOURCES[(SKIN[side], kind)]
            h *= 1.0 + rnd.uniform(-0.03, 0.03)                       # v024: no two soldiers the same height
            pl.append({"source": rnd.choice(src),
                       "name": f"Piece_{side.upper()}_{'abcdefgh'[f]}{r + 1}_{kind}",
                       "location": [round((f - 3.5) * SQ + rnd.uniform(-jit, jit), 3),
                                    round((r - 3.5) * SQ + rnd.uniform(-jit, jit), 3), 0.0],
                       "rotation_deg": [0, 0, round(face + rnd.uniform(-7, 7) * (0.3 if kind in "kq" else 1), 1)],
                       "scale": [round(h, 3)] * 3, "snap": True, "sink": 0.0})
json.dump({"asset": "CFCL_Pieces", "blend": os.path.basename(out), "units": "world metres",
           "source": "Crownfall web/src/assets/generated.ts STILL_MODELS (ivory = White, sun = Black)",
           "placements": pl}, open(os.path.join(ROOT, "arrangement.json"), "w"), indent=1)
print("SAVED", out, len(pl), "placements")
