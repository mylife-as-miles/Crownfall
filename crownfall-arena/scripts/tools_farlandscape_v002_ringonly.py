"""CFCL_Tools_FarLandscape - eroded distant mountain/cliff ring (env units, 36-96 env from the scene).

Pipeline (TERRAIN MIXER is the primary generator):
  1. scripts/tools_tm_bake.py baked Terrain Mixer's shader terrain from its own ortho baking camera to a float
     heightmap (tm_bake/final_<var>_height.exr) and a Cycles DIFFUSE-COLOR bake (tm_bake/final_<var>_color.png).
  2. here: a polar grid (annulus) gets UVs that map env XY onto the TM square (2000 TM units = 200 env), a
     Displace modifier (image texture = normalised TM heightmap, UV coords, vertex-group weighted amplitude:
     low behind the eclipse, tall on the flanks) is APPLIED,
  3. erosion_terrain_extension's droplet erosion (its own erosion_simulation on its own generate_grid bmesh)
     is run over the displaced heights to cut extra gullies (blend: TM primary, erosion secondary),
  4. Decimate (collapse) to budget, split into 6 sectors, material = cf_materials Basalt tinted by the TM
     colour bake (image texture, packed).
Usage: python lib/run_blender.py scripts/tools_farlandscape.py --timeout 2400 -- [variant] [droplets]
"""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector
import tools_common as T
import cf_render as R
import cf_materials as M
import cf_atmos as A

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VAR = argv[0] if argv else "abyss"
DROPS = int(argv[1]) if len(argv) > 1 else 24000
ASSET = "CFCL_Tools_FarLandscape"
VER = T.next_version(ASSET)
BAKE = os.path.join(T.asset_dir(ASSET), "tm_bake")
RDIR = os.path.join(T.CL, "renders", "tools", "farlandscape")
os.makedirs(RDIR, exist_ok=True)
LOG = {"asset": ASSET, "version": VER, "variant": VAR, "droplets": DROPS, "warnings": []}
t0 = time.time()

# ---------------------------------------------------------------- params (env units)
CX, CY = 0.0, 4.0           # ring centre (board side of the skull/hand line)
R0, R1 = 36.0, 80.0          # inner edge 36 env out; outer edge kept inside the main build's fog box on the flanks
NT, NR = 900, 96            # angular x radial grid
TM_SPAN = 210.0             # TM 2000 units -> 210 env
AMP_SIDE, AMP_FRONT, AMP_BACK = 30.0, 10.0, 18.0
NOTCH_DEG = 104.0            # canyon gap in the front wall (behind/right of the eclipse) for depth
Z_FLOOR = -10.0
TRI_BUDGET = 56000
SECTORS = 6

R.reset_scene()
T.enable("erosion_terrain_extension", "antlandscape")
sc = bpy.context.scene
col = bpy.data.collections.new(ASSET)
sc.collection.children.link(col)

# ---------------------------------------------------------------- TM height + colour images
def load_float(path):
    img = bpy.data.images.load(path, check_existing=False)
    a = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a

H = load_float(os.path.join(BAKE, f"final_{VAR}_height.exr"))[..., 0]
lo, hi = np.percentile(H, 0.5), np.percentile(H, 99.7)
Hn = np.clip((H - lo) / (hi - lo), 0.0, 1.0)
LOG["tm_height"] = {"file": f"tm_bake/final_{VAR}_height.exr", "raw_min": float(H.min()), "raw_max": float(H.max()),
                    "norm_lo": float(lo), "norm_hi": float(hi), "res": list(H.shape)}
# --- mask layer on TM's bake (image space): radial threshold so only TM's high features rise near the inner
#     edge (irregular escarpment following TM's own contours instead of a circular wall) + per-direction height.
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

NPX = H.shape[0]
pu = (np.arange(NPX) + 0.5) / NPX
PX, PY = np.meshgrid((pu - 0.5) * TM_SPAN + CX, (pu - 0.5) * TM_SPAN + CY)    # row 0 = v 0 (bottom)
PR = np.hypot(PX - CX, PY - CY)
PT = np.arctan2(PY - CY, PX - CX)
f = np.sin(PT)
amp = AMP_SIDE - (AMP_SIDE - AMP_FRONT) * np.clip(f, 0, 1) ** 1.2 - (AMP_SIDE - AMP_BACK) * np.clip(-f, 0, 1) ** 1.5
amp *= 1.0 + 0.16 * np.sin(3 * PT + 0.7) + 0.09 * np.sin(7 * PT + 2.1)
dnotch = np.degrees(np.abs((PT - np.radians(NOTCH_DEG) + np.pi) % (2 * np.pi) - np.pi))
amp *= 1.0 - 0.80 * smooth(14.0, 4.0, dnotch)                                   # canyon gap
thr = 0.93 - 0.68 * smooth(R0, R0 + 18.0, PR)                                   # high features first
shaped = np.clip((Hn - thr) / np.maximum(1.0 - thr, 1e-3), 0, 1) ** 0.85
shaped *= (1.0 - 0.25 * smooth(R1 - 8.0, R1, PR)) * smooth(R0 - 2.0, R0 + 2.0, PR)
shaped = shaped * amp / (AMP_SIDE * 1.25)
LOG["mask"] = {"threshold": "0.93 -> 0.25 over r 36-54", "amp_side_front_back": [AMP_SIDE, AMP_FRONT, AMP_BACK],
               "notch_deg": NOTCH_DEG, "shaped_max": float(shaped.max())}
Hn = shaped
himg = bpy.data.images.new(f"CFCL_TM_Height_{VAR}_ringmask", H.shape[1], H.shape[0], alpha=False, float_buffer=True)
himg.colorspace_settings.name = "Non-Color"
rgba = np.ones(H.shape + (4,), np.float32)
rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = Hn
himg.pixels.foreach_set(rgba.ravel())
himg.update()
htex = bpy.data.textures.new("CFCL_TM_HeightTex", "IMAGE")
htex.image = himg
htex.extension = "EXTEND"
htex.use_interpolation = True

cimg = bpy.data.images.load(os.path.join(BAKE, f"final_{VAR}_color.png"), check_existing=False)
cimg.name = f"CFCL_TM_Color_{VAR}"
cimg.pack()

# ---------------------------------------------------------------- polar grid (base at the abyss floor)
th = np.linspace(0, 2 * np.pi, NT, endpoint=False)
rr = np.linspace(R0, R1, NR)
TT, RRg = np.meshgrid(th, rr)                        # (NR, NT) row-major: index = j*NT + i
X = CX + RRg * np.cos(TT)
Y = CY + RRg * np.sin(TT)
Z0 = Z_FLOOR + 5.0 * smooth(R0 + 6.0, R1, RRg)       # hidden floor (fog/abyss), rising slightly outward
U = ((X - CX) / TM_SPAN) + 0.5
V = ((Y - CY) / TM_SPAN) + 0.5

me = bpy.data.meshes.new("CFCL_FarLand_Ring")
verts = np.stack([X, Y, Z0], -1).reshape(-1, 3)
faces = []
for j in range(NR - 1):
    for i in range(NT):
        i2 = (i + 1) % NT
        faces.append((j * NT + i, j * NT + i2, (j + 1) * NT + i2, (j + 1) * NT + i))
me.from_pydata(verts.tolist(), [], faces)
uvl = me.uv_layers.new(name="TMUV")
loop_v = np.empty(len(me.loops), np.int32)
me.loops.foreach_get("vertex_index", loop_v)
uv = np.stack([U.ravel(), V.ravel()], 1)[loop_v]
uvl.data.foreach_set("uv", uv.ravel().astype(np.float32))
ob = bpy.data.objects.new("CFCL_FarLand_Ring", me)
col.objects.link(ob)

dm = ob.modifiers.new("TM_Displace", "DISPLACE")
dm.texture = htex
dm.texture_coords = "UV"
dm.uv_layer = "TMUV"
dm.direction = "Z"
dm.mid_level = 0.0
dm.strength = AMP_SIDE * 1.25
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.modifier_apply(modifier=dm.name)
co = np.empty(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
LOG["after_tm_displace"] = {"z_min": float(co[:, 2].min()), "z_max": float(co[:, 2].max())}

# ---------------------------------------------------------------- erosion_terrain_extension droplet erosion
ero = sys.modules["bl_ext.blender_org.erosion_terrain_extension.terrain.terrain"]
SP = 0.7                                            # env per grid step (mean of angular/radial spacing)
bm = bmesh.new()
ero.generate_grid(bm, NT, NR)                       # the extension's own grid: vert index = y*NT + x
bm.verts.ensure_lookup_table()
zs = co[:, 2] / SP
for v, z in zip(bm.verts, zs):
    v.co.z = float(z)
import random
random.seed(7)
t1 = time.time()
ero.erosion_simulation(bm, NT, NR, [], DROPS, 36, 0.3, 4.0, 0.01, 10.0, 0.03, 2.5, 0.05, 0.12)
z_new = np.array([v.co.z for v in bm.verts], np.float32) * SP
bm.free()
dz = z_new - co[:, 2]
LOG["erosion"] = {"droplets": DROPS, "s": round(time.time() - t1, 1), "mean_abs_dz_env": float(np.abs(dz).mean()),
                  "max_cut_env": float(-dz.min()), "max_fill_env": float(dz.max()),
                  "params": "maxpath 36, inertia .3, capacity 4, minslope .01, gravity 10, evap .03, radius 2.5, erosion .05, deposition .12"}
co[:, 2] = z_new
me.vertices.foreach_set("co", co.ravel())
me.update()
print("[far] erosion", LOG["erosion"], flush=True)

# ---------------------------------------------------------------- decimate + sectors
tris0 = 2 * NT * (NR - 1)
dec = ob.modifiers.new("Decimate", "DECIMATE")
dec.decimate_type = "COLLAPSE"
dec.ratio = TRI_BUDGET / tris0
bpy.ops.object.modifier_apply(modifier=dec.name)
for p in me.polygons:
    p.use_smooth = True
LOG["tris_before_decimate"] = tris0

sector_objs = []
bm = bmesh.new()
bm.from_mesh(me)
names = ["Front", "FrontRight", "BackRight", "Back", "BackLeft", "FrontLeft"]
for s in range(SECTORS):
    a0 = math.radians(90 - 30) + s * 2 * math.pi / SECTORS    # sector 0 centred on +Y (behind the eclipse)
    b2 = bm.copy()
    kill = []
    for fc in b2.faces:
        c = fc.calc_center_median()
        ang = (math.atan2(c.y - CY, c.x - CX) - a0) % (2 * math.pi)
        if ang >= 2 * math.pi / SECTORS:
            kill.append(fc)
    bmesh.ops.delete(b2, geom=kill, context="FACES")
    m2 = bpy.data.meshes.new(f"CFCL_FarLand_{names[s]}")
    b2.to_mesh(m2)
    b2.free()
    o2 = bpy.data.objects.new(f"CFCL_FarLand_{names[s]}", m2)
    col.objects.link(o2)
    sector_objs.append(o2)
bm.free()
bpy.data.objects.remove(ob)

# ---------------------------------------------------------------- material: Basalt tinted by the TM colour bake
base = M.get("Basalt", moss=0.08, scale=6.0)
mat = base.copy()
mat.name = "CFCL_Tools_FarLand_TMBasalt"
nt = mat.node_tree
pr = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
bc = pr.inputs["Base Color"]
src = bc.links[0].from_socket if bc.links else None
uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "TMUV"
tx = nt.nodes.new("ShaderNodeTexImage"); tx.image = cimg; tx.extension = "EXTEND"
nt.links.new(uvn.outputs["UV"], tx.inputs["Vector"])
bw = nt.nodes.new("ShaderNodeRGBToBW"); nt.links.new(tx.outputs["Color"], bw.inputs["Color"])
mr = nt.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value = 0.10; mr.inputs["From Max"].default_value = 0.75
mr.inputs["To Min"].default_value = 0.70; mr.inputs["To Max"].default_value = 1.65
nt.links.new(bw.outputs["Val"], mr.inputs["Value"])
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
mix.inputs["Factor"].default_value = 1.0
if src is not None:
    nt.links.new(src, mix.inputs["A"])
else:
    mix.inputs["A"].default_value = tuple(bc.default_value)
cv = nt.nodes.new("ShaderNodeCombineColor")
for k in ("Red", "Green", "Blue"):
    nt.links.new(mr.outputs["Result"], cv.inputs[k])
nt.links.new(cv.outputs["Color"], mix.inputs["B"])
nt.links.new(mix.outputs["Result"], bc)
for o in sector_objs:
    o.data.materials.append(mat)

tris = T.tri_count(sector_objs)
LOG["tris_total"] = tris
LOG["sectors"] = {o.name: {"tris": T.tri_count([o]), "bounds": T.obj_bounds([o])} for o in sector_objs}
P = T.world_verts_env(sector_objs)
LOG["placement_check"] = T.placement_check(P)
LOG["dist_from_origin_env"] = [round(float(np.hypot(P[:, 0], P[:, 1]).min()), 1), round(float(np.hypot(P[:, 0], P[:, 1]).max()), 1)]

# ---------------------------------------------------------------- save
blend = T.save_blend(ASSET, VER)
arr = {"asset": ASSET, "blend": os.path.basename(blend), "units": "env",
       "placements": [{"source": o.name, "name": o.name, "location": [0, 0, 0], "rotation_deg": [0, 0, 0], "scale": [1, 1, 1]}
                      for o in sector_objs]}
T.write_json(os.path.join(T.asset_dir(ASSET), "arrangement.json"), arr)

# ---------------------------------------------------------------- previews (world scale, fog like the main build)
K, DZ = T.ENV_K, T.ENV_DZ
T.to_world_scale(sector_objs)
R.setup_render(sc, "EEVEE", (1280, 720), 48)
for k_, v_ in (("volumetric_end", 90.0 * K * 1.2), ("volumetric_tile_size", "8"), ("volumetric_samples", 64)):
    try:
        setattr(sc.eevee, k_, v_)
    except Exception:
        pass
A.build_world(sc)
atm = bpy.data.collections.new("PREVIEW_ATM"); sc.collection.children.link(atm)
A.build_fog_volume(atm, center=(0, 22 * K, 4 * K + DZ), size=(160 * K * 1.3, 160 * K * 1.3, 40 * K),
                   density=0.03 / K, z_ref=-4.0 * K + DZ, falloff=5.0 * K)
R.standard_lights(40.0, lava=False, collection=atm)
# dark abyss floor + a stand-in disc for the central plateau so the scale reads
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=60 * K, fill_type="NGON", location=(CX * K, CY * K, -5.0 * K + DZ))
fl = bpy.context.active_object; fl.name = "PV_AbyssFloor"; M.assign(fl, "Basalt", moss=0.0)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=4.6 * K, depth=2.0 * K, location=(0, 0, -1.4 * K + DZ))
dc = bpy.context.active_object; dc.name = "PV_Dais"; M.assign(dc, "AncientStone")
views = {"hero": (T.HERO[0], T.HERO[1], T.HERO[2]),
         "elevated": ((0, -60 * K, 45 * K), (0, 20 * K, 0), 24),
         "side_close": ((-20 * K, 20 * K, 6 * K), (-60 * K, 40 * K, 8 * K), 35),
         "top": ((0, CY * K, 420 * K), (0, CY * K + 0.01, 0), 30)}
LOG["renders"] = {}
for vn, (loc, tgt, lens) in views.items():
    cam = T.view_cam("CAM_" + vn, loc, tgt, lens)
    p = os.path.join(RDIR, f"far_v{VER:03d}_{vn}.png")
    T.render(p, cam)
    LOG["renders"][vn] = os.path.relpath(p, T.CL)
LOG["seconds"] = round(time.time() - t0, 1)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
print("FAR_DONE", json.dumps({k: LOG[k] for k in ("version", "tris_total", "erosion", "placement_check", "dist_from_origin_env")}))
