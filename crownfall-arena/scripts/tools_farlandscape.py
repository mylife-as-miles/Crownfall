"""CFCL_Tools_FarLandscape - the distant world in layered depths (env units; main build world = env*4.6 + 1.94 z).

TERRAIN MIXER is the primary generator (heights everywhere come from its bake):
  scripts/tools_tm_bake.py drove Terrain Mixer headless (its replace_with_terrain operator, its terrain
  controls, its OrthoCamera4Baking via toggle_baking_camera, its 'Height Output' node) and baked
  tm_bake/final_<var>_height.exr + a Cycles DIFFUSE-COLOR bake final_<var>_color.png.
Here:
  1. erosion_terrain_extension: its generate_grid + erosion_simulation erode a 256^2 copy of the TM height
     (image space); the eroded delta is added back to the 1024^2 TM map (TM primary, erosion secondary).
  2. E33 'cubic fractured cliff' remap of that map (image space): terraces + orthogonal block fracture
     (rotated cells take their max height -> vertical block faces), ring mask (high features first).
  3. VERY FAR ring (36-80 env from (0,4)): dense polar grid + Displace modifier (texture = the remapped TM map,
     UV coords) APPLIED, decimated, split in 6 sectors.  Material: Basalt tinted by the TM colour bake.
  4. FAR / NEAR-FAR monumental silhouettes, all with heights sampled from the same TM map:
       cubic cliff wings (fractured block fields), stacked columnar-basalt skyline clusters,
       suspended landmasses (blocky tops, hanging basalt columns), and a broken multi-arch bridge under the
       eclipse built with ARCH GENERATOR's builders (round arch rings + piers).
  (v001-v002 = ring only: scripts/tools_farlandscape_v002_ringonly.py)
Usage: python lib/run_blender.py scripts/tools_farlandscape.py --timeout 2400 -- [variant] [droplets]
"""
import sys, os, json, math, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, Euler
import tools_common as T
import cf_render as R
import cf_materials as M
import cf_atmos as A
import cf_sdf as S

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VAR = argv[0] if argv else "abyss"
DROPS = int(argv[1]) if len(argv) > 1 else 30000
ASSET = "CFCL_Tools_FarLandscape"
VER = T.next_version(ASSET)
BAKE = os.path.join(T.asset_dir(ASSET), "tm_bake")
RDIR = os.path.join(T.CL, "renders", "tools", "farlandscape")
os.makedirs(RDIR, exist_ok=True)
LOG = {"asset": ASSET, "version": VER, "variant": VAR, "warnings": [], "layers": {}}
t0 = time.time()

CX, CY = 0.0, 4.0
R0, R1 = 36.0, 80.0
NT, NR = 1500, 150
TM_SPAN = 210.0
AMP_SIDE, AMP_FRONT, AMP_BACK = 26.0, 9.0, 16.0
NOTCH_DEG = 104.0
Z_FLOOR = -10.0
RING_BUDGET = 20000
SECTORS = 6

R.reset_scene()
T.enable("erosion_terrain_extension", "arch_generator")
ERO = sys.modules["bl_ext.blender_org.erosion_terrain_extension.terrain.terrain"]
AGB = sys.modules["bl_ext.blender_org.arch_generator.builders"]
AGG = sys.modules["bl_ext.blender_org.arch_generator.geometry"]
AGS = sys.modules["bl_ext.blender_org.arch_generator.styles"]
sc = bpy.context.scene
col = bpy.data.collections.new(ASSET)
sc.collection.children.link(col)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load_float(path):
    img = bpy.data.images.load(path, check_existing=False)
    a = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a


# ================================================================ 1. TM height + erosion (image space)
H = load_float(os.path.join(BAKE, f"final_{VAR}_height.exr"))[..., 0]
lo, hi = np.percentile(H, 0.5), np.percentile(H, 99.7)
Hn = np.clip((H - lo) / (hi - lo), 0.0, 1.0)
NPX = Hn.shape[0]
G = 256
step = NPX // G
Hs = Hn[::step, ::step][:G, :G].astype(np.float64)
RELIEF = 46.0
bm = bmesh.new()
ERO.generate_grid(bm, G, G)
bm.verts.ensure_lookup_table()
for v, z in zip(bm.verts, (Hs * RELIEF).ravel()):
    v.co.z = float(z)
random.seed(11)
t1 = time.time()
ERO.erosion_simulation(bm, G, G, [], DROPS, 40, 0.3, 5.0, 0.01, 10.0, 0.025, 2.0, 0.06, 0.12)
Ze = np.array([v.co.z for v in bm.verts], np.float64).reshape(G, G) / RELIEF
bm.free()
dZ = Ze - Hs
gi = np.linspace(0, G - 1, NPX)
i0 = np.floor(gi).astype(int); i1 = np.minimum(i0 + 1, G - 1); fr = gi - i0
rows = dZ[i0] * (1 - fr)[:, None] + dZ[i1] * fr[:, None]
dZu = rows[:, i0] * (1 - fr)[None, :] + rows[:, i1] * fr[None, :]
Hn = np.clip(Hn + dZu, 0, 1)
LOG["erosion"] = {"tool": "erosion_terrain_extension.erosion_simulation on its generate_grid (256^2, image space)",
                  "droplets": DROPS, "s": round(time.time() - t1, 1), "mean_abs_delta": float(np.abs(dZ).mean()),
                  "max_cut": float(-dZ.min()), "max_fill": float(dZ.max())}
print("[far] erosion", LOG["erosion"], flush=True)


def tm_sample(x, y):
    """Normalised (eroded) TM height at env x,y (TM square centred on (CX,CY), span TM_SPAN)."""
    u = np.clip(((np.asarray(x) - CX) / TM_SPAN + 0.5) * (NPX - 1), 0, NPX - 1).astype(int)
    v = np.clip(((np.asarray(y) - CY) / TM_SPAN + 0.5) * (NPX - 1), 0, NPX - 1).astype(int)
    return Hn[v, u]


# ================================================================ 2. cubic fracture + terraces + ring mask
pu = (np.arange(NPX) + 0.5) / NPX
PX, PY = np.meshgrid((pu - 0.5) * TM_SPAN + CX, (pu - 0.5) * TM_SPAN + CY)
PR = np.hypot(PX - CX, PY - CY)
PT = np.arctan2(PY - CY, PX - CX)
f = np.sin(PT)
amp = AMP_SIDE - (AMP_SIDE - AMP_FRONT) * np.clip(f, 0, 1) ** 1.2 - (AMP_SIDE - AMP_BACK) * np.clip(-f, 0, 1) ** 1.5
amp *= 1.0 + 0.16 * np.sin(3 * PT + 0.7) + 0.09 * np.sin(7 * PT + 2.1)
dnotch = np.degrees(np.abs((PT - np.radians(NOTCH_DEG) + np.pi) % (2 * np.pi) - np.pi))
amp *= 1.0 - 0.75 * smooth(14.0, 4.0, dnotch)
thr = 0.93 - 0.68 * smooth(R0, R0 + 18.0, PR)
shaped = np.clip((Hn - thr) / np.maximum(1.0 - thr, 1e-3), 0, 1) ** 0.85
shaped *= (1.0 - 0.25 * smooth(R1 - 8.0, R1, PR)) * smooth(R0 - 2.0, R0 + 2.0, PR)
hz = shaped * amp
blk = np.zeros_like(hz)
for k, (ang, cell) in enumerate(((0.35, 3.2), (1.1, 2.6), (-0.6, 4.0))):
    ca, sa = math.cos(ang), math.sin(ang)
    U_ = np.floor((PX * ca + PY * sa) / cell).astype(np.int64)
    V_ = np.floor((-PX * sa + PY * ca) / (cell * 1.35)).astype(np.int64)
    cid = (U_ - U_.min()) * 100000 + (V_ - V_.min())
    uniq, inv = np.unique(cid.ravel(), return_inverse=True)
    mx = np.zeros(len(uniq)); np.maximum.at(mx, inv, hz.ravel())
    jit = np.random.default_rng(k).uniform(0.82, 1.0, len(uniq))
    sel = (np.floor((PT + np.pi) / (2 * np.pi) * 9) % 3) == k
    blk = np.where(sel, (mx * jit)[inv].reshape(hz.shape), blk)
TERR = 2.4
terr = np.floor(hz / TERR) * TERR + (hz % TERR) * 0.18
final = np.where(hz > 0.4, 0.62 * blk + 0.38 * terr, hz)
final = np.maximum(final, 0)
FMAX = float(final.max())
LOG["remap"] = {"terrace_step_env": TERR, "block_cells_env": [3.2, 2.6, 4.0], "max_height_env": FMAX}

himg = bpy.data.images.new(f"CFCL_TM_Height_{VAR}_cubic", NPX, NPX, alpha=False, float_buffer=True)
himg.colorspace_settings.name = "Non-Color"
rgba = np.ones((NPX, NPX, 4), np.float32)
rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = final / FMAX
himg.pixels.foreach_set(rgba.ravel()); himg.update()
htex = bpy.data.textures.new("CFCL_TM_HeightTex", "IMAGE")
htex.image = himg; htex.extension = "EXTEND"; htex.use_interpolation = False
cimg = bpy.data.images.load(os.path.join(BAKE, f"final_{VAR}_color.png"), check_existing=False)
cimg.name = f"CFCL_TM_Color_{VAR}"
cimg.pack()

# ================================================================ 3. very-far ring: grid + Displace (applied)
th = np.linspace(0, 2 * np.pi, NT, endpoint=False)
rr = np.linspace(R0, R1, NR)
TT, RRg = np.meshgrid(th, rr)
X = CX + RRg * np.cos(TT); Y = CY + RRg * np.sin(TT)
Z0 = Z_FLOOR + 4.0 * smooth(R0 + 6.0, R1, RRg)
me = bpy.data.meshes.new("CFCL_FarLand_Ring")
verts = np.stack([X, Y, Z0], -1).reshape(-1, 3)
jj, ii = np.meshgrid(np.arange(NR - 1), np.arange(NT), indexing="ij")
i2 = (ii + 1) % NT
faces = np.stack([jj * NT + ii, jj * NT + i2, (jj + 1) * NT + i2, (jj + 1) * NT + ii], -1).reshape(-1, 4)
me.vertices.add(len(verts)); me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
me.loops.add(faces.size); me.loops.foreach_set("vertex_index", faces.ravel().astype(np.int32))
me.polygons.add(len(faces))
me.polygons.foreach_set("loop_start", (np.arange(len(faces)) * 4).astype(np.int32))
me.update(calc_edges=True)
uvl = me.uv_layers.new(name="TMUV")
U = ((X - CX) / TM_SPAN + 0.5).ravel(); Vv = ((Y - CY) / TM_SPAN + 0.5).ravel()
uv = np.stack([U, Vv], 1)[faces.ravel()]
uvl.data.foreach_set("uv", uv.ravel().astype(np.float32))
ring = bpy.data.objects.new("CFCL_FarLand_Ring", me)
col.objects.link(ring)
dm = ring.modifiers.new("TM_Displace", "DISPLACE")
dm.texture = htex; dm.texture_coords = "UV"; dm.uv_layer = "TMUV"; dm.direction = "Z"; dm.mid_level = 0.0
dm.strength = FMAX
bpy.context.view_layer.objects.active = ring
ring.select_set(True)
bpy.ops.object.modifier_apply(modifier=dm.name)
tris0 = len(faces) * 2
dec = ring.modifiers.new("Decimate", "DECIMATE"); dec.decimate_type = "COLLAPSE"; dec.ratio = RING_BUDGET / tris0
bpy.ops.object.modifier_apply(modifier=dec.name)
LOG["layers"]["ring"] = {"grid_tris": tris0, "tris": T.tri_count([ring])}

sector_objs = []
bm = bmesh.new(); bm.from_mesh(me)
names = ["Front", "FrontRight", "BackRight", "Back", "BackLeft", "FrontLeft"]
for s_ in range(SECTORS):
    a0 = math.radians(60) + s_ * 2 * math.pi / SECTORS
    b2 = bm.copy()
    kill = []
    for fc in b2.faces:
        c = fc.calc_center_median()
        if ((math.atan2(c.y - CY, c.x - CX) - a0) % (2 * math.pi)) >= 2 * math.pi / SECTORS:
            kill.append(fc)
    bmesh.ops.delete(b2, geom=kill, context="FACES")
    m2 = bpy.data.meshes.new(f"CFCL_FarLand_Ring_{names[s_]}")
    b2.to_mesh(m2); b2.free()
    o2 = bpy.data.objects.new(f"CFCL_FarLand_Ring_{names[s_]}", m2)
    col.objects.link(o2)
    sector_objs.append(o2)
bm.free()
bpy.data.objects.remove(ring)


# ================================================================ 4. monumental silhouettes (TM-sampled heights)
class MB:
    def __init__(self):
        self.v, self.f = [], []

    def box(self, c, hx, hy, z0, z1, rot=0.0, tilt=(0.0, 0.0)):
        ca, sa = math.cos(rot), math.sin(rot)
        Rt = Euler((tilt[0], tilt[1], 0)).to_matrix()
        base = len(self.v)
        for z in (z0, z1):
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                lx, ly = sx * hx, sy * hy
                p = Rt @ Vector((lx * ca - ly * sa, lx * sa + ly * ca, z - z0))
                self.v.append((c[0] + p.x, c[1] + p.y, z0 + p.z))
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.f.append(tuple(base + i for i in q))

    def hexcol(self, c, r, z0, z1, rot=0.0, cap_tilt=0.0, cap_dir=0.0):
        base = len(self.v)
        for k in range(6):
            a = rot + k * math.pi / 3
            self.v.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), z0))
        for k in range(6):
            a = rot + k * math.pi / 3
            dz = math.tan(cap_tilt) * r * math.cos(a - cap_dir)
            self.v.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), z1 + dz))
        for k in range(6):
            k2 = (k + 1) % 6
            self.f.append((base + k, base + k2, base + 6 + k2, base + 6 + k))
        self.f.append(tuple(base + 6 + k for k in range(6)))
        self.f.append(tuple(base + k for k in reversed(range(6))))

    def prism(self, poly, z0, z1):
        base = len(self.v)
        n = len(poly)
        for x, y in poly:
            self.v.append((x, y, z0))
        for x, y in poly:
            self.v.append((x, y, z1))
        self.f.append(tuple(base + n + k for k in range(n)))
        self.f.append(tuple(base + k for k in reversed(range(n))))
        for k in range(n):
            k2 = (k + 1) % n
            self.f.append((base + k, base + k2, base + n + k2, base + n + k))

    def obj(self, name):
        m = bpy.data.meshes.new(name)
        m.from_pydata(self.v, [], self.f)
        m.update()
        o = bpy.data.objects.new(name, m)
        col.objects.link(o)
        return o


def block_field(name, cx, cy, w, d, ang, base_h, amp, z0=-9.0, cell=(2.2, 5.5), seed=0, lean=0.12):
    """E33 cubic fractured cliff: recursive orthogonal splits; each block's height = TM sample, quantized."""
    r = random.Random(seed)
    mb = MB()
    cells = [(-w / 2, -d / 2, w / 2, d / 2)]
    out = []
    while cells:
        x0, y0, x1, y1 = cells.pop()
        sx, sy = x1 - x0, y1 - y0
        if max(sx, sy) > cell[1] or (max(sx, sy) > cell[0] * 2 and r.random() < 0.45):
            if sx > sy:
                m = x0 + sx * r.uniform(0.35, 0.65); cells += [(x0, y0, m, y1), (m, y0, x1, y1)]
            else:
                m = y0 + sy * r.uniform(0.35, 0.65); cells += [(x0, y0, x1, m), (x0, m, x1, y1)]
        else:
            out.append((x0, y0, x1, y1))
    ca, sa = math.cos(ang), math.sin(ang)
    for x0, y0, x1, y1 in out:
        lx, ly = (x0 + x1) / 2, (y0 + y1) / 2
        gx, gy = cx + lx * ca - ly * sa, cy + lx * sa + ly * ca
        edge = 1.0 - 0.55 * max(abs(lx) / (w / 2), abs(ly) / (d / 2)) ** 2.0
        h = base_h + amp * float(tm_sample(gx, gy)) * edge * r.uniform(0.75, 1.1)
        h = math.floor(h / 1.2) * 1.2 + r.uniform(0, 0.3)
        gap = r.uniform(0.04, 0.16)
        hx, hy = (x1 - x0) / 2 - gap, (y1 - y0) / 2 - gap
        if hx < 0.15 or hy < 0.15:
            continue
        tilt = (r.uniform(-lean, lean), r.uniform(-lean, lean)) if r.random() < 0.4 else (0.0, 0.0)
        # bedding: the visible part (above z=-1) is split into 1-2.4 env slabs, each slightly out of line
        zs = [z0, -1.0]
        while zs[-1] < h - 0.6:
            zs.append(min(h, zs[-1] + r.uniform(1.0, 2.4)))
        if zs[-1] < h:
            zs.append(h)
        shrink = 1.0
        for k in range(len(zs) - 1):
            off = (r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25)) if k > 1 else (0, 0)
            if k > 1:
                shrink *= r.uniform(0.86, 1.0)
            mb.box((gx + off[0], gy + off[1]), hx * shrink, hy * shrink, float(zs[k]), float(zs[k + 1]) - 0.07,
                   rot=ang + r.uniform(-0.05, 0.05), tilt=tilt)
    return mb.obj(name)


def basalt_stack(mb, cx, cy, rc, hmax, seed, z0=-9.0, d=0.95, hang=False, zt=0.0):
    """Stacked hexagonal columnar basalt, heights stepping like a skyline (TM-modulated)."""
    r = random.Random(seed)
    rh = d / math.sqrt(3) * 0.97
    n = 0
    for q in range(-int(rc / d) - 2, int(rc / d) + 3):
        for p_ in range(-int(rc / d) - 2, int(rc / d) + 3):
            x = cx + d * (p_ + 0.5 * (q % 2)); y = cy + d * q * math.sqrt(3) / 2
            dist = math.hypot(x - cx, y - cy) / rc
            if dist > 1.0 + 0.15 * r.random():
                continue
            prof = max(0.0, 1.0 - dist) ** 0.55
            h = hmax * prof * (0.7 + 0.5 * float(tm_sample(x, y))) * r.uniform(0.6, 1.4)
            if r.random() < 0.06:
                h *= 1.5                                           # odd tall spike
            h = math.floor(h / 0.35) * 0.35
            if h < 0.6:
                continue
            if hang:
                mb.hexcol((x, y), rh, zt - h, zt, rot=math.pi / 6)
            else:
                mb.hexcol((x, y), rh, z0, h, rot=math.pi / 6, cap_tilt=r.uniform(0, 0.35), cap_dir=r.uniform(0, 6.28))
            n += 1
    return n


extra = []
LAY = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools_farlandscape_layout.json")))
def ridge_strip(name, y, x0, x1, depth, amp, z0, uoff, notch_x=1.5, notch=0.3, terr=1.2):
    """Distant ridge layer: grid -> Displace (TM eroded height, UV) applied -> terraced -> decimated."""
    nx, ny = 320, 36
    xs_ = np.linspace(x0, x1, nx); ys_ = np.linspace(y - depth / 2, y + depth / 2, ny)
    GX, GY = np.meshgrid(xs_, ys_)
    me_ = bpy.data.meshes.new(name)
    vv = np.stack([GX, GY, np.full_like(GX, z0)], -1).reshape(-1, 3)
    jj_, ii_ = np.meshgrid(np.arange(ny - 1), np.arange(nx - 1), indexing="ij")
    ff = np.stack([jj_ * nx + ii_, jj_ * nx + ii_ + 1, (jj_ + 1) * nx + ii_ + 1, (jj_ + 1) * nx + ii_], -1).reshape(-1, 4)
    me_.from_pydata(vv.tolist(), [], ff.tolist())
    uvl_ = me_.uv_layers.new(name="TMUV")
    lv = np.empty(len(me_.loops), np.int32); me_.loops.foreach_get("vertex_index", lv)
    U_ = (GX.ravel() - CX) / TM_SPAN + 0.5 + uoff[0]; V_ = (GY.ravel() - CY) / TM_SPAN + 0.5 + uoff[1]
    uvl_.data.foreach_set("uv", np.stack([U_, V_], 1)[lv].ravel().astype(np.float32))
    o_ = bpy.data.objects.new(name, me_); col.objects.link(o_)
    # weight: taper toward the strip edges and lower under the eclipse (keeps the disc's lower limb clear)
    wgt = (1 - smooth(0.0, 1.0, np.abs(GY - y) / (depth / 2)) * 0.8) * smooth(x0, x0 + 8, GX) * smooth(x1, x1 - 8, GX)
    wgt *= 1.0 - notch * np.exp(-((GX - notch_x) ** 2) / 60.0)
    vg_ = o_.vertex_groups.new(name="w")
    wf = np.round(wgt.ravel(), 2)
    for k_ in np.unique(wf):
        vg_.add(np.nonzero(wf == k_)[0].tolist(), float(k_), "REPLACE")
    d_ = o_.modifiers.new("TM_Displace", "DISPLACE"); d_.texture = htex_raw; d_.texture_coords = "UV"; d_.uv_layer = "TMUV"
    d_.direction = "Z"; d_.mid_level = 0.0; d_.strength = amp; d_.vertex_group = "w"
    bpy.context.view_layer.objects.active = o_
    bpy.ops.object.modifier_apply(modifier=d_.name)
    co_ = np.empty(len(me_.vertices) * 3, np.float32); me_.vertices.foreach_get("co", co_); co_ = co_.reshape(-1, 3)
    h_ = co_[:, 2] - z0
    co_[:, 2] = z0 + np.floor(h_ / terr) * terr + (h_ % terr) * 0.35            # soft terraces (stepped cliffs)
    me_.vertices.foreach_set("co", co_.ravel()); me_.update()
    dc_ = o_.modifiers.new("dec", "DECIMATE"); dc_.ratio = 3600 / (2 * len(ff))
    bpy.ops.object.modifier_apply(modifier=dc_.name)
    return o_


# raw eroded TM height (no ring mask) for the ridge layers
himg_raw = bpy.data.images.new(f"CFCL_TM_Height_{VAR}_eroded", NPX, NPX, alpha=False, float_buffer=True)
himg_raw.colorspace_settings.name = "Non-Color"
_rg = np.ones((NPX, NPX, 4), np.float32); _rg[..., 0] = _rg[..., 1] = _rg[..., 2] = Hn
himg_raw.pixels.foreach_set(_rg.ravel()); himg_raw.update()
htex_raw = bpy.data.textures.new("CFCL_TM_HeightTexRaw", "IMAGE"); htex_raw.image = himg_raw; htex_raw.extension = "REPEAT"
for i, rg in enumerate(LAY.get("ridges", [])):
    extra.append(ridge_strip(rg["name"], rg["y"], rg["x0"], rg["x1"], rg["depth"], rg["amp"], rg["z0"], rg["uoff"]))
for i, w in enumerate(LAY["cliff_wings"]):
    extra.append(block_field(w["name"], w["c"][0], w["c"][1], w["w"], w["d"], math.radians(w["ang"]), w["base"], w["amp"], seed=30 + i))
mb = MB()
ncol = 0
for i, st in enumerate(LAY["basalt_stacks"]):
    ncol += basalt_stack(mb, st["c"][0], st["c"][1], st["r"], st["h"], 50 + i)
extra.append(mb.obj("CFCL_FarLand_BasaltStacks"))
LOG["layers"]["basalt_columns"] = ncol

# ---------------------------------------------------------------- suspended ARCHITECTURAL fragments (user review of main v006):
# a few large recognisable pieces torn from the world, each riding a broken rock wedge.  Architecture from the
# ARCH GENERATOR builders (props namespace from its own defaults), rock from cf_sdf; heights/tilts from the layout.
from types import SimpleNamespace
bpy.ops.mesh.arch_create()
_tmp = bpy.context.view_layer.objects.active
ADEF = {p_.identifier: getattr(_tmp.arch_props, p_.identifier) for p_ in _tmp.arch_props.bl_rna.properties
        if p_.identifier not in ("rna_type", "name")}
bpy.data.objects.remove(_tmp)


def aprops(**kw):
    d_ = dict(ADEF); d_.update(kw)
    return SimpleNamespace(**d_)


class BMA:
    """bmesh accumulator with a material index per part (0 = stone, 1 = rock)."""
    def __init__(self):
        self.bm = bmesh.new()
        self.tmp = bpy.data.meshes.new("tmpfrag")

    def add(self, bm_, mat=0, M_=None):
        bmesh.ops.remove_doubles(bm_, verts=bm_.verts, dist=1e-4)
        bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
        if M_ is not None:
            bmesh.ops.transform(bm_, matrix=M_, verts=bm_.verts)
        bm_.to_mesh(self.tmp)
        n0 = len(self.bm.faces)
        self.bm.from_mesh(self.tmp)
        self.bm.faces.ensure_lookup_table()
        for i_ in range(n0, len(self.bm.faces)):
            self.bm.faces[i_].material_index = mat
        bm_.free()

    def call(self, fn, *args, mat=0, M_=None):
        b_ = bmesh.new(); fn(b_, *args); self.add(b_, mat, M_)

    def obj(self, name):
        m_ = bpy.data.meshes.new(name); self.bm.to_mesh(m_); self.bm.free(); bpy.data.meshes.remove(self.tmp)
        o_ = bpy.data.objects.new(name, m_); col.objects.link(o_)
        return o_


def column(acc, p_, x, y, z0, drums=3, snap=None, rng_=None):
    """Add-on pillar (base, shaft drums, capital); snap = fraction of shaft height kept (broken column)."""
    acc.call(AGG.add_base, 0.0, p_, M_=Matrix.Translation((x, y, z0)))
    zb, zt = p_.base_height * 0.9, p_.stambha_height - p_.capital_height
    keep = zt if snap is None else zb + (zt - zb) * snap
    hs = np.linspace(zb, keep, drums + 1)
    for k in range(drums):
        q = aprops(**{**vars(p_), "stambha_height": float(hs[k + 1] - hs[k]) - 0.02})
        rot = Matrix.Rotation(math.radians(rng_.uniform(-6, 6)) if rng_ else 0.0, 4, "Z")
        acc.call(AGG.add_stambha_shaft, 0.0, q, M_=Matrix.Translation((x, y, z0 + float(hs[k]) + 0.01)) @ rot)
    if snap is None:
        acc.call(AGG.add_capital, 0.0, p_, M_=Matrix.Translation((x, y, z0)))


def rock_wedge(acc, rx, ry, depth, seed, mat=1):
    def f_(P):
        Q = S.warp(P, 0.3, 0.3, seed=seed)
        w_ = S.round_cone(Q, (0.3 * rx, -0.2 * ry, -depth), (0, 0, -0.35), 0.3, min(rx, ry))
        top = S.box(Q, (0, 0, -0.35), (rx, ry, 0.42), R=S.rot_matrix(0, 0, 9), round_r=0.2)
        lob = S.round_cone(Q, (-0.4 * rx, 0.35 * ry, -depth * 0.6), (-0.2 * rx, 0.1 * ry, -0.4), 0.25, min(rx, ry) * 0.6)
        d_ = S.smin(S.smin(w_, top, 0.5), lob, 0.4)
        # fracture: the wedge is broken by 5 planar cleavage cuts (torn from a cliff, not a smooth blob)
        rr_ = np.random.default_rng(seed)
        for _k in range(5):
            nrm = rr_.normal(size=3); nrm[2] = -abs(nrm[2]) * 0.6 - 0.2; nrm /= np.linalg.norm(nrm)
            off = rr_.uniform(0.35, 0.7) * min(rx, ry) + abs(nrm[2]) * depth * 0.35
            d_ = S.smax(d_, (P @ nrm) - off, 0.08)
        strata = 0.12 * np.abs(np.sin(P[:, 2] * 3.3 + 0.5 * S.fbm(P, 0.6, 2, seed=seed)))
        return d_ + strata + 0.16 * S.fbm(Q, 0.8, 3, seed=seed + 1) + 0.10 * S.ridged(Q, 1.8, 2, seed=seed + 2)
    pad = 1.0
    v_, q_ = S.mesh_sdf(f_, (-rx - pad, -ry - pad, -depth - pad), (rx + pad, ry + pad, 0.6), max(min(rx, ry) / 18, 0.14), verbose=False)
    tmpo = S.to_blender_mesh("tmp_wedge", v_, q_, collection=col, smooth=False)
    # weathered uneven silhouette: Displace (voronoi crackle = chipped facets) + Displace (clouds), then Decimate
    tv = bpy.data.textures.get("CFCL_FragCrackle") or bpy.data.textures.new("CFCL_FragCrackle", "VORONOI")
    tv.noise_scale = 0.9; tv.distance_metric = "DISTANCE"; tv.color_mode = "INTENSITY"
    tc = bpy.data.textures.get("CFCL_FragClouds") or bpy.data.textures.new("CFCL_FragClouds", "CLOUDS")
    tc.noise_scale = 1.6; tc.noise_depth = 3
    for nm_, tex_, st_ in (("crackle", tv, 0.38), ("clouds", tc, 0.45)):
        d1_ = tmpo.modifiers.new(nm_, "DISPLACE"); d1_.texture = tex_; d1_.strength = st_; d1_.mid_level = 0.5
        d1_.texture_coords = "OBJECT" if False else "LOCAL"
    dm_ = tmpo.modifiers.new("dec", "DECIMATE"); dm_.ratio = min(1.0, 2600 / max(1, 2 * len(q_)))
    bpy.context.view_layer.objects.active = tmpo
    for m_ in list(tmpo.modifiers):
        bpy.ops.object.modifier_apply(modifier=m_.name)
    b_ = bmesh.new(); b_.from_mesh(tmpo.data)
    bpy.data.objects.remove(tmpo)
    acc.add(b_, mat)


def paving(acc, x0, x1, y0, y1, z, rng_, drop=0.15, th=0.32):
    """Carved ancient floor slab: irregular ashlar paving (NOT a checker), a few stones missing or tilted."""
    y = y0
    while y < y1 - 0.1:
        yh = min(y1, y + rng_.uniform(0.8, 1.3))
        x = x0
        while x < x1 - 0.1:
            xh = min(x1, x + rng_.uniform(0.9, 1.7))
            if rng_.random() > drop:
                tz = rng_.uniform(-0.05, 0.05)
                acc.call(AGG.add_box, x + 0.04, xh - 0.04, y + 0.04, yh - 0.04, z - th + tz, z + tz)
            x = xh
        y = yh


def frag_arch_span(seed):
    r_ = random.Random(seed); acc = BMA()
    rock_wedge(acc, 4.6, 1.9, 5.5, seed)
    paving(acc, -4.4, 4.4, -1.6, 1.6, 0.25, r_)
    cp = aprops(stambha_width=0.55, stambha_depth=0.55, stambha_height=3.3, pillar_style="ROUNDED", trim_resolution=12,
                base_style="CIRCULAR", base_step_count=2, base_width=0.85, base_depth=0.85, base_height=0.35,
                capital_style="SQUARE", capital_step_count=2, capital_width=0.8, capital_depth=0.8, capital_height=0.3)
    xs_ = [-3.0, 0.0, 3.0]
    for k, x in enumerate(xs_):
        column(acc, cp, x, 0.0, 0.25, drums=3, snap=0.45 if k == 2 else None, rng_=r_)
    W = 3.0 - 0.6
    for k in range(2):
        cx_ = (xs_[k] + xs_[k + 1]) / 2
        prof = [(x + cx_, z) for x, z in AGS.build_roman_arch(W, W / 2, 3.55, 24)]
        if k == 1:
            prof = prof[:9]                          # the second arch broke where its column snapped
        acc.call(AGB.build_3d_square_arch_mesh, prof, 0.36, 0.75)
        acc.call(AGB.build_3d_square_arch_mesh, [(x, z) for x, z in AGS.build_roman_arch(W + 0.74, W / 2 + 0.37, 3.55, 24)][:(9 if k == 1 else 25)] if False else [(x + cx_, z) for x, z in AGS.build_roman_arch(W + 0.74, W / 2 + 0.37, 3.55, 24)][:(8 if k == 1 else 25)], 0.12, 0.95)
    acc.call(AGG.add_box, -3.5, 1.2, -0.45, 0.45, 5.15, 5.65)          # entablature run, broken off
    return acc.obj("CFCL_FarLand_Frag_ArchSpan")


def frag_tower_crown(seed):
    r_ = random.Random(seed); acc = BMA()
    rock_wedge(acc, 2.9, 2.9, 4.5, seed)
    acc.call(AGG.add_prism_column, 0.0, 6.2, 6.2, 0.0, 0.55, M_=None)
    cp = aprops(stambha_width=0.42, stambha_depth=0.42, stambha_height=2.6, pillar_style="FLUTED", flute_count=8,
                flute_depth=0.08, trim_resolution=12, base_style="CIRCULAR", base_step_count=2, base_width=0.62,
                base_depth=0.62, base_height=0.28, capital_style="AMALAKA", capital_width=0.6, capital_depth=0.6, capital_height=0.32)
    n = 10
    for k in range(n):
        a_ = k * 2 * math.pi / n
        if k in (3,):
            continue                                       # one colonnette lost
        column(acc, cp, 2.45 * math.cos(a_), 2.45 * math.sin(a_), 0.55, drums=2, snap=0.55 if k in (4, 5) else None, rng_=r_)
    # cornice ring of voussoir-like blocks, broken on the side of the lost colonnettes
    for k in range(20):
        a0_, a1_ = k * 2 * math.pi / 20, (k + 0.92) * 2 * math.pi / 20
        if 5 <= k <= 10:
            continue
        b_ = bmesh.new()
        R0_, R1_ = 2.05, 2.95
        pts = [(R0_ * math.cos(a0_), R0_ * math.sin(a0_)), (R1_ * math.cos(a0_), R1_ * math.sin(a0_)),
               (R1_ * math.cos(a1_), R1_ * math.sin(a1_)), (R0_ * math.cos(a1_), R0_ * math.sin(a1_))]
        vb = [b_.verts.new((x, y, 3.42)) for x, y in pts]; vt = [b_.verts.new((x, y, 3.95 + r_.uniform(-0.04, 0.04))) for x, y in pts]
        b_.faces.new(vb[::-1]); b_.faces.new(vt)
        for j in range(4):
            j2 = (j + 1) % 4
            b_.faces.new((vb[j], vb[j2], vt[j2], vt[j]))
        acc.add(b_, 0)
    # stub of the drum wall / dome springing on the intact side
    acc.call(AGB.build_3d_square_arch_mesh, [(x * 0.95, z) for x, z in AGS.build_roman_arch(4.6, 2.3, 3.95, 20)][:6], 0.3, 0.9,
             M_=Matrix.Rotation(math.radians(200), 4, "Z"))
    return acc.obj("CFCL_FarLand_Frag_TowerCrown")


def frag_floor_column(seed):
    r_ = random.Random(seed); acc = BMA()
    rock_wedge(acc, 3.8, 2.6, 5.0, seed)
    paving(acc, -3.6, 3.6, -2.3, 2.3, 0.25, r_, drop=0.2, th=0.36)
    cp = aprops(stambha_width=0.85, stambha_depth=0.85, stambha_height=6.2, pillar_style="SOLOMONIC", flute_count=6,
                flute_depth=0.16, pillar_solomonic_twists=0.5, trim_resolution=14, base_style="PADMA", padma_petals=10,
                padma_depth=0.2, base_width=1.25, base_depth=1.25, base_height=0.7, capital_style="AMALAKA",
                capital_width=1.15, capital_depth=1.15, capital_height=0.6)
    column(acc, cp, -1.6, 0.4, 0.25, drums=4, rng_=r_)
    column(acc, cp, 2.0, -0.6, 0.25, drums=2, snap=0.3, rng_=r_)
    q = aprops(**{**vars(cp), "stambha_height": 1.3})
    acc.call(AGG.add_stambha_shaft, 0.0, q, M_=Matrix.Translation((1.2, 1.3, 0.75)) @ Matrix.Rotation(math.radians(90), 4, "Y")
             @ Matrix.Rotation(math.radians(25), 4, "X"))       # a fallen drum lying on the slab
    return acc.obj("CFCL_FarLand_Frag_FloorColumn")


def frag_cliff_ruins(seed):
    r_ = random.Random(seed); acc = BMA()
    rock_wedge(acc, 4.2, 3.0, 7.0, seed)
    # fractured cliff blocks on top (cubic, E33) and a ruined wall with a half arch
    for k in range(7):
        x0_ = r_.uniform(-3.6, 1.6); y0_ = r_.uniform(-2.4, 1.2)
        acc.call(AGG.add_box, x0_, x0_ + r_.uniform(1.0, 2.2), y0_, y0_ + r_.uniform(1.0, 1.8), 0.0, r_.uniform(0.6, 2.6), mat=1)
    for c_ in range(4):
        zc = 0.3 + c_ * 0.55
        x_ = 0.3
        while x_ < 3.6 - 0.6 * c_:
            xe_ = x_ + r_.uniform(0.6, 1.1)
            acc.call(AGG.add_box, x_ + 0.03, xe_ - 0.03, 1.0, 1.7, zc, zc + 0.5)
            x_ = xe_
    prof = [(x + 2.2, z) for x, z in AGS.build_roman_arch(1.8, 0.9, 2.5, 16)][:9]
    acc.call(AGB.build_3d_square_arch_mesh, prof, 0.3, 0.7, M_=Matrix.Translation((0, 1.35, 0)))
    return acc.obj("CFCL_FarLand_Frag_CliffRuins")


FRAG = {"arch_span": frag_arch_span, "tower_crown": frag_tower_crown, "floor_column": frag_floor_column,
        "cliff_ruins": frag_cliff_ruins}
for i, fr in enumerate(LAY["fragments"]):
    o = FRAG[fr["type"]](200 + i)
    o.location = fr["c"]
    o.rotation_euler = [math.radians(v) for v in fr.get("rot", [0, 0, 0])]
    o.scale = [fr.get("scale", 1.0)] * 3
    extra.append(o)


def bridge(name, x0, x1, deck, z_floor=-9.0, bays=5, broken=(2,), snapped=(3,)):
    bm_all = bmesh.new()
    tmp = bpy.data.meshes.new("tmp")
    span = (x1 - x0) / bays
    pw = 0.95
    W = span - pw

    def add(b):
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        b.to_mesh(tmp); bm_all.from_mesh(tmp); b.free()
    rb = random.Random(7)
    for i in range(bays + 1):
        px = x0 + i * span + rb.uniform(-0.1, 0.1)
        top = deck - W / 2 - 0.1
        if i in snapped:
            top = deck - W / 2 - rb.uniform(2.2, 3.4)
        b = bmesh.new(); AGG.add_box(b, px - pw / 2, px + pw / 2, -0.75, 0.75, z_floor, top); add(b)
        b = bmesh.new(); AGG.add_box(b, px - pw / 2 - 0.15, px + pw / 2 + 0.15, -0.85, 0.85, top - 0.35, top); add(b)
    for i in range(bays):
        cxb = x0 + (i + 0.5) * span
        prof = [(x + cxb, z) for x, z in AGS.build_roman_arch(W, W / 2, deck - W / 2 - 0.1, 24)]
        if i in broken or (i - 1) in snapped or i in snapped:
            # lost span: only stubs remain on the sides whose pier still stands
            if (i not in snapped) and (i not in broken or True):
                b = bmesh.new(); AGB.build_3d_square_arch_mesh(b, prof[:6], 0.45, 1.5); add(b)
            if (i + 1) not in snapped and i not in snapped:
                b = bmesh.new(); AGB.build_3d_square_arch_mesh(b, prof[-6:], 0.45, 1.5); add(b)
            continue
        b = bmesh.new(); AGB.build_3d_square_arch_mesh(b, prof, 0.45, 1.5); add(b)
        # deck survives in broken runs of slabs
        xa = cxb - span / 2
        while xa < cxb + span / 2 - 0.2:
            xb = min(cxb + span / 2, xa + rb.uniform(0.7, 1.6))
            if rb.random() > 0.25:
                b = bmesh.new(); AGG.add_box(b, xa + 0.04, xb - 0.04, -0.8, 0.8, deck - 0.1, deck + rb.uniform(0.3, 0.6)); add(b)
            xa = xb
    bpy.data.meshes.remove(tmp)
    bmesh.ops.remove_doubles(bm_all, verts=bm_all.verts, dist=1e-4)
    m = bpy.data.meshes.new(name); bm_all.to_mesh(m); bm_all.free()
    o = bpy.data.objects.new(name, m); col.objects.link(o)
    return o


for i, br in enumerate(LAY["bridges"]):
    bro = bridge(br["name"], br["x0"], br["x1"], br["deck"], bays=br["bays"], broken=tuple(br["broken"]), snapped=tuple(br["snapped"]))
    bro.location = (0, br["y"], 0)
    bro.rotation_euler = (0, 0, math.radians(br.get("yaw", 0)))
    extra.append(bro)

# ================================================================ materials
HAZE = (0.31, 0.285, 0.25)          # pale warm haze (linear), eclipse-amber key


def add_haze(mat_, d0, d1, fmax):
    """Mix the base colour toward the haze with camera distance (world m) and flatten it (lower contrast)."""
    nt_ = mat_.node_tree
    pr_ = next(n for n in nt_.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bc_ = pr_.inputs["Base Color"]
    src_ = bc_.links[0].from_socket if bc_.links else None
    cam = nt_.nodes.new("ShaderNodeCameraData")
    mr_ = nt_.nodes.new("ShaderNodeMapRange")
    mr_.inputs["From Min"].default_value = d0; mr_.inputs["From Max"].default_value = d1
    mr_.inputs["To Min"].default_value = 0.0; mr_.inputs["To Max"].default_value = fmax
    nt_.links.new(cam.outputs["View Distance"], mr_.inputs["Value"])
    mx_ = nt_.nodes.new("ShaderNodeMix"); mx_.data_type = "RGBA"; mx_.blend_type = "MIX"
    nt_.links.new(mr_.outputs["Result"], mx_.inputs["Factor"])
    if src_ is not None:
        nt_.links.new(src_, mx_.inputs["A"])
    else:
        mx_.inputs["A"].default_value = tuple(bc_.default_value)
    mx_.inputs["B"].default_value = (*HAZE, 1.0)
    nt_.links.new(mx_.outputs["Result"], bc_)
    pr_.inputs["Roughness"].default_value = 0.9
    return mat_


base = M.get("Basalt", moss=0.08, scale=6.0, columns=0.0)
mat = base.copy(); mat.name = "CFCL_Tools_FarLand_TMBasalt"
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
mr.inputs["To Min"].default_value = 0.75; mr.inputs["To Max"].default_value = 1.6
nt.links.new(bw.outputs["Val"], mr.inputs["Value"])
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.inputs["Factor"].default_value = 1.0
if src is not None:
    nt.links.new(src, mix.inputs["A"])
cv = nt.nodes.new("ShaderNodeCombineColor")
for k in ("Red", "Green", "Blue"):
    nt.links.new(mr.outputs["Result"], cv.inputs[k])
nt.links.new(cv.outputs["Color"], mix.inputs["B"])
nt.links.new(mix.outputs["Result"], bc)
add_haze(mat, 150.0, 420.0, 0.78)
for o in sector_objs:
    o.data.materials.append(mat)
HZ = {}


def hazed(name, d0, d1, fmax, **kw):
    key = (name, d0, d1, fmax, tuple(sorted(kw.items())))
    if key not in HZ:
        m_ = M.get(name, **kw).copy(); m_.name = f"CFCL_Tools_FarLand_{name}_haze{int(d0)}"
        HZ[key] = add_haze(m_, d0, d1, fmax)
    return HZ[key]


for o in extra:
    o.data.materials.clear()
    if "Bridge" in o.name:
        M.bake_curvature(o); o.data.materials.append(hazed("AncientStone", 120.0, 330.0, 0.7, moss=0.3))
    elif "_Frag_" in o.name:
        M.bake_curvature(o)
        o.data.materials.append(hazed("AncientStone", 60.0, 260.0, 0.55, moss=0.35))
        o.data.materials.append(hazed("Basalt", 60.0, 260.0, 0.55, moss=0.3, scale=4.0, columns=0.0))
    elif "Ridge" in o.name:
        o.data.materials.append(hazed("Basalt", 120.0, 380.0, 0.8, moss=0.1, scale=6.0, columns=0.0))
    else:
        M.bake_curvature(o); o.data.materials.append(hazed("Basalt", 90.0, 360.0, 0.72, moss=0.12, scale=4.0, columns=0.0))

allobj = sector_objs + extra
bpy.context.view_layer.update()
LOG["tris_total"] = T.tri_count(allobj)
LOG["objects"] = {o.name: T.tri_count([o]) for o in allobj}
LOG["checks"] = {}
import cf_integrate as I
_hc = bpy.data.collections.new("TMP_Hand"); sc.collection.children.link(_hc)
I.append_asset(os.path.join(T.CL, "assets", "CFCL_Hero_Hand"), _hc, 1.0, [])
bpy.context.view_layer.update()
HAND = T.world_verts_env([o for o in _hc.all_objects if o.name == "CFCL_Hero_Hand"], 3000)
for o in list(_hc.all_objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.data.collections.remove(_hc)
for o in allobj:
    P = T.world_verts_env([o], 2500)
    LOG["checks"][o.name] = {k: v for k, v in T.placement_check(P).items() if k in ("screen_x", "screen_y_top", "eclipse_screen_gap_in_radii", "min_r_env")}
    LOG["checks"][o.name]["cams"] = T.silhouette_check(P, [("hand", HAND)])

blend = T.save_blend(ASSET, VER)
arr = {"asset": ASSET, "blend": os.path.basename(blend), "units": "env",
       "placements": [{"source": o.name, "name": o.name, "location": [round(v, 3) for v in o.location],
                       "rotation_deg": [round(math.degrees(a), 2) for a in o.rotation_euler], "scale": [1, 1, 1]} for o in allobj]}
T.write_json(os.path.join(T.asset_dir(ASSET), "arrangement.json"), arr)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)

# ================================================================ previews (world scale, main-build fog + eclipse)
K, DZ = T.ENV_K, T.ENV_DZ
T.to_world_scale(allobj)
R.setup_render(sc, "EEVEE", (1280, 720), 48)
for k_, v_ in (("volumetric_end", 90.0 * K * 1.2), ("volumetric_tile_size", "8"), ("volumetric_samples", 64)):
    try:
        setattr(sc.eevee, k_, v_)
    except Exception:
        pass
A.build_world(sc)
atm = bpy.data.collections.new("PREVIEW_ATM"); sc.collection.children.link(atm)
try:
    A.build_eclipse(atm)
    for o in list(atm.objects):
        if o.parent is None:
            o.matrix_world = T.M_ENV @ o.matrix_world
except Exception as e:
    LOG["warnings"].append("eclipse preview: " + repr(e))
A.build_fog_volume(atm, center=(0, 22 * K, 4 * K + DZ), size=(160 * K, 160 * K, 40 * K),
                   density=0.03 / K, z_ref=-4.0 * K + DZ, falloff=5.0 * K)
R.standard_lights(40.0, lava=False, collection=atm)
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=40 * K, fill_type="NGON", location=(0, 4 * K, -6.0 * K + DZ))
fl = bpy.context.active_object; fl.name = "PV_AbyssFloor"; M.assign(fl, "Basalt", moss=0.0)
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=4.6 * K, depth=2.0 * K, location=(0, 0, -1.4 * K + DZ))
dc = bpy.context.active_object; dc.name = "PV_Dais"; M.assign(dc, "AncientStone")
views = {"hero": (T.HERO[0], T.HERO[1], T.HERO[2]),
         "hero_tele": ((0, -30, 9), (15, 200, 25), 50),
         "elevated": ((0, -60 * K, 45 * K), (0, 20 * K, 0), 24),
         "side_close": ((-10 * K, 8 * K, 3 * K), (-14 * K, 35 * K, 4 * K), 35),
         "top": ((0, CY * K, 420 * K), (0, CY * K + 0.01, 0), 30)}
LOG["renders"] = {}
for vn, (loc, tgt, lens) in views.items():
    cam = T.view_cam("CAM_" + vn, loc, tgt, lens)
    p = os.path.join(RDIR, f"far_v{VER:03d}_{vn}.png")
    T.render(p, cam)
    LOG["renders"][vn] = os.path.relpath(p, T.CL)
LOG["seconds"] = round(time.time() - t0, 1)
T.write_json(os.path.join(T.asset_dir(ASSET), f"build_log_v{VER:03d}.json"), LOG)
print("FAR_DONE", json.dumps({k: LOG[k] for k in ("version", "tris_total", "objects", "erosion", "warnings")}, default=str)[:3000])
