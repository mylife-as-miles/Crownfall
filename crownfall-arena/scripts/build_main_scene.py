"""CROWNFALL MAIN SCENE (Claude version = primary, per the user's decision 2026-10-24).

Builds one scene with:
  * every Claude-track asset (latest versions, arrangement.json layout, layout_overrides.json hides),
  * the parts of Codex's v002 scene worth keeping: its CC0 photogrammetry canyon banks
    (Poly Haven Namaqualand Cliff 02) + the photographed fern clusters on them, moved outward so they
    flank the dais instead of cutting through it,
  * the board scaled to a MASSIVE war arena: Crownfall uses 1 world unit = 1 square with soldiers
    0.78-1.12 squares tall, so a 1.8 m footsoldier means a ~2.3 m square -> board ~21.9 m,
  * the environment scaled by ENV_SCALE so the skull is ~half the board width (elevated reference),
  * atmosphere/lights/fog rebuilt at the new scale, vegetation dressing at the new scale,
  * renders of the key views, and a packed .blend: main/Crownfall_Main_vNNN.blend

Usage: python lib/run_blender.py scripts/build_main_scene.py --timeout 3500 -- v001 [views] [board_square_m] [env_scale]
"""
import sys, os, glob, json, math, re, time, shutil
CL = r"C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment"
ROOT = os.path.dirname(os.path.dirname(CL))
sys.path.insert(0, os.path.join(CL, "lib"))
import bpy
from mathutils import Matrix, Vector
import cf_render as R, cf_atmos as A, cf_integrate as I
I.PREFER_READY = True  # v019: a README "READY vNNN" pins the version; newer WIP blends stay out

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VER = argv[0] if argv else "v001"
VIEWS = argv[1].split(",") if len(argv) > 1 and argv[1] not in ("", "all") else \
    ["hero", "hero_low", "elevated", "top", "board_ground", "monuments"]
SQUARE_M = float(argv[2]) if len(argv) > 2 else 2.3          # metres per board square
ENV_K = float(argv[3]) if len(argv) > 3 else 4.6              # environment scale
PROFILE = argv[4] if len(argv) > 4 else "cinematic"            # lighting profile from layout_overrides["looks"]
BOARD_S = SQUARE_M / 0.08                                      # board source square = 0.08 m
BOARD_BOTTOM = -0.054 * BOARD_S                                # board base bottom after scaling
DZ = 0.76 * ENV_K + BOARD_BOTTOM                               # lift env so the dais top meets the board base
M_ENV = Matrix.Translation((0, 0, DZ)) @ Matrix.Scale(ENV_K, 4)
OUT = os.path.join(CL, "renders", "main", VER)
os.makedirs(OUT, exist_ok=True)
LOG = {"version": VER, "square_m": SQUARE_M, "board_scale": BOARD_S, "board_size_m": round(0.76 * BOARD_S, 2),
       "env_scale": ENV_K, "env_dz": round(DZ, 3), "assets": [], "codex_merged": [], "warnings": [], "views": {}}
t0 = time.time()


def envp(x, y, z):
    """old-layout point -> new world point"""
    return M_ENV @ Vector((x, y, z))


R.reset_scene()
sc = bpy.context.scene
sc.name = "Crownfall_Main"
ov = json.load(open(os.path.join(CL, "layout_overrides.json")))
R.setup_render(sc, "EEVEE", tuple(ov.get("resolution", (1600, 900))), ov.get("samples", 64))
for k, v in (("volumetric_end", ov.get("volumetric_end", 90.0 * ENV_K)), ("volumetric_sample_distribution", 0.85), ("volumetric_tile_size", "4"), ("volumetric_samples", 96),
             ("volumetric_light_clamp", 0.0), ("shadow_resolution_scale", 1.0)):
    try:
        setattr(sc.eevee, k, v)
    except Exception:
        pass
main = bpy.data.collections.new("CF_MAIN"); sc.collection.children.link(main)
env = bpy.data.collections.new("CF_10_ENVIRONMENT_CLAUDE"); main.children.link(env)
cdx = bpy.data.collections.new("CF_20_FROM_CODEX_CC0_SCANS"); main.children.link(cdx)
atm = bpy.data.collections.new("CF_30_ATMOSPHERE_LIGHTS"); main.children.link(atm)
brd = bpy.data.collections.new("CF_00_BOARD_MASSIVE"); main.children.link(brd)

# ---------------------------------------------------------------- 1. Claude assets (old layout)
ov = json.load(open(os.path.join(CL, "layout_overrides.json")))
LOG["skipped_assets"] = ov.get("skip_assets", [])
for folder in sorted(glob.glob(os.path.join(CL, "assets", "CFCL_*"))):
    asset = os.path.basename(folder)
    if asset in ("CFCL_Sky_Eclipse", "CFCL_Veg_Kit", "CFCL_Materials", "CFCL_Board_Arena", "CFCL_RitualFloor", "CFCL_PBR", "CFCL_Sky_Shatter", "CFCL_Meshy", "CFCL_KB3D", "CFCL_Pieces") or asset in set(ov.get("skip_assets", [])) or not I.latest_blend(folder):
        continue
    # v007: only finished work enters the main scene (README marked READY), unless force-included
    _rm = os.path.join(folder, "README.md")
    _ready = os.path.exists(_rm) and re.search(r"READY", open(_rm, encoding="utf-8", errors="ignore").read()[:600])         and not re.search(r"NOT READY|IN PROGRESS", open(_rm, encoding="utf-8", errors="ignore").read()[:600])
    if not _ready and asset not in set(ov.get("force_include", [])):
        LOG.setdefault("skipped_not_ready", []).append(asset)
        continue
    # a READY replacement (e.g. CFCL_Ucupaint_Skull) supersedes its original instead of duplicating it
    _repl = {v: k for k, v in ov.get("replaces", {}).items()}
    if asset in _repl:
        _rd = os.path.join(CL, "assets", _repl[asset])
        _rr = os.path.join(_rd, "README.md")
        if I.latest_blend(_rd) and os.path.exists(_rr) and "READY" in open(_rr, encoding="utf-8", errors="ignore").read()[:600]:
            LOG.setdefault("replaced", []).append(f"{asset} -> {_repl[asset]}")
            continue
    try:
        got = I.append_asset(folder, env, 1.0, LOG["warnings"])
        c_ = bpy.data.collections.get(asset)
        LOG["assets"].append({"asset": asset, "blend": c_.get("cfcl_blend") if c_ else None, "placed": len(got)})
    except Exception as e:
        LOG["warnings"].append(f"{asset}: {e}")
HIDE = set(ov.get("objects", {}).keys()) | {"CFCL_Arch_AltarDrum", "CFCL_Arch_AltarDrum_Bronze", "CFCL_Arch_AltarOffering_Wax",
                                            "CFCL_Arch_AltarOffering_Pebbles", "CFCL_Arch_AltarOffering_Bones",
}  # board now sits directly on the dais
for n in HIDE:
    o = bpy.data.objects.get(n)
    if o:
        o.hide_render = o.hide_viewport = True

for _pat, _mul in ov.get("scale_mult_patterns", {}).items():
    _rx = re.compile(_pat)
    for _o in list(bpy.data.objects):
        if _o.parent is None and _rx.search(_o.name) and _o.type == "MESH":
            _o.scale = _o.scale * _mul
bpy.context.view_layer.update()   # v005 bug: appended objects had stale matrix_world -> hand scaled about the origin
for _g in ov.get("group_scale", []):
    _a = bpy.data.objects.get(_g["anchor"])
    if _a:
        _ap = _a.matrix_world.translation.copy()
        _Mg = Matrix.Translation(_ap) @ Matrix.Scale(_g["mult"], 4) @ Matrix.Translation(-_ap)
        for _n in _g["members"]:
            _o = bpy.data.objects.get(_n)
            if _o and _o.parent is None:
                _o.matrix_world = _Mg @ _o.matrix_world
                if _g.get("offset"):
                    _o.location += Vector(_g["offset"])
                if _g.get("rotate_z_deg"):
                    _Rz = Matrix.Translation(_ap) @ Matrix.Rotation(math.radians(_g["rotate_z_deg"]), 4, "Z") @ Matrix.Translation(-_ap)
                    _o.matrix_world = _Rz @ _o.matrix_world
# ---------------------------------------------------------------- 2. Codex CC0 scans
# (now a self-contained Claude asset: assets/CFCL_FromCodex_CC0Banks, loaded by the asset loop above)
LOG["codex_merged"] = [n for n in ("ENV_Canyon10_MainBank_Left", "ENV_Canyon10_MainBank_Right",
                                   "ENV_BankVegetation21_WestNear", "ENV_BankVegetation21_EastNear") if bpy.data.objects.get(n)]

# ---------------------------------------------------------------- 3. eclipse/embers at old layout (scaled below with env)
LOOK = ov.get("looks", {}).get(PROFILE, ov.get("look", {}))
LOG["look_profile"] = PROFILE
A.build_world(sc, palette=LOOK.get("world"))
for _nd in sc.world.node_tree.nodes:
    if _nd.type == "BACKGROUND":
        _nd.inputs["Strength"].default_value = LOOK.get("world_strength", 1.0)
A.build_eclipse(atm)
_ssr = os.path.join(CL, "assets", "CFCL_Sky_Shatter", "README.md")
if os.path.exists(_ssr) and "READY" in open(_ssr, encoding="utf-8", errors="ignore").read()[:600]:
    LOG["sky_clouds_planes"] = "skipped (CFCL_Sky_Shatter READY: its tear replaces the old smoke planes)"
else:
    A.build_sky_clouds(atm)
A.build_light_rig(atm)

# ---------------------------------------------------------------- 4. scale world
board_objs = set()
for o in list(sc.objects):
    if o.parent is not None or o.type == "CAMERA":
        continue
    o.matrix_world = M_ENV @ o.matrix_world
for o in sc.objects:
    if o.type == "LIGHT":
        d = o.data
        if d.type in ("POINT", "SPOT", "AREA"):
            d.energy *= ENV_K * ENV_K
            if d.type == "AREA":
                d.size *= ENV_K
            else:
                d.shadow_soft_size *= ENV_K
        if o.name == "CFCL_Area_BoardFill":
            d.specular_factor = 0.0              # v002 glare at the board centre was a specular reflection
        if "Lava" in o.name:
            d.energy *= 0.22                     # k^2 over-lit the scaled scene orange (main v001)
        if o.name == "CFCL_Spot_SacredShaft":
            d.spot_size = math.radians(48)       # cover the whole massive board, soft edge, no hotspot
            d.spot_blend = 1.0
            d.energy *= 0.35
            d.shadow_soft_size = 3.0
            d.specular_factor = 0.0             # v002: removed the white specular hotspot on the board
# v002: the skull is backlit by the eclipse key -> soft cool fill from the front-left so its face models
_sk = bpy.data.objects.get("CFCL_Hero_Skull")
if _sk:
    _c = _sk.matrix_world.translation
    _fill = bpy.data.lights.new("CF_Area_SkullFill", "AREA"); _fill.energy = 9000.0; _fill.size = 14.0
    _fill.color = (0.78, 0.86, 0.90); _fill.specular_factor = 0.4
    _fo = bpy.data.objects.new("CF_Area_SkullFill", _fill); atm.objects.link(_fo)
    _fo.location = _c + Vector((10.0, -22.0, 9.0))
    _fo.rotation_euler = (_c + Vector((0, 0, 4.0)) - _fo.location).to_track_quat("-Z", "Y").to_euler()
# v006: selective ember-gold rim lights on the skull and hand, from the eclipse side (silhouette separation)
_ecl = bpy.data.objects.get("CFCL_Eclipse_Body")
for _hn in ov.get("rim_targets", []):
    _ho = bpy.data.objects.get(_hn)
    if not (_ho and _ecl):
        continue
    _bbw = [_ho.matrix_world @ Vector(c) for c in _ho.bound_box]
    _ctr = sum(_bbw, Vector()) / 8.0
    _hgt = max(v.z for v in _bbw) - min(v.z for v in _bbw)
    _dir = (_ecl.matrix_world.translation - _ctr); _dir.z = 0; _dir.normalize()
    _rl = bpy.data.lights.new("CF_Area_Rim_" + _hn, "AREA"); _rl.energy = ov.get("rim_energy", 9000.0); _rl.size = _hgt * 0.6
    _rl.color = tuple(ov.get("rim_colors", {}).get(_hn, (1.0, 0.62, 0.30))); _rl.specular_factor = 1.0
    _ro = bpy.data.objects.new("CF_Area_Rim_" + _hn, _rl); atm.objects.link(_ro)
    _ro.location = _ctr + _dir * (_hgt * 1.4) + Vector((0, 0, _hgt * 0.9))
    _ro.rotation_euler = (_ctr - _ro.location).to_track_quat("-Z", "Y").to_euler()
# fog + lava mist rebuilt in new-world metres
A.build_lava_mist(atm, z0=-6.0 * ENV_K + DZ, z1=-0.6 * ENV_K + DZ, extent=60.0 * ENV_K, density=0.12 / ENV_K,
                  center_y=8.0 * ENV_K, noise_scale=0.12 / ENV_K)
A.build_fog_volume(atm, center=(0, 22 * ENV_K, 4 * ENV_K + DZ), size=(160 * ENV_K, 160 * ENV_K, 40 * ENV_K),
                   density=ov.get("fog_density", 0.03) / ENV_K, z_ref=-4.0 * ENV_K + DZ, falloff=5.0 * ENV_K,
                   color=tuple(LOOK.get("fog_color", (0.40, 0.58, 0.56))), anisotropy=LOOK.get("fog_anisotropy", 0.3))
for _n, _mul in LOOK.get("light_mult", {}).items():
    _o = bpy.data.objects.get(_n)
    if _o and _o.type == "LIGHT":
        _o.data.energy *= _mul
for _n, _col in LOOK.get("light_color", {}).items():
    _o = bpy.data.objects.get(_n)
    if _o and _o.type == "LIGHT":
        _o.data.color = _col
sc.view_settings.exposure = LOOK.get("exposure", 0.0)
for _i, _mb in enumerate(LOOK.get("mist_banks", [])):
    # localized volumetric mist (world metres): separates mid-ground ruins from the softened far landmasses
    A.build_fog_volume(atm, center=tuple(_mb["center"]), size=tuple(_mb["size"]), density=_mb["density"],
                       z_ref=_mb.get("z_ref", 0.0), falloff=_mb.get("falloff", 25.0),
                       color=tuple(_mb.get("color", (0.45, 0.52, 0.62))), anisotropy=_mb.get("anisotropy", 0.5),
                       name=f"CFCL_MistBank_{_i}", emission=_mb.get("emission"))
if LOOK.get("bloom"):
    try:
        sc.render.use_compositing = True
        _ng = bpy.data.node_groups.new("CF_Compositor", "CompositorNodeTree")
        if hasattr(sc, "compositing_node_group"):
            sc.compositing_node_group = _ng
        _rl = _ng.nodes.new("CompositorNodeRLayers")
        _gl = _ng.nodes.new("CompositorNodeGlare")
        for _k, _v in (("glare_type", "BLOOM"), ("quality", "HIGH")):
            try: setattr(_gl, _k, _v)
            except Exception: pass
        for _k, _v in (("Type", "Bloom"), ("Threshold", LOOK["bloom"].get("threshold", 1.0)), ("Strength", LOOK["bloom"].get("strength", 0.35)),
                       ("Size", LOOK["bloom"].get("size", 0.5)), ("Saturation", LOOK["bloom"].get("saturation", 0.7))):
            _sk = _gl.inputs.get(_k)
            if _sk is not None:
                try: _sk.default_value = _v
                except Exception: pass
        _out = None
        for _t in ("NodeGroupOutput", "CompositorNodeComposite"):
            try:
                _out = _ng.nodes.new(_t); break
            except Exception:
                continue
        if _out.bl_idname == "NodeGroupOutput":
            _ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        _ng.links.new(_rl.outputs["Image"], _gl.inputs[0])
        _last = _gl.outputs[0]
        if LOOK.get("vignette"):
            # E33-style vignette (Blender 5.2 compositor: shared ShaderNodeMapRange / ShaderNodeMix, socket-based mask)
            try:
                _em = _ng.nodes.new("CompositorNodeEllipseMask")
                _em.inputs["Value"].default_value = 1.0
                try: _em.inputs["Size"].default_value = (1.05, 0.95)
                except Exception: pass
                _bl = _ng.nodes.new("CompositorNodeBlur")
                try: _bl.inputs["Size"].default_value = (420.0, 420.0)
                except Exception: pass
                _ng.links.new(_em.outputs[0], _bl.inputs["Image"])
                _rng = _ng.nodes.new("ShaderNodeMapRange")
                _rng.inputs["From Min"].default_value = 0.0; _rng.inputs["From Max"].default_value = 1.0
                _rng.inputs["To Min"].default_value = 1.0 - LOOK["vignette"]; _rng.inputs["To Max"].default_value = 1.0
                _ng.links.new(_bl.outputs[0], _rng.inputs["Value"])
                _mm = _ng.nodes.new("ShaderNodeMix"); _mm.data_type = "RGBA"; _mm.blend_type = "MULTIPLY"
                _mm.inputs[0].default_value = 1.0
                _ng.links.new(_last, _mm.inputs[6]); _ng.links.new(_rng.outputs[0], _mm.inputs[7])
                _last = _mm.outputs[2]
                LOG["vignette"] = True
            except Exception as e:
                LOG["warnings"].append("vignette: " + repr(e))
        _ng.links.new(_last, _out.inputs[0])
        LOG["bloom"] = True
    except Exception as e:
        LOG["warnings"].append("bloom: " + repr(e))
for _prefix, _vm in LOOK.get("mat_value_mult", {}).items():
    # locked palette: e.g. CFCL_Basalt -> obsidian (multiply base colour, keep texture variation)
    for _m in bpy.data.materials:
        if not (_m.name.startswith(_prefix) and _m.node_tree):
            continue
        for _nd in list(_m.node_tree.nodes):
            if _nd.type == "BSDF_PRINCIPLED":
                _bc = _nd.inputs["Base Color"]
                _mx = _m.node_tree.nodes.new("ShaderNodeMix"); _mx.data_type = "RGBA"; _mx.blend_type = "MULTIPLY"
                _mx.inputs[0].default_value = 1.0; _mx.inputs[7].default_value = (_vm, _vm, _vm * 1.04, 1.0)
                if _bc.is_linked:
                    _src = _bc.links[0].from_socket; _m.node_tree.links.remove(_bc.links[0]); _m.node_tree.links.new(_src, _mx.inputs[6])
                else:
                    _mx.inputs[6].default_value = _bc.default_value
                _m.node_tree.links.new(_mx.outputs[2], _bc)
        LOG.setdefault("mat_value_mult", []).append(_m.name)
# v010 light rig per critic F1: eclipse is the key (backlight, low elevation), cool fill from camera side, soft top light on the board
_rig = LOOK.get("rig", {})
if _rig:
    _ecl = bpy.data.objects.get("CFCL_Eclipse_Body")
    _key = bpy.data.objects.get("CFCL_Sun_EclipseKey")
    if _ecl and _key:
        _az = Vector((_ecl.matrix_world.translation.x, _ecl.matrix_world.translation.y, 0)).normalized()
        _el = math.radians(_rig.get("key_elev_deg", 15))
        _src = Vector((_az.x * math.cos(_el), _az.y * math.cos(_el), math.sin(_el)))
        _key.rotation_euler = (-_src).to_track_quat("-Z", "Y").to_euler()
        _key.data.energy = _rig.get("key_energy", _key.data.energy)
        _key.data.color = _rig.get("key_color", (1.0, 0.69, 0.29))
    _fill = bpy.data.objects.get("CFCL_Sun_CoolFill")
    if _fill and _key:
        _fe = math.radians(_rig.get("fill_elev_deg", 30))
        _fs = Vector((0.25, -math.cos(_fe), math.sin(_fe))).normalized()
        _fill.rotation_euler = (-_fs).to_track_quat("-Z", "Y").to_euler()
        _fill.data.energy = _key.data.energy * _rig.get("fill_ratio", 0.22)
        _fill.data.color = _rig.get("fill_color", (0.55, 0.65, 0.85))
    for _n in _rig.get("remove_lights", []):
        _o = bpy.data.objects.get(_n)
        if _o:
            _o.hide_render = _o.hide_viewport = True
    if _rig.get("skull_fill"):
        _sk = bpy.data.objects.get("CFCL_Hero_Skull")
        if _sk:
            _c = sum([_sk.matrix_world @ Vector(c_) for c_ in _sk.bound_box], Vector()) / 8.0
            _sf = bpy.data.lights.new("CF_Area_SkullCoolFill", "AREA"); _sf.energy = _rig["skull_fill"]; _sf.size = 16.0
            _sf.color = tuple(_rig.get("skull_fill_color", (0.62, 0.72, 0.95))); _sf.specular_factor = 0.3
            _so = bpy.data.objects.new("CF_Area_SkullCoolFill", _sf); atm.objects.link(_so)
            _so.location = _c + Vector(_rig.get("skull_fill_offset", (6.0, -26.0, 10.0)))
            _so.rotation_euler = (_c - _so.location).to_track_quat("-Z", "Y").to_euler()
    if _rig.get("board_top_light"):
        # v014 (critic R3): a SPOT confined to the 8x8 + 1 square so the ring/fringe stay darker than the playfield
        _bl = bpy.data.lights.new("CF_Spot_BoardTop", "SPOT"); _bl.energy = _rig["board_top_light"]
        _bl.spot_size = math.radians(_rig.get("board_spot_deg", 50.5)); _bl.spot_blend = 0.12; _bl.shadow_soft_size = 2.0
        _bl.color = (0.92, 0.93, 0.95); _bl.specular_factor = 0.0
        _bo = bpy.data.objects.new("CF_Spot_BoardTop", _bl); atm.objects.link(_bo); _bo.location = (0, 0, 28.0)
    LOG["rig"] = _rig
for _pat, _spec in LOOK.get("mat_overrides", {}).items():
    for _m in bpy.data.materials:
        if re.search(_pat, _m.name) and _m.node_tree:
            for _nd in _m.node_tree.nodes:
                if _nd.type == "BSDF_PRINCIPLED":
                    for _k, _sock in (("base", "Base Color"), ("rough", "Roughness"), ("metal", "Metallic"), ("spec", "Specular IOR Level"), ("emit", "Emission Strength")):
                        if _k in _spec:
                            _sk = _nd.inputs[_sock]
                            for _l in list(_sk.links):
                                _m.node_tree.links.remove(_l)
                            _sk.default_value = (*_spec[_k], 1.0) if _k == "base" else _spec[_k]
            LOG.setdefault("mat_overrides", []).append(_m.name)
for _pat in ov.get("hide_patterns", []):
    _rx = re.compile(_pat)
    for _o in sc.objects:
        if _rx.search(_o.name) and not _o.hide_render:
            _o.hide_render = _o.hide_viewport = True
            LOG.setdefault("hidden_by_pattern", []).append(_o.name)
for _n in LOOK.get("hide_lights", []):
    _o = bpy.data.objects.get(_n)
    if _o:
        _o.hide_render = _o.hide_viewport = True   # v006: the board spot left a hot white core at the board centre
_lm = bpy.data.materials.get("CFCL_Lava")
if _lm and LOOK.get("lava_emission_mult"):
    for _nd in _lm.node_tree.nodes:
        if _nd.type == "BSDF_PRINCIPLED" and not _nd.inputs["Emission Strength"].is_linked:
            _nd.inputs["Emission Strength"].default_value *= LOOK["lava_emission_mult"]
        if _nd.type == "MATH" and _nd.operation == "MULTIPLY" and any(l.to_socket.name == "Emission Strength" for l in _nd.outputs[0].links):
            _nd.inputs[1].default_value *= LOOK["lava_emission_mult"]

# ---------------------------------------------------------------- 5. massive board
arena_dir = os.path.join(CL, "assets", "CFCL_Board_Arena")
arena_blend = I.latest_blend(arena_dir)
arena_ready = arena_blend and os.path.exists(os.path.join(arena_dir, "README.md")) and     "READY" in open(os.path.join(arena_dir, "README.md"), encoding="utf-8", errors="ignore").read()
if arena_ready and not ov.get("force_original_board", False):
    with bpy.data.libraries.load(arena_blend, link=False) as (src, dst):
        dst.objects = list(src.objects)
    for o in dst.objects:
        if o is not None and o.type in ("MESH", "CURVE", "EMPTY"):
            brd.objects.link(o)
    LOG["board"] = {"type": "CFCL_Board_Arena (monumental, world metres)", "blend": os.path.basename(arena_blend)}
else:
    bcol = R.append_board()
    for o in list(bcol.all_objects):
        for c in list(o.users_collection):
            c.objects.unlink(o)
        brd.objects.link(o)
        if o.parent is None:
            o.matrix_world = Matrix.Scale(BOARD_S, 4) @ o.matrix_world
    for c in list(bcol.children_recursive):
        bpy.data.collections.remove(c)
    bpy.data.collections.remove(bcol)
    LOG["board"] = {"type": "original Crownfall_Board_v001 scaled", "scale": BOARD_S}

def _snap_to_ground(ob, sink, skip=r"Fog|Mist|Volume|SkyShatter|Eclipse|Meshy|KB3D|Piece|Veg_|Cloud|Ember|Smoke|Stream|Arcade|SkullFlank_GothicPortal|ToolIvy_Portal"):
    """drop a world asset onto whatever solid geometry is below its origin (ignores sky, fx, volumes, plants)."""
    dg = bpy.context.evaluated_depsgraph_get()
    org = Vector((ob.location.x, ob.location.y, ob.location.z + 80.0))
    for _ in range(12):
        hit, loc, nrm, idx, hob, mtx = sc.ray_cast(dg, org, Vector((0, 0, -1)), distance=400.0)
        if not hit:
            return None
        if re.search(skip, hob.name) or hob == ob:
            org = loc - Vector((0, 0, 0.05))
            continue
        ob.location.z = loc.z - sink * ob.scale.z
        return hob.name, round(loc.z, 2)
    return None


for _wa in ("CFCL_RitualFloor", "CFCL_Sky_Shatter", "CFCL_Meshy", "CFCL_KB3D", "CFCL_Pieces"):
    _wd = os.path.join(CL, "assets", _wa)
    _wb = I.latest_blend(_wd)
    _rd = os.path.join(_wd, "README.md")
    if _wb and os.path.exists(_rd) and "READY" in open(_rd, encoding="utf-8", errors="ignore").read():
        try:
            _got = I.append_asset(_wd, brd, 1.0, LOG["warnings"])
            LOG.setdefault("world_assets", []).append({"asset": _wa, "placed": len(_got)})
            # v019: arrangement placements flagged "snap" sit on the ground
            _ap = os.path.join(_wd, "arrangement.json")
            _arr = json.load(open(_ap)) if os.path.exists(_ap) else {}
            bpy.context.view_layer.update()
            for _pl in _arr.get("placements", []):
                _ob = bpy.data.objects.get(_pl.get("name", ""))
                if _pl.get("snap") and _ob is not None:
                    LOG.setdefault("snapped", {})[_ob.name] = _snap_to_ground(_ob, _pl.get("sink", 0.05))
        except Exception as e:
            LOG["warnings"].append(f"{_wa}: {e}")
# v004: polished tiles mirrored the bright corona into a white hotspot at the board centre -> soften tile speculars
for _m in bpy.data.materials:
    if "BoardArena" in _m.name and _m.node_tree:
        for _nd in _m.node_tree.nodes:
            if _nd.type == "BSDF_PRINCIPLED":
                _sp = _nd.inputs.get("Specular IOR Level")
                if _sp is not None and not _sp.is_linked:
                    _sp.default_value = min(_sp.default_value, 0.22)
                _ro = _nd.inputs.get("Roughness")
                if _ro is not None and not _ro.is_linked and "Bronze" not in _m.name:
                    _ro.default_value = max(_ro.default_value, 0.62)   # user kit README: tiles 0.55-0.85, no hotspot
        LOG.setdefault("board_mats_softened", []).append(_m.name)

# ======================= v005 lighting & material pass (user-locked palette: obsidian / ancient stone / crimson / ember gold)
def _proj(cam, p):
    loc, tgt, lens = cam[:3]
    loc = Vector(loc); f = (Vector(tgt) - loc).normalized(); r = f.cross(Vector((0, 0, 1))).normalized(); u = r.cross(f)
    v = Vector(p) - loc; z = v.dot(f)
    if z <= 0.1:
        return None
    return (0.5 + 0.5 * (v.dot(r) / z) * lens / 18.0, 0.5 - 0.5 * (v.dot(u) / z) * lens / 10.125, z)

def _rect(cam, pts):
    q = [_proj(cam, p) for p in pts]
    q = [x for x in q if x]
    if not q:
        return None
    return (min(x[0] for x in q), min(x[1] for x in q), max(x[0] for x in q), max(x[1] for x in q), min(x[2] for x in q))

KEY_CAMS = {"hero": ((0, -30.0, 9.0), (0, 20, 5.5), 24), "god": ((0, -26.0, 30.0), (0, 2, -2), 26),
            "high34": ((-45.0, -55.0, 40.0), (0, 15, 0), 30), "worm": ((6.0, -14.0, 1.2), (0, 30, 14), 18),
            "shoulder": ((-9.5, -11.0, 2.4), (2, 25, 6), 24)}
_hb = 0.38 * BOARD_S
_board_pts = [(x, y, z) for x in (-_hb, _hb) for y in (-_hb, _hb) for z in (0.0, 1.5)]
_moved, _hidden = [], []
bpy.context.view_layer.update()
for _o in [o for o in sc.objects if o.name.startswith("CFCL_Rib_") and o.parent is None and not o.hide_render]:
    for _it in range(4):
        bpy.context.view_layer.update()
        _bad = False
        _bb = [_o.matrix_world @ Vector(c) for c in _o.bound_box]
        for _cn, _cam in KEY_CAMS.items():
            _br = _rect(_cam, _board_pts); _rr = _rect(_cam, _bb)
            if not _br or not _rr:
                continue
            _ov = not (_rr[2] < _br[0] - 0.02 or _rr[0] > _br[2] + 0.02 or _rr[3] < _br[1] - 0.02 or _rr[1] > _br[3] + 0.02)
            _board_far = max(x[2] for x in [_proj(_cam, p) for p in _board_pts] if x)
            if _ov and _rr[4] < _board_far:
                _bad = True
                break
        if not _bad:
            break
        _xy = Vector((_o.location.x, _o.location.y, 0))
        if _xy.length < 1e-3:
            break
        _o.location += _xy.normalized() * (_xy.length * 0.35)
        bpy.context.view_layer.update()
        if _it == 0:
            _moved.append(_o.name)
    else:
        _o.hide_render = _o.hide_viewport = True
        _hidden.append(_o.name)
LOG["rib_keep_clear"] = {"moved": [n for n in _moved if n not in _hidden], "hidden": _hidden}
for _o in sc.objects:   # ivy grown on a rib that was hidden must not float in the sky (critic R8)
    if _o.name.startswith("CFCL_ToolIvy_") and _o.name[len("CFCL_ToolIvy_"):].startswith("Rib_"):
        _rib = bpy.data.objects.get("CFCL_" + _o.name[len("CFCL_ToolIvy_"):])
        if _rib is None or _rib.hide_render:
            _o.hide_render = _o.hide_viewport = True

def _insert_mul(nt, to_socket, mask_socket):
    """multiply whatever feeds to_socket by mask_socket (or its default value)."""
    m = nt.nodes.new("ShaderNodeMath"); m.operation = "MULTIPLY"
    if to_socket.is_linked:
        src = to_socket.links[0].from_socket
        nt.links.remove(to_socket.links[0])
        nt.links.new(src, m.inputs[0])
    else:
        m.inputs[0].default_value = to_socket.default_value
    nt.links.new(mask_socket, m.inputs[1]); nt.links.new(m.outputs[0], to_socket)

def _radial_mask(nt, centers, floor):
    """max over centers of a smooth falloff (1 inside r0 -> floor beyond r1), using world XY distance."""
    geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Position"], sep.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ"); nt.links.new(sep.outputs["X"], comb.inputs["X"]); nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    acc = None
    for (cx, cy, r0, r1) in centers:
        d = nt.nodes.new("ShaderNodeVectorMath"); d.operation = "DISTANCE"; nt.links.new(comb.outputs[0], d.inputs[0]); d.inputs[1].default_value = (cx, cy, 0)
        mr = nt.nodes.new("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = r0; mr.inputs["From Max"].default_value = r1
        mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = floor; mr.clamp = True
        try: mr.interpolation_type = "SMOOTHSTEP"
        except Exception: pass
        nt.links.new(d.outputs["Value"], mr.inputs["Value"])
        if acc is None:
            acc = mr.outputs["Result"]
        else:
            mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MAXIMUM"; nt.links.new(acc, mx.inputs[0]); nt.links.new(mr.outputs["Result"], mx.inputs[1]); acc = mx.outputs[0]
    return acc

# lava glow concentrated around the important forms (board, skull, hand); dark crust elsewhere
_foci = [(0.0, 0.0, 24.0, 62.0)]
for _hn, _r in (("CFCL_Hero_Skull", (10.0, 32.0)), ("CFCL_Hero_Hand", (10.0, 32.0))):
    _ho = bpy.data.objects.get(_hn)
    if _ho:
        _foci.append((_ho.matrix_world.translation.x, _ho.matrix_world.translation.y, *_r))
_lava_done = []
for _m in bpy.data.materials:
    if not (_m.name.startswith("CFCL_Lava") and not _m.name.startswith("CFCL_LavaMist")) or not _m.node_tree:
        continue
    _nt = _m.node_tree
    for _nd in list(_nt.nodes):
        if _nd.type == "BSDF_PRINCIPLED":
            _insert_mul(_nt, _nd.inputs["Emission Strength"], _radial_mask(_nt, _foci, LOOK.get("lava_far_floor", 0.12)))
            _lava_done.append(_m.name)
LOG["lava_focus"] = _lava_done

# atmospheric layering: fog thin around the arena, thickening with distance (crisp near silhouettes, stepped depth)
_fm = bpy.data.materials.get("CFCL_Fog")
if _fm and _fm.node_tree:
    _nt = _fm.node_tree
    for _nd in list(_nt.nodes):
        if _nd.type == "PRINCIPLED_VOLUME":
            _g = _nt.nodes.new("ShaderNodeNewGeometry"); _sp = _nt.nodes.new("ShaderNodeSeparateXYZ"); _nt.links.new(_g.outputs["Position"], _sp.inputs[0])
            _cb = _nt.nodes.new("ShaderNodeCombineXYZ"); _nt.links.new(_sp.outputs["X"], _cb.inputs["X"]); _nt.links.new(_sp.outputs["Y"], _cb.inputs["Y"])
            _ln = _nt.nodes.new("ShaderNodeVectorMath"); _ln.operation = "LENGTH"; _nt.links.new(_cb.outputs[0], _ln.inputs[0])
            _mr = _nt.nodes.new("ShaderNodeMapRange"); _mr.clamp = True
            _mr.inputs["From Min"].default_value = LOOK.get("fog_clear_r", 30.0); _mr.inputs["From Max"].default_value = LOOK.get("fog_full_r", 170.0)
            _mr.inputs["To Min"].default_value = LOOK.get("fog_near_mult", 0.15); _mr.inputs["To Max"].default_value = 1.0
            try: _mr.interpolation_type = "SMOOTHSTEP"
            except Exception: pass
            _nt.links.new(_ln.outputs["Value"], _mr.inputs["Value"])
            _insert_mul(_nt, _nd.inputs["Density"], _mr.outputs["Result"])
LOG["fog_layering"] = bool(_fm)

# v011: material overrides + hide patterns must also run after the world-metre assets (board, ritual floor) exist
for _pat, _spec in LOOK.get("mat_overrides", {}).items():
    for _m in bpy.data.materials:
        if re.search(_pat, _m.name) and _m.node_tree and _m.name not in LOG.get("mat_overrides", []):
            for _nd in _m.node_tree.nodes:
                if _nd.type == "BSDF_PRINCIPLED":
                    for _k, _sock in (("base", "Base Color"), ("rough", "Roughness"), ("metal", "Metallic"), ("spec", "Specular IOR Level"), ("emit", "Emission Strength")):
                        if _k in _spec:
                            _sk = _nd.inputs[_sock]
                            for _l in list(_sk.links):
                                _m.node_tree.links.remove(_l)
                            _sk.default_value = (*_spec[_k], 1.0) if _k == "base" else _spec[_k]
            LOG.setdefault("mat_overrides", []).append(_m.name)
for _pat in ov.get("hide_patterns", []):
    _rx = re.compile(_pat)
    for _o in sc.objects:
        if _rx.search(_o.name) and not _o.hide_render:
            _o.hide_render = _o.hide_viewport = True
            LOG.setdefault("hidden_by_pattern", []).append(_o.name)
# v017: the sky shell is "sky" - it must not shadow the world (the eclipse key comes from behind it)
for _o in sc.objects:
    if _o.name.startswith(("CFCL_SkyShatter_Dome", "CFCL_SkyShatter_Beyond", "CFCL_SkyShatter_Cloud")) and _o.type == "MESH":
        _o.visible_shadow = False
# CC0 PBR library (Poly Haven + ambientCG) mapped onto terrain/ribs/ruins/dais after final transforms
if ov.get("use_pbr", True):
    try:
        import cf_pbr as P
        bpy.context.view_layer.update()
        LOG["pbr"] = {k: (v if isinstance(v, (int, float, str)) else str(v)[:400]) for k, v in P.apply_mapping(list(sc.objects), optional=tuple(ov.get("pbr_optional", []))).items()}
    except Exception as e:
        LOG["warnings"].append("pbr: " + repr(e))
# ---------------------------------------------------------------- 6. vegetation at the new scale
try:
    import cf_vegetation as V
    kit = I.latest_blend(os.path.join(CL, "assets", "CFCL_Veg_Kit"))
    half = 0.38 * BOARD_S
    ex = V.make_board_exclude(half=half, margin=0.4, r_clear=half * 1.02, z_min=BOARD_BOTTOM - 0.3, corridor=False)
    vroot = bpy.data.collections.new("CF_40_VEGETATION"); main.children.link(vroot)
    LOG["vegetation"] = {}
    for spec in ov.get("dress", []):
        o = bpy.data.objects.get(spec["object"])
        if not o or o.hide_render:
            continue
        kw = dict(spec.get("kw", {}))
        if "families" in kw:
            kw["families"] = tuple(kw["families"])
        t1 = time.time()
        try:
            r = V.dress(o, kit, seed=spec.get("seed", 1), density=spec.get("density", 1.0),
                        scale=spec.get("scale", 1.0) * ENV_K, exclude_fn=ex, collection=None, **kw)
            c_ = bpy.data.collections.get(r.get("collection", ""))
            if c_ and c_.name in [ch.name for ch in sc.collection.children]:
                sc.collection.children.unlink(c_); vroot.children.link(c_)
            LOG["vegetation"][spec["object"]] = {"instances": r.get("instance_count"), "gap_m": r.get("max_contact_gap_m"),
                                                 "s": round(time.time() - t1, 1)}
        except Exception as e:
            LOG["warnings"].append(f"dress {spec['object']}: {e}")
except Exception as e:
    LOG["warnings"].append("vegetation: " + repr(e))

# ---------------------------------------------------------------- 6a. v022 look fixes (lava pools + uplight, sky grade)
if ov.get("lookfix"):
    import cf_lookfix as LF
    _lfc = bpy.data.collections.new("CF_35_LOOKFIX"); main.children.link(_lfc)
    LOG["lookfix"] = LF.apply(sc, ov["lookfix"], _lfc, {})

# ---------------------------------------------------------------- 6b. wear / roughness storytelling pass (v019)
if ov.get("wear", {}).get("enable", False):
    import cf_wear as W
    LOG["wear"] = W.apply(sc, ov["wear"], {})

# ---------------------------------------------------------------- 7. stats + save (packed) BEFORE renders
mesh_objs = [o for o in sc.objects if o.type == "MESH" and not o.hide_render]
try:
    LOG["triangles_rendered"] = R.tri_count(mesh_objs)
except Exception as e:
    LOG["warnings"].append("tris: " + str(e))
LOG["objects_rendered"] = len(mesh_objs)
os.makedirs(os.path.join(CL, "main"), exist_ok=True)
out_blend = os.path.join(CL, "main", f"Crownfall_Main_{VER}.blend")
try:
    bpy.ops.file.pack_all()
except Exception as e:
    LOG["warnings"].append("pack_all: " + str(e))
bpy.ops.wm.save_as_mainfile(filepath=out_blend, compress=True)
try:
    os.remove(os.path.join(CL, "preview", "_codex_merge_src.blend"))
except OSError:
    pass
# ---------------------------------------------------------------- 8. cameras + renders (re-save afterwards so cameras are stored)
CAMS = {
    "hero":         ((0, -30.0, 9.0), (0, 20, 5.5), 24),      # reference-01-like frontal: board foreground, monuments behind
    "hero_low":     ((0, -16.5, 3.4), (0, 30, 9.0), 22),      # low over the near rank
    "elevated":     ((0, -34.0, 40.0), (0, 6, -2), 24),       # reference-02-like
    "top":          ((0, 15, 230), (0, 15.0001, 0), 30),
    "board_ground": ((3.0, -9.0, 1.8), (0, 8, 1.2), 24),      # a footsoldier's eye on the board
    "monuments":    ((0, -8.0, 8.0), (0, 45, 16), 28),
    # E33-style dynamic angles (research/E33_RITUAL_FLOOR_DIRECTION.md)
    "god":          ((0, -26.0, 30.0), (0, 2, -2), 26),     # GAMEPLAY: the godlike player looks down; board fills the frame
    # the user's lookdev-kit acceptance cameras (Crownfall_Kings_Gambit_Blender_Lookdev.py create_shots, s=21.85, from -Y)
    "kg_hero_wide":   ((3.933, -33.868, 17.043), (0, 11.362, 5.244), 28),
    "kg_duel_ground": ((0, -17.262, 3.715), (0, 6.118, 2.404), 36),
    "kg_map_topdown": ((0, -1.311, 48.07), (0, 0, 0.0001), 45),
    "worm":         ((6.0, -14.0, 1.2), (0, 30, 14), 18),
    "shoulder":     ((-9.5, -11.0, 2.4), (2, 25, 6), 24, 5.0),
    "axial":        ((0, -45.0, 14.0), (0, 40, 12), 30),
    "high34":       ((-45.0, -55.0, 40.0), (0, 15, 0), 30),
}
for v in VIEWS:
    if v not in CAMS or v == "none":
        continue
    loc, tgt, lens = CAMS[v][:3]
    cam = R.camera("CF_CAM_" + v, loc, tgt, lens)
    if len(CAMS[v]) > 3:
        cam.rotation_euler.rotate_axis("Z", math.radians(CAMS[v][3]))  # dutch roll
    cam.data.clip_end = 4000
    t1 = time.time()
    try:
        R.render_to(os.path.join(OUT, f"main_{VER}_{v}.png"), cam)
        LOG["views"][v] = {"camera": [loc, tgt, lens], "s": round(time.time() - t1, 1)}
    except Exception as e:
        LOG["warnings"].append(f"render {v}: {e}")
sc.camera = bpy.data.objects.get("CF_CAM_hero") or sc.camera

bpy.ops.wm.save_as_mainfile(filepath=out_blend, compress=True)
LOG["blend"] = out_blend
LOG["seconds_total"] = round(time.time() - t0, 1)
R.write_json(os.path.join(OUT, f"main_{VER}_log.json"), LOG)
print("MAIN_DONE", json.dumps({k: LOG[k] for k in ("board_size_m", "env_scale", "env_dz", "codex_merged", "warnings")}, indent=1))
