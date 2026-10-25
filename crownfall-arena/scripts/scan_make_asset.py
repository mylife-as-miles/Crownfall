"""Crownfall (Claude track) - hero assets from the downloaded photogrammetry scans (vendor/scans/*/prep.blend).

  skull : CC0 treponemal skull -> CFCL_Scan_Skull (object CFCL_Hero_Skull), face along local -Y, petrified-bone material
          that keeps the scan's own albedo detail (desaturated, stone grain overlaid).
  hand  : Hand Nadia (CC BY 4.0, 3dscanservice) -> CFCL_Scan_Hand. Mirrored to a LEFT hand, wrist cap cut off, a
          stone forearm extruded from the cut into the old basalt mound, a rusted cuff over the seam and a chain
          running down into the mound. Objects keep the old names (CFCL_Hero_Hand, _Manacle, _Mound), so every
          main-scene override (dress, group_scale, rim, wear rules) still applies.
Usage: python lib/run_blender.py scripts/scan_make_asset.py -- <skull|hand> <ver> [flip_palm=0|1]"""
import json
import math
import os
import sys

CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector, noise  # noqa: E402
import cf_pbr as P  # noqa: E402
import cf_render as R  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
KIND, VER = argv[0], int(argv[1])
FLIP_PALM = len(argv) > 2 and argv[2] == "1"
SCAN = {"skull": "skull_treponemal", "hand": "hand_nadia"}[KIND]
ASSET = {"skull": "CFCL_Scan_Skull", "hand": "CFCL_Scan_Hand"}[KIND]
OUT = os.path.join(CL, "assets", ASSET)
SKULL_LEN, SKULL_YAW = 3.2, -62.0          # m front-to-back; prep-space face direction is ~-28 deg from +X
HAND_L, WRIST_Z, TILT = 2.75, 2.25, 8.0    # cut->middle tip, cut height, backward lean (deg)
ARM_BOTTOM = -0.2


def load_prep():
    R.reset_scene()
    with bpy.data.libraries.load(os.path.join(CL, "vendor", "scans", SCAN, "prep.blend"), link=False) as (s, d):
        d.objects = list(s.objects)
    obs = [o for o in d.objects if o and o.type == "MESH"]
    for o in obs:
        bpy.context.scene.collection.objects.link(o)
        # the OBJ importer keeps its Y-up -> Z-up conversion as an object rotation: bake it so data == world
        # (matrix_world is stale on freshly appended objects; matrix_basis comes from the stored loc/rot/scale)
        o.data.transform(o.matrix_basis.copy())
        o.matrix_basis = Matrix.Identity(4)
    return obs


def bounds_v(vs):
    return (Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)]))


def tex(nt, img, x, y):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    n.location = (x, y)
    return n


# ------------------------------------------------------------------ skull
def make_skull():
    ob = load_prep()[0]
    me = ob.data
    me.transform(Matrix.Rotation(math.radians(SKULL_YAW), 4, "Z"))
    mn, mx = bounds_v([v.co for v in me.vertices])
    s = SKULL_LEN / (mx.y - mn.y)
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))))
    me.transform(Matrix.Translation((0, 0, -0.08)))          # teeth just into the rubble, like the old sculpt
    me.update()
    ob.name = me.name = "CFCL_Hero_Skull"
    stone = P.resolve_set("polyhaven_rock_face_03")
    for i, slot in enumerate(ob.material_slots):
        src = slot.material
        img = next((n.image for n in src.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None) if src else None
        m = bpy.data.materials.new(f"CFCL_BoneStone_Scan_{i}")
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        alb = tex(nt, img, -900, 300)
        hsv = nt.nodes.new("ShaderNodeHueSaturation")      # petrified bone: keep the stains, lose the orange
        hsv.inputs["Saturation"].default_value = 0.42
        hsv.inputs["Value"].default_value = 0.62
        nt.links.new(alb.outputs["Color"], hsv.inputs["Color"])
        # stone grain at colossal scale (box-projected, object space, 1.4 m repeat)
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / 1.4, 1 / 1.4, 1 / 1.4)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        gc = tex(nt, P._img(stone, "color", False), -900, -100)
        gr = tex(nt, P._img(stone, "rough", True), -900, -400)
        gh = tex(nt, P._img(stone, "disp", True), -900, -700)
        for t in (gc, gr, gh):
            t.projection = "BOX"
            t.projection_blend = 0.3
            nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        ov = nt.nodes.new("ShaderNodeMix")
        ov.data_type, ov.blend_type = "RGBA", "OVERLAY"
        ov.inputs["Factor"].default_value = 0.45
        nt.links.new(hsv.outputs["Color"], ov.inputs["A"])
        nt.links.new(gc.outputs["Color"], ov.inputs["B"])
        nt.links.new(ov.outputs["Result"], b.inputs["Base Color"])
        rr = nt.nodes.new("ShaderNodeMapRange")
        rr.inputs["To Min"].default_value, rr.inputs["To Max"].default_value = 0.62, 0.97
        nt.links.new(gr.outputs["Color"], rr.inputs["Value"])
        nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35
        bump.inputs["Distance"].default_value = 0.02
        nt.links.new(gh.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
        slot.material = m
        if src:
            bpy.data.materials.remove(src)
    ob["cfcl_pbr_k"] = 1.0
    return [ob], {"tris": R.tri_count([ob]), "bbox": [list(v) for v in bounds_v([v.co for v in me.vertices])]}


# ------------------------------------------------------------------ hand
def _cap(bm):
    """largest planar face cluster = the scan's flat wrist cap: returns (outward normal, centroid)."""
    bins = {}
    for f in bm.faces:
        k = tuple(round(c * 40) for c in f.normal)
        a = f.calc_area()
        acc = bins.setdefault(k, [0.0, Vector(), Vector()])
        acc[0] += a
        acc[1] += f.normal * a
        acc[2] += f.calc_center_median() * a
    a, n, c = max(bins.values(), key=lambda v: v[0])
    return n.normalized(), c / a, a


def _ellipse(pts):
    c = sum(pts, Vector()) / len(pts)
    sxx = sum((p.x - c.x) ** 2 for p in pts)
    syy = sum((p.y - c.y) ** 2 for p in pts)
    sxy = sum((p.x - c.x) * (p.y - c.y) for p in pts)
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    u, v = Vector((math.cos(th), math.sin(th), 0)), Vector((-math.sin(th), math.cos(th), 0))
    a = max(abs((p - c).dot(u)) for p in pts)
    b = max(abs((p - c).dot(v)) for p in pts)
    return c, u, v, a, b


def _link(bm, M, half=0.1, r=0.1, tube=0.055, seg=20, ts=8):
    """stadium-shaped chain link in its local XZ plane (long axis Z), transformed by M."""
    path = []
    for i in range(seg):
        t = i / seg * 2 * math.pi
        x, z = r * math.cos(t), r * math.sin(t)
        z += half if z >= 0 else -half
        path.append(Vector((x, 0, z)))
    rings = []
    for i, p in enumerate(path):
        tg = (path[(i + 1) % seg] - path[i - 1]).normalized()
        nrm = Vector((0, 1, 0)).cross(tg).normalized()
        rings.append([bm.verts.new(M @ (p + (nrm * math.cos(2 * math.pi * j / ts) + Vector((0, 1, 0)) * math.sin(2 * math.pi * j / ts)) * tube))
                      for j in range(ts)])
    for i in range(seg):
        a, b = rings[i], rings[(i + 1) % seg]
        for j in range(ts):
            bm.faces.new((a[j], a[(j + 1) % ts], b[(j + 1) % ts], b[j]))


def make_hand():
    ob = load_prep()[0]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n_cap, c_cap, a_cap = _cap(bm)
    # 1) cap normal -> -Z (fingers up), cap centre to the origin
    bmesh.ops.transform(bm, matrix=n_cap.rotation_difference(Vector((0, 0, -1))).to_matrix().to_4x4() @ Matrix.Translation(-c_cap),
                        verts=bm.verts)
    # 2) thinnest horizontal direction (palm normal) -> Y; palm toward -Y (FLIP_PALM if the heuristic picks the back)
    pts = [v.co for v in bm.verts if v.co.z > 0.05]
    _, u, v, a, b = _ellipse(pts)
    t = v if a >= b else u
    ang = math.atan2(t.x, t.y)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(ang + (math.pi if FLIP_PALM else 0), 3, "Z"))
    # 3) right hand -> LEFT hand (mirror X, fix winding)
    bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=bm.verts)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    # 4) cut the flat cap off just above it, scale cut->tip to HAND_L, cut at WRIST_Z
    zmax = max(v.co.z for v in bm.verts)
    zc = 0.015 * zmax
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zc), plane_no=(0, 0, 1),
                           clear_inner=True)
    s = HAND_L / (zmax - zc)
    loop = [e for e in bm.edges if e.is_boundary and all(abs(x.co.z - zc) < 1e-4 for x in e.verts)]
    lv = list({x for e in loop for x in e.verts})
    c0 = sum((x.co for x in lv), Vector()) / len(lv)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, WRIST_Z)) @ Matrix.Scale(s, 4) @ Matrix.Translation(-Vector((c0.x, c0.y, zc))),
                        verts=bm.verts)
    hand_verts = set(bm.verts)
    c, eu, ev, ea, eb = _ellipse([x.co for x in lv])
    # 5) forearm: extrude the cut loop down into the mound, straight for 0.6 m (under the cuff), then flaring
    rings, edges = 40, loop
    base = {x: x.co.copy() for x in lv}
    prev = {x: x for x in lv}
    for k in range(1, rings + 1):
        res = bmesh.ops.extrude_edge_only(bm, edges=edges)
        nv = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        edges = [g for g in res["geom"] if isinstance(g, bmesh.types.BMEdge) and g.is_boundary]
        f = k / rings
        z = WRIST_Z + (ARM_BOTTOM - WRIST_Z) * f
        drop = WRIST_Z - z
        flare = 1.0 + 0.55 * max(0.0, min(1.0, (drop - 0.5) / 1.4)) ** 1.2   # forearm swells toward the elbow
        nxt = {}
        for v_ in nv:
            src = next(e.other_vert(v_) for e in v_.link_edges if e.other_vert(v_) in prev.values())
            o = next(k_ for k_, val in prev.items() if val is src)
            p0 = base[o]
            d = Vector((p0.x, p0.y, 0))
            w = max(0.0, min(1.0, (drop - 0.08) / 0.5))
            q = Vector((p0.x * 0.6, p0.y * 0.6, z * 0.6))
            bumpy = 0.07 * noise.noise(q * 1.1) + 0.035 * noise.noise(q * 3.3) + 0.012 * noise.noise(q * 9.0)
            v_.co = Vector((0, 0, z)) + d * flare + d.normalized() * bumpy * w
            nxt[o] = v_
        prev = nxt
    bmesh.ops.recalc_face_normals(bm, faces=[f_ for f_ in bm.faces if not set(f_.verts) <= hand_verts])
    # 6) backward lean about the base
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(TILT), 3, "X"))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    ob.name = ob.data.name = "CFCL_Hero_Hand"
    stone = P.get_pbr("AncientStone", scale_m=2.2).copy()
    stone.name = "CFCL_HandStone_Scan"
    ob.data.materials.clear()
    ob.data.materials.append(stone)
    ob["cfcl_pbr_k"] = 1.0
    for p in ob.data.polygons:
        p.use_smooth = True
    # 7) cuff over the seam + chain into the mound (one object: CFCL_Hero_Hand_Manacle)
    mb = bmesh.new()
    T, z0, z1, gap = 0.075, WRIST_Z - 0.55, WRIST_Z - 0.02, 0.012
    prof = [(0, z0), (T, z0), (T + 0.022, z0 + 0.025), (T + 0.022, z0 + 0.09), (T, z0 + 0.115), (T, z1 - 0.115),
            (T + 0.022, z1 - 0.09), (T + 0.022, z1 - 0.025), (T, z1), (0, z1)]
    N = 112
    grid = []
    for i in range(N):
        th = 2 * math.pi * i / N
        pe = c + eu * ((ea * 1.03 + gap) * math.cos(th)) + ev * ((eb * 1.03 + gap) * math.sin(th))
        nr = (eu * ((eb) * math.cos(th)) + ev * ((ea) * math.sin(th))).normalized()
        dent = 0.012 * noise.noise(Vector((math.cos(th) * 3, math.sin(th) * 3, 0.5)))
        grid.append([mb.verts.new(Vector((pe.x, pe.y, 0)) + nr * (o + (dent if o > 0 else 0)) + Vector((0, 0, zz))) for o, zz in prof])
    for i in range(N):
        a_, b_ = grid[i], grid[(i + 1) % N]
        for j in range(len(prof)):
            mb.faces.new((a_[j], b_[j], b_[(j + 1) % len(prof)], a_[(j + 1) % len(prof)]))
    zm = (z0 + z1) / 2
    for i in range(12):                                     # rivets on the outer face
        th = 2 * math.pi * (i + 0.5) / 12
        for zz in (zm - 0.11, zm + 0.11):
            pe = c + eu * ((ea * 1.03 + gap) * math.cos(th)) + ev * ((eb * 1.03 + gap) * math.sin(th))
            nr = (eu * (eb * math.cos(th)) + ev * (ea * math.sin(th))).normalized()
            bmesh.ops.create_uvsphere(mb, u_segments=8, v_segments=5, radius=0.032,
                                      matrix=Matrix.Translation(Vector((pe.x, pe.y, zz)) + nr * T))
    # chain: from a lug on the cuff's +X side, sagging down to the mound ~1.5 m away
    th = 0.0
    lug = c + eu * ((ea * 1.03 + gap + T + 0.02)) + Vector((0, 0, zm))
    lug = Vector((lug.x, lug.y, zm))
    end = Vector((lug.x + 1.45, lug.y - 0.35, 0.45))
    ctrl = (lug + end) / 2 + Vector((0.25, 0, -0.9))
    curve = [(1 - t) ** 2 * lug + 2 * (1 - t) * t * ctrl + t * t * end for t in [i / 400 for i in range(401)]]
    pitch, acc, marks = 0.30, 0.0, [0]
    for i in range(1, len(curve)):
        acc += (curve[i] - curve[i - 1]).length
        if acc >= pitch:
            marks.append(i)
            acc = 0.0
    for n_, (i0, i1) in enumerate(zip(marks, marks[1:])):
        p0, p1 = curve[i0], curve[i1]
        zax = (p1 - p0).normalized()
        xax = zax.cross(Vector((0, 0, 1)) if abs(zax.z) < 0.95 else Vector((1, 0, 0))).normalized()
        if n_ % 2:
            xax = zax.cross(xax).normalized()
        yax = zax.cross(xax)
        M = Matrix((xax, yax, zax)).transposed().to_4x4()
        M.translation = (p0 + p1) / 2
        _link(mb, M, half=0.10, r=0.085, tube=0.042)
    bmesh.ops.rotate(mb, verts=mb.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(TILT), 3, "X"))
    mme = bpy.data.meshes.new("CFCL_Hero_Hand_Manacle")
    mb.to_mesh(mme)
    mb.free()
    for p in mme.polygons:
        p.use_smooth = True
    man = bpy.data.objects.new("CFCL_Hero_Hand_Manacle", mme)
    bpy.context.scene.collection.objects.link(man)
    mm = bpy.data.materials.new("CFCL_Bronze_ScanManacle")
    mm.use_nodes = True
    bb = mm.node_tree.nodes["Principled BSDF"]
    bb.inputs["Base Color"].default_value = (0.085, 0.07, 0.055, 1)      # dark iron-bronze; cf_wear 'metal' rusts it
    bb.inputs["Metallic"].default_value = 0.75
    bb.inputs["Roughness"].default_value = 0.62
    mme.materials.append(mm)
    # 8) the old basalt mound, unchanged
    with bpy.data.libraries.load(os.path.join(CL, "assets", "CFCL_Ucupaint_Hand", "CFCL_Ucupaint_Hand_v004.blend"), link=False) as (s_, d_):
        d_.objects = ["CFCL_Hero_Hand_Mound"]
    mound = d_.objects[0]
    bpy.context.scene.collection.objects.link(mound)
    objs = [ob, man, mound]
    return objs, {"tris": {o.name: R.tri_count([o]) for o in objs}, "cap_area": a_cap, "flip_palm": FLIP_PALM,
                  "bbox_hand": [list(x) for x in bounds_v([v.co for v in ob.data.vertices])]}


objs, info = make_skull() if KIND == "skull" else make_hand()
col = bpy.data.collections.new(ASSET)
bpy.context.scene.collection.children.link(col)
for o in objs:
    for c_ in list(o.users_collection):
        c_.objects.unlink(o)
    col.objects.link(o)
os.makedirs(OUT, exist_ok=True)
blend = os.path.join(OUT, f"{ASSET}_v{VER:03d}.blend")
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=blend)
old = {"skull": ("CFCL_Ucupaint_Skull", [("CFCL_Hero_Skull", [-2.8589, 9.4778, -0.4185], 33.0)]),
       "hand": ("CFCL_Ucupaint_Hand", [("CFCL_Hero_Hand", [4.5, 10.0, -0.35], -22.0),
                                       ("CFCL_Hero_Hand_Manacle", [4.5, 10.0, -0.35], -22.0),
                                       ("CFCL_Hero_Hand_Mound", [4.5, 10.0, -0.35], -22.0)])}[KIND]
arr = {"asset": ASSET, "blend": os.path.basename(blend), "_note": f"same placements as {old[0]} (research layout)",
       "placements": [{"source": n, "name": n, "location": loc, "rotation_deg": [0.0, 0.0, yaw], "scale": [1, 1, 1]}
                      for n, loc, yaw in old[1]]}
json.dump(arr, open(os.path.join(OUT, "arrangement.json"), "w"), indent=1)
info.update(asset=ASSET, blend=os.path.basename(blend))
R.write_json(os.path.join(OUT, f"build_report_v{VER:03d}.json"), info)
print("SCANASSET", json.dumps(info)[:800])
# check renders: palm/face toward -Y is the 'front' view
sc = bpy.context.scene
R.setup_world(sc, top=(0.30, 0.31, 0.33), horizon=(0.42, 0.40, 0.37), strength=1.0)
out = os.path.join(CL, "renders", "scans", f"{ASSET}_v{VER:03d}")
os.makedirs(out, exist_ok=True)
R.turntable(objs if KIND == "skull" else objs[:2], os.path.join(out, ASSET),
            views=(("front", 0, 12), ("q_left", -40, 15), ("side", 90, 8), ("q_right", 35, 20)),
            lens=50.0, dist_mult=1.25, res=(800, 800), samples=32, ground=False)
