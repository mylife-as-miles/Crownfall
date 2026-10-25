"""Crownfall (Claude track) - v022 look fixes from the independent critic (layout_overrides["lookfix"]).

lava_pools : glowing lava welling up in the hollows at the skull and hand bases (+ rivers running off to the abyss),
             each pool with an upward warm area light so the lava actually lights the monuments from below.
             The pool plane sits at a low percentile of the local ground height, so bumps poke through and the lava
             only shows in hollows (no floating plates).
sky_grade  : darker top of frame (sky-dome emission fades with height) + crimson/ember-gold glow in the cracks
             (the light 'beyond' the shattered sky).
"""
import math
import random
import re

import bmesh
import bpy
from mathutils import Vector

SKIP = r"Fog|Mist|Volume|SkyShatter|Eclipse|Meshy_(Bush|Coral|Fungus|Landmass)|KB3D_Mega|Veg_|Cloud|Ember|Smoke|Stream|Lava"


def _ground(sc, x, y, z0=90.0):
    dg = bpy.context.evaluated_depsgraph_get()
    org = Vector((x, y, z0))
    for _ in range(16):
        hit, loc, nrm, idx, ob, mtx = sc.ray_cast(dg, org, Vector((0, 0, -1)), distance=200.0)
        if not hit:
            return None
        if re.search(SKIP, ob.name):
            org = loc - Vector((0, 0, 0.05))
            continue
        return loc.z, ob.name
    return None


def _lava_material():
    for nm in ("CFCL_Lava__glow1p5_heat2p2", "CFCL_Lava"):
        m = bpy.data.materials.get(nm)
        if m:
            return m
    m = bpy.data.materials.new("CFCL_LavaPool")
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (0.05, 0.02, 0.01, 1)
    b.inputs["Emission Color"].default_value = (1.0, 0.35, 0.06, 1)
    b.inputs["Emission Strength"].default_value = 6.0
    return m


def _pool_mesh(name, r, seed, n=48):
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, 6.28) for _ in range(3)]
    bm = bmesh.new()
    c = bm.verts.new((0, 0, 0))
    ring = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * (0.78 + 0.16 * math.sin(2 * a + ph[0]) + 0.1 * math.sin(3 * a + ph[1]) + 0.06 * math.sin(7 * a + ph[2]))
        ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr * 0.8, 0)))
    for i in range(n):
        bm.faces.new((c, ring[i], ring[(i + 1) % n]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def lava_pools(sc, cfg, col, log):
    mat = _lava_material()
    made = []
    for i, p in enumerate(cfg.get("pools", [])):
        x, y, r = p["xy"][0], p["xy"][1], p["r"]
        zs = []
        for gx in range(-3, 4):
            for gy in range(-3, 4):
                g = _ground(sc, x + gx * r / 3.2, y + gy * r / 3.2)
                if g:
                    zs.append(g[0])
        if len(zs) < 8:
            log.setdefault("lava_skipped", []).append(p)
            continue
        zs.sort()
        z = zs[int(len(zs) * p.get("pct", 0.35))] + 0.06
        me = _pool_mesh(f"CFCL_LavaPool_{i:02d}", r, 31 + i)
        me.materials.append(mat)
        ob = bpy.data.objects.new(f"CFCL_LavaPool_{i:02d}", me)
        ob.location = (x, y, z)
        ob.rotation_euler = (0, 0, math.radians(p.get("yaw", 0)))
        col.objects.link(ob)
        ob.visible_shadow = False
        # warm uplight: an area light lying in the pool, emitting upwards
        ld = bpy.data.lights.new(f"CFCL_LavaPool_{i:02d}_Up", "AREA")
        ld.shape, ld.size = "DISK", r * 1.6
        ld.energy = p.get("light", 6000.0) * (r / 5.0) ** 2
        ld.color = (1.0, 0.24, 0.05)   # v022b: deeper red-orange (first pass turned the skull copper)
        lo = bpy.data.objects.new(ld.name, ld)
        lo.location = (x, y, z + 0.6)
        lo.rotation_euler = (math.pi, 0, 0)
        col.objects.link(lo)
        made.append({"pool": ob.name, "z": round(z, 2), "ground_span": round(zs[-1] - zs[0], 2), "light_W": round(ld.energy)})
    for j, rv in enumerate(cfg.get("rivers", [])):
        pts, w = rv["pts"], rv.get("w", 1.4)
        dense = []
        for a, b in zip(pts[:-1], pts[1:]):
            steps = max(2, int(math.dist(a, b) / 1.0))
            for s in range(steps):
                t = s / steps
                dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        dense.append(tuple(pts[-1]))
        bm = bmesh.new()
        rnd = random.Random(70 + j)
        rows = []
        for k, (px, py) in enumerate(dense):
            nx, ny = (dense[min(k + 1, len(dense) - 1)][0] - dense[max(k - 1, 0)][0],
                      dense[min(k + 1, len(dense) - 1)][1] - dense[max(k - 1, 0)][1])
            ln = math.hypot(nx, ny) or 1.0
            ox, oy = -ny / ln, nx / ln
            g = _ground(sc, px, py)
            if not g:
                rows.append(None)
                continue
            hw = w * 0.5 * (0.6 + 0.8 * rnd.random()) * (1 - 0.5 * k / len(dense))
            rows.append((bm.verts.new((px + ox * hw, py + oy * hw, g[0] + 0.08)),
                         bm.verts.new((px - ox * hw, py - oy * hw, g[0] + 0.08))))
        for a, b in zip(rows[:-1], rows[1:]):
            if a and b:
                bm.faces.new((a[0], a[1], b[1], b[0]))
        me = bpy.data.meshes.new(f"CFCL_LavaRiver_{j:02d}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(me.name, me)
        col.objects.link(ob)
        ob.visible_shadow = False
        made.append({"river": ob.name, "segments": len(rows)})
    log["lava_pools"] = made
    return made


def _scale_emission(m, factor_socket_fn):
    nt = m.node_tree
    n_done = 0
    for n in list(nt.nodes):
        sock = None
        if n.type == "EMISSION":
            sock = n.inputs["Strength"]
        elif n.type == "BSDF_PRINCIPLED":
            sock = n.inputs.get("Emission Strength")
        if sock is None:
            continue
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        if sock.is_linked:
            nt.links.new(sock.links[0].from_socket, mul.inputs[0])
        else:
            mul.inputs[0].default_value = sock.default_value
        factor_socket_fn(nt, mul.inputs[1])
        nt.links.new(mul.outputs[0], sock)
        n_done += 1
    return n_done


def sky_grade(sc, cfg, log):
    rep = {}
    dome = bpy.data.objects.get("CFCL_SkyShatter_Dome_Shell")
    if dome:
        zs = [(dome.matrix_world @ Vector(c)).z for c in dome.bound_box]
        z0 = min(zs) + (max(zs) - min(zs)) * cfg.get("top_from", 0.35)
        z1 = min(zs) + (max(zs) - min(zs)) * cfg.get("top_to", 0.9)

        def height_fade(nt, target, top=cfg.get("top_mul", 0.45)):
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(geo.outputs["Position"], sep.inputs[0])
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.interpolation_type = "SMOOTHSTEP"
            nt.links.new(sep.outputs["Z"], mr.inputs[0])
            mr.inputs[1].default_value, mr.inputs[2].default_value = z0, z1
            mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0, top
            nt.links.new(mr.outputs[0], target)

        for nm in cfg.get("darken", ["CFCL_SkyShatter_SkyFace"]):
            m = bpy.data.materials.get(nm)
            if m and m.node_tree:
                rep[nm] = _scale_emission(m, height_fade)
        rep["dome_z"] = [round(z0, 1), round(z1, 1)]
    tint = cfg.get("crack_tint", (1.0, 0.42, 0.14))
    for nm in cfg.get("cracks", ["CFCL_SkyShatter_Beyond"]):
        m = bpy.data.materials.get(nm)
        if not (m and m.node_tree):
            continue

        def boost(nt, target, k=cfg.get("crack_mul", 1.8)):
            target.default_value = k

        rep[nm] = _scale_emission(m, boost)
        nt = m.node_tree
        for n in list(nt.nodes):          # warm the crack light toward crimson / ember gold
            sock = n.inputs.get("Color") if n.type == "EMISSION" else (n.inputs.get("Emission Color") if n.type == "BSDF_PRINCIPLED" else None)
            if sock is None:
                continue
            mx = nt.nodes.new("ShaderNodeMix")
            mx.data_type, mx.blend_type = "RGBA", "MULTIPLY"
            mx.inputs[0].default_value = cfg.get("crack_tint_amt", 0.65)
            mx.inputs[7].default_value = (*tint, 1.0)
            if sock.is_linked:
                nt.links.new(sock.links[0].from_socket, mx.inputs[6])
            else:
                mx.inputs[6].default_value = sock.default_value
            nt.links.new(mx.outputs[2], sock)
    log["sky_grade"] = rep
    return rep




def board_overlays(cfg, log):
    """v027: real CC0 wear masks on the board squares (ambientCG Scratches005 / SurfaceImperfections013 alpha), each tile
    offset by its object random so no two squares share the same marks; roughness-led so the 64 squares stay readable."""
    import os
    import cf_pbr as P
    base = os.path.join(P.LIB_DIR, "textures")

    def img(rel):
        im = bpy.data.images.load(os.path.join(base, rel), check_existing=True)
        im.colorspace_settings.name = "Non-Color"
        return im

    scr = img("ambientcg_Scratches005/Scratches005_alpha_2k.jpg")
    smu = img("ambientcg_SurfaceImperfections013/SurfaceImperfections013_alpha_2k.jpg")
    done = []
    for m in bpy.data.materials:
        dark = m.name.startswith("CFCL_PBR_ObsidianOnyx")
        if not (m.node_tree and (dark or m.name.startswith("CFCL_PBR_IvoryMarble"))):
            continue
        nt = m.node_tree
        b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None:
            continue
        tc = nt.nodes.new("ShaderNodeTexCoord")
        oi = nt.nodes.new("ShaderNodeObjectInfo")
        sc_ = nt.nodes.new("ShaderNodeVectorMath"); sc_.operation = "SCALE"
        sc_.inputs["Scale"].default_value = 1.0 / cfg.get("tile_m", 2.3)
        nt.links.new(tc.outputs["Object"], sc_.inputs[0])
        off = nt.nodes.new("ShaderNodeVectorMath"); off.operation = "MULTIPLY_ADD"
        nt.links.new(oi.outputs["Random"], off.inputs[0]); off.inputs[1].default_value = (17.3, 5.1, 0.0)
        nt.links.new(sc_.outputs[0], off.inputs[2])
        layers = []
        for im in (scr, smu):
            t = nt.nodes.new("ShaderNodeTexImage"); t.image = im; t.projection = "FLAT"
            nt.links.new(off.outputs[0], t.inputs["Vector"])
            layers.append(t.outputs["Color"])
        k_scr, k_smu = (0.26, 0.18) if dark else (0.16, 0.10)
        r_sock = b.inputs["Roughness"]
        acc = r_sock.links[0].from_socket if r_sock.is_linked else None
        cur = acc
        for sock, k in zip(layers, (k_scr, k_smu)):
            mm = nt.nodes.new("ShaderNodeMath"); mm.operation = "MULTIPLY_ADD"; mm.use_clamp = True
            nt.links.new(sock, mm.inputs[0]); mm.inputs[1].default_value = k
            if cur is not None:
                nt.links.new(cur, mm.inputs[2])
            else:
                mm.inputs[2].default_value = r_sock.default_value
            cur = mm.outputs[0]
        nt.links.new(cur, r_sock)
        # colour: scratches catch light on the onyx, smudges dull the ivory a touch
        c_sock = b.inputs["Base Color"]
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MIX"
        fac = nt.nodes.new("ShaderNodeMath"); fac.operation = "MULTIPLY"
        nt.links.new(layers[0] if dark else layers[1], fac.inputs[0]); fac.inputs[1].default_value = 0.14 if dark else 0.06
        nt.links.new(fac.outputs[0], mx.inputs[0])
        if c_sock.is_linked:
            nt.links.new(c_sock.links[0].from_socket, mx.inputs[6])
        else:
            mx.inputs[6].default_value = c_sock.default_value
        mx.inputs[7].default_value = (0.32, 0.31, 0.30, 1.0) if dark else (0.55, 0.50, 0.44, 1.0)
        nt.links.new(mx.outputs[2], c_sock)
        done.append(m.name)
    log["board_overlays"] = done
    return done


def apply(sc, cfg, col, log):
    if cfg.get("lava"):
        lava_pools(sc, cfg["lava"], col, log)
    if cfg.get("sky"):
        sky_grade(sc, cfg["sky"], log)
    if cfg.get("board_overlays"):
        board_overlays(cfg["board_overlays"], log)
    return log
