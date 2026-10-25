"""CFCL_PBR material sheet + large-scale tiling test.

Usage: python lib/run_blender.py scripts/pbr_matsheet.py --timeout 1500 -- iter01 [sheet,large]
Writes renders/pbr/<iter>_sheet.png (+ _sheet_labels.json) and renders/pbr/<iter>_large.png.
Objects are built at 1/4.6 size with object scale 4.6 (like the main scene) to prove world-metre scaling."""
import sys, os, json, math, random
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy, bmesh
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view
import cf_render as R
import cf_pbr as P

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
IT = argv[0] if argv else "iter01"
WHAT = argv[1].split(",") if len(argv) > 1 else ["sheet", "large"]
OUT = os.path.join(CL, "renders", "pbr"); os.makedirs(OUT, exist_ok=True)
K = 4.6


def mesh_obj(name, bm, scale=K, loc=(0, 0, 0), rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.scale = (scale,) * 3; o.location = loc; o.rotation_euler = rot
    for p in me.polygons:
        p.use_smooth = True
    return o


def sphere(r):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r / K); return bm


def broken_block(size, seed):
    rnd = random.Random(seed)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=size / K)
    for _ in range(3):
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 1))).normalized()
        co = n * (size / K) * rnd.uniform(0.18, 0.32)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=n, clear_outer=True)
        edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgeloop_fill(bm, edges=edges)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for f in bm.faces:
        f.smooth = False
    return bm


def slab(w, d, h):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w / K, d / K, h / K), verts=bm.verts)
    return bm


R.reset_scene()
sc = bpy.context.scene
R.setup_render(sc, "EEVEE", (1280, 720), 48)
sc.view_settings.view_transform = "AgX"
try:
    sc.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass
R.setup_world(sc, top=(0.30, 0.33, 0.36), horizon=(0.55, 0.50, 0.42), strength=1.0)
sun = bpy.data.lights.new("Sun", "SUN"); sun.energy = 3.2; sun.color = (1.0, 0.86, 0.68); sun.angle = math.radians(3)
so = bpy.data.objects.new("Sun", sun); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(-35))

names = [n for n in P.PRESETS]
labels = {}

if "sheet" in WHAT:
    cols = 6
    sp = 13.0
    objs = []
    for i, n in enumerate(names):
        cx, cy = (i % cols) * sp, -(i // cols) * sp
        base = mesh_obj(f"slab_{n}", slab(11.5, 11.5, 0.6), loc=(cx, cy, -0.3))
        sph = mesh_obj(f"sph_{n}", sphere(2.4), loc=(cx - 2.6, cy + 1.8, 2.4))
        blk = mesh_obj(f"blk_{n}", broken_block(4.2, i), loc=(cx + 2.4, cy - 1.0, 1.6),
                       rot=(0.2, 0.15, 0.6 + i))
        for o in (base, sph, blk):
            P.apply_pbr(o, n)
        objs.append((n, Vector((cx, cy - 5.2, 0.4))))
    cam = R.camera("CamSheet", ((cols - 1) * sp / 2, -2.2 * sp - 46, 78), ((cols - 1) * sp / 2, -1.7 * sp, 0), 30)
    sc.camera = cam
    p = os.path.join(OUT, f"{IT}_sheet.png")
    R.render_to(p, cam)
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    for n, w in objs:
        v = world_to_camera_view(sc, cam, w)
        labels[n] = [round(v.x * rx), round((1 - v.y) * ry)]
    json.dump(labels, open(os.path.join(OUT, f"{IT}_sheet_labels.json"), "w"), indent=1)
    for o in list(sc.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o)

if "large" in WHAT:
    # 80 x 80 m ground (forest floor with rock), 40 m cliff wall, 30 m basalt rib, 12 m ruin wall, paving disc
    g = mesh_obj("ground", slab(90, 90, 1.0), loc=(0, 20, -0.5))
    P.apply_pbr(g, "ForestFloor")
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=60, y_segments=40, size=0.5)
    me_w = mesh_obj("cliffwall", bm, scale=1.0, loc=(0, 52, 18), rot=(math.radians(90), 0, 0))
    me_w.scale = (46.0, 24.0, 1.0)
    # bumpy relief: displace via vertex noise
    import mathutils.noise as MN
    for v in me_w.data.vertices:
        co = v.co
        v.co.z += 0.12 * MN.noise(Vector((co.x * 3, co.y * 3, 0.5))) + 0.05 * MN.noise(Vector((co.x * 9, co.y * 9, 2)))
    P.apply_pbr(me_w, "CliffLayered")
    rib = mesh_obj("rib", slab(7, 7, 34), loc=(-24, 30, 17), rot=(0.12, -0.18, 0.4))
    P.apply_pbr(rib, "BasaltRib")
    rib2 = mesh_obj("rib2", slab(8, 6, 26), loc=(26, 36, 13), rot=(-0.1, 0.2, -0.3))
    P.apply_pbr(rib2, "CliffBlocky")
    wall = mesh_obj("ruinwall", slab(16, 3, 11), loc=(14, 16, 5.5), rot=(0, 0.06, 0.3))
    P.apply_pbr(wall, "MasonryBlocks")
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=12 / K, radius2=12 / K, depth=0.8 / K)
    disc = mesh_obj("paving", bm, loc=(-6, 8, 0.2))
    P.apply_pbr(disc, "Flagstone")
    blk = mesh_obj("lava", slab(30, 14, 0.4), loc=(-14, -2, 0.05))
    P.apply_pbr(blk, "CooledLava")
    cam = R.camera("CamLarge", (0, -30, 9), (0, 30, 8), 24)
    sc.camera = cam
    R.render_to(os.path.join(OUT, f"{IT}_large.png"), cam)

print("PBR_SHEET_DONE", IT, WHAT, len(bpy.data.images), "images",
      sum(im.size[0] * im.size[1] * 4 for im in bpy.data.images) / 1e6, "MB (RGBA8 estimate)")
