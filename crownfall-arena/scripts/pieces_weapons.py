"""Crownfall (Claude track) - hand-held arms for the posed piece sculpts, after the game's own LOADOUT
(Crownfall web/src/scene/weapons.ts: kingdom = Ivory, sun = Sun Empire). The figures were generated unarmed; the game
parents primitive-built props to the hand bones. Here the same families are built as Blender primitives, sized from the
figure's height (unit), mounted on the posed RightHand / LeftHand bone heads, blade/shaft up-and-forward, shields
facing the figure's front (-Y before placement). No emblems: plain metal, wood, stone, obsidian, feathers."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

LOADOUT = {
    "ivory": {"k": ("greatsword", None), "q": ("scepter", None), "b": ("crystalStaff", None),
              "n": ("longsword", "heaterShield"), "r": ("warhammer", "towerShield"), "p": ("spear", "roundShield")},
    "sun": {"k": ("royalMacuahuitl", None), "q": ("sunScepter", None), "b": ("serpentStaff", None),
            "n": ("macuahuitl", "chimalli"), "r": ("stoneMaul", "greatChimalli"), "p": ("tepoztopilli", "chimalli")},
}
_MATS = {"steel": ((0.62, 0.63, 0.66), 1.0, 0.32, 0), "wood": ((0.24, 0.14, 0.07), 0.0, 0.72, 0),
         "gold": ((1.0, 0.72, 0.32), 1.0, 0.28, 0), "obsidian": ((0.02, 0.02, 0.025), 0.0, 0.12, 0),
         "stone": ((0.34, 0.32, 0.29), 0.0, 0.88, 0), "jade": ((0.10, 0.42, 0.28), 0.0, 0.35, 0),
         "crystal": ((0.65, 0.85, 1.0), 0.0, 0.1, 2.5), "ivorypaint": ((0.40, 0.38, 0.35), 0.6, 0.5, 0),
         "bluepaint": ((0.10, 0.17, 0.38), 0.0, 0.6, 0), "redpaint": ((0.55, 0.07, 0.04), 0.0, 0.6, 0),
         "feather": ((0.08, 0.40, 0.22), 0.0, 0.8, 0)}


def mat(key):
    name = "CFCL_Wpn_" + key
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough, emit = _MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def _obj(bm, key, M):
    me = bpy.data.meshes.new("wpn")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat(key))
    ob = bpy.data.objects.new("wpn", me)
    ob.matrix_world = M
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cyl(r1, r2, length, key, M, seg=10):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=length,
                          matrix=Matrix.Translation((0, 0, length / 2)))
    return _obj(bm, key, M)


def box(sx, sy, sz, key, M, z0=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0,
                          matrix=Matrix.Translation((0, 0, z0 + sz / 2)) @ Matrix.Diagonal((sx, sy, sz, 1)))
    return _obj(bm, key, M)


def sphere(r, key, M, z0=0.0, sz=1.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r,
                              matrix=Matrix.Translation((0, 0, z0)) @ Matrix.Diagonal((1, 1, sz, 1)))
    return _obj(bm, key, M)


def disc(r, depth, key, M, seg=20):
    """shield disc: axis along local Z (the direction it faces)."""
    return cyl(r, r, depth, key, M @ Matrix.Translation((0, 0, -depth / 2)), seg)


def frame(origin, axis, front):
    """matrix with local Z = axis, local Y ~ front, at origin."""
    z = axis.normalized()
    y = (front - z * front.dot(z)).normalized()
    x = y.cross(z)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = origin
    return M


def plate(sx, sz, depth, key, M):
    """flat shield plate facing local Z (sx wide, sz tall along local Y), centred on M."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((sx, sz, depth, 1)))
    return _obj(bm, key, M)


def build(skin, kind, rh, lh, unit, front=Vector((0, -1, 0))):
    """props for one figure. rh / lh: world positions of the posed hand bone heads; unit = figure height."""
    main, off = LOADOUT[skin][kind]
    U = unit
    up = Vector((0, 0, 1))
    right_out = (rh - lh).normalized() if (rh - lh).length > 1e-6 else Vector((-1, 0, 0))
    out = []
    if main in ("spear", "tepoztopilli", "crystalStaff", "serpentStaff"):
        ax = (up + front * 0.12 + right_out * 0.06).normalized()
        M = frame(rh - ax * 0.42 * U, ax, front)
        L = 1.12 * U if "Staff" not in main else 1.0 * U
        out.append(cyl(0.011 * U, 0.009 * U, L, "wood", M))
        top = M @ Matrix.Translation((0, 0, L))
        if main == "spear":
            out.append(cyl(0.022 * U, 0.0, 0.13 * U, "steel", top))
        elif main == "tepoztopilli":       # broad wooden head edged with obsidian
            out.append(box(0.07 * U, 0.012 * U, 0.17 * U, "wood", top))
            for sx in (-1, 1):
                out.append(box(0.012 * U, 0.016 * U, 0.15 * U, "obsidian",
                               top @ Matrix.Translation((sx * 0.038 * U, 0, 0.01 * U))))
        elif main == "crystalStaff":
            out.append(sphere(0.035 * U, "crystal", top, 0.04 * U, 1.8))
        else:                               # serpent staff: jade head + gold collar
            out.append(sphere(0.04 * U, "jade", top, 0.035 * U, 1.3))
            out.append(cyl(0.02 * U, 0.02 * U, 0.02 * U, "gold", top))
    elif main in ("longsword", "greatsword", "macuahuitl", "royalMacuahuitl"):
        big = main in ("greatsword", "royalMacuahuitl")
        ax = (up + front * (0.12 if big else 0.45)).normalized()
        M = frame(rh, ax, front)
        if "sword" in main:
            L = (0.82 if big else 0.5) * U
            out.append(box(0.04 * U, 0.009 * U, L, "steel", M, 0.03 * U))
            out.append(box(0.14 * U if big else 0.11 * U, 0.02 * U, 0.018 * U, "gold" if big else "steel", M, 0.02 * U))
            out.append(cyl(0.011 * U, 0.011 * U, 0.06 * U, "wood", M @ Matrix.Translation((0, 0, -0.04 * U))))
        else:
            L = (0.62 if big else 0.45) * U
            out.append(box(0.065 * U, 0.013 * U, L, "wood", M, 0.03 * U))
            for sx in (-1, 1):
                out.append(box(0.012 * U, 0.017 * U, L * 0.85, "obsidian",
                               M @ Matrix.Translation((sx * 0.036 * U, 0, 0.08 * U))))
            if big:
                out.append(box(0.08 * U, 0.02 * U, 0.025 * U, "gold", M, 0.02 * U))
    elif main in ("warhammer", "stoneMaul"):
        ax = (up + front * 0.25 + right_out * 0.1).normalized()
        M = frame(rh - ax * 0.22 * U, ax, front)
        L = 0.78 * U
        out.append(cyl(0.012 * U, 0.012 * U, L, "wood", M))
        head = M @ Matrix.Translation((0, 0, L))
        if main == "warhammer":
            out.append(box(0.16 * U, 0.055 * U, 0.06 * U, "steel", head, -0.03 * U))
        else:
            out.append(box(0.17 * U, 0.1 * U, 0.1 * U, "stone", head, -0.05 * U))
    elif main in ("scepter", "sunScepter"):
        ax = (up + front * 0.3).normalized()
        M = frame(rh - ax * 0.06 * U, ax, front)
        out.append(cyl(0.01 * U, 0.008 * U, 0.36 * U, "gold", M))
        top = M @ Matrix.Translation((0, 0, 0.36 * U))
        if main == "scepter":
            out.append(sphere(0.03 * U, "gold", top, 0.02 * U))
        else:                               # sun disc with rays, facing the front
            sd = frame(top.translation + ax * 0.04 * U, front, up)
            out.append(disc(0.045 * U, 0.01 * U, "gold", sd))
            for i in range(10):
                a = 2 * math.pi * i / 10
                out.append(box(0.008 * U, 0.06 * U, 0.006 * U, "gold",
                               sd @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0, 0.07 * U, 0))))
    if off:
        sh = frame(lh + front * 0.05 * U - right_out * 0.03 * U, front, up)    # local Z = facing direction
        if off == "roundShield":
            out.append(disc(0.15 * U, 0.022 * U, "steel", sh))
            out.append(sphere(0.03 * U, "gold", sh, 0.012 * U, 0.6))
        elif off == "heaterShield":
            out.append(plate(0.27 * U, 0.34 * U, 0.022 * U, "bluepaint", sh))
            out.append(disc(0.035 * U, 0.03 * U, "gold", sh))
        elif off == "towerShield":
            out.append(plate(0.32 * U, 0.55 * U, 0.026 * U, "ivorypaint", sh))
        else:                               # chimalli: red disc, gold rim, green feather band
            r = (0.22 if off == "greatChimalli" else 0.16) * U
            out.append(disc(r, 0.02 * U, "redpaint", sh))
            out.append(disc(r * 1.08, 0.012 * U, "gold", sh @ Matrix.Translation((0, 0, -0.012 * U))))
            out.append(disc(r * 0.45, 0.026 * U, "feather", sh))
    return out
