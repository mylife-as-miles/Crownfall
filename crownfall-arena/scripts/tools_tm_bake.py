"""TERRAIN MIXER (primary generator for CFCL_Tools_FarLandscape) - headless setup + bake.

Drives Terrain Mixer exactly through its own operators:
  1. bpy.ops.object.replace_with_terrain()          -> appends TM's 'TerrainMixer' setup (shader terrain, cameras)
  2. configure the terrain via TM's own controls: the custom properties on Terrain_2000x2000 (read by
     Attribute nodes in TM's 'Terrain' material) + the exposed inputs of its node groups (Canyonizer, Valleys...)
  3. bake camera: set tm_bake_resolution_x/y + tm_bake_samples on OrthoCamera4Baking, then
     bpy.ops.terrainmixer.toggle_baking_camera()   -> scene camera = ortho cam, Cycles, bake res/samples
  4. make TM's 'Height Output' node the active material output, render (TM's render_with_baking_settings
     uses render('INVOKE_DEFAULT') which needs a window; headless we call the same render with
     bpy.ops.render.render(write_still=True)) to a float EXR  -> heightmap
  5. colour: TM's 'Material Output' active, Cycles bake DIFFUSE/COLOR onto a UV image of the TM plane
     (displacement off, subdivision lowered) -> albedo image.

Usage: python lib/run_blender.py scripts/tools_tm_bake.py --timeout 1800 -- <tag> <res> <samples> <variants comma|all>
Outputs: assets/CFCL_Tools_FarLandscape/tm_bake/<tag>_<variant>_height.exr (+ _preview.png, _color.png, json)
"""
import sys, os, json, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
import tools_common as T

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAG = argv[0] if argv else "probe"
RES = int(argv[1]) if len(argv) > 1 else 512
SAMPLES = int(argv[2]) if len(argv) > 2 else 8
VARS = argv[3].split(",") if len(argv) > 3 and argv[3] != "all" else ["default", "canyon", "mix", "scatter"]
COLOR = (argv[4] == "color") if len(argv) > 4 else False
OUT = os.path.join(T.asset_dir("CFCL_Tools_FarLandscape"), "tm_bake")
os.makedirs(OUT, exist_ok=True)
LOG = {"tag": TAG, "res": RES, "samples": SAMPLES, "variants": {}, "notes": []}

bpy.ops.wm.read_factory_settings(use_empty=True)
T.enable("terrainmixer")
sc = bpy.context.scene
bpy.ops.object.select_all(action="DESELECT") if bpy.ops.object.select_all.poll() else None
t0 = time.time()
r = bpy.ops.object.replace_with_terrain()
LOG["replace_with_terrain"] = str(r)
terrain = next(o for o in bpy.data.objects if o.name.startswith("Terrain_2000x2000"))
bake_cam = next(o for o in bpy.data.objects if o.name.startswith("OrthoCamera4Baking"))
mat = terrain.material_slots[0].material
nt = mat.node_tree
LOG["terrain_mods"] = [(m.name, m.type) for m in terrain.modifiers]
for m in terrain.modifiers:
    if m.type == "SIMPLE_DEFORM":
        LOG["simple_deform"] = {"method": m.deform_method, "angle": m.angle, "factor": getattr(m, "factor", None)}
        m.show_render = m.show_viewport = False          # keep the bake plane flat (ortho top view)
    if m.type == "SUBSURF":
        m.levels = 2
        m.render_levels = 3
# dump TM's input groups so the README can document what each switch picks
def group_images(gname):
    g = bpy.data.node_groups.get(gname)
    if not g:
        return None
    return [n.image.name for n in g.nodes if n.bl_idname == "ShaderNodeTexImage" and n.image]
LOG["input_groups"] = {n.node_tree.name: group_images(n.node_tree.name) for n in nt.nodes
                       if n.bl_idname == "ShaderNodeGroup" and n.node_tree and n.node_tree.name.startswith("INPUT")}
# hide everything but the terrain from render
for o in bpy.data.objects:
    if o is not terrain and o.type in ("MESH", "CURVE", "FONT"):
        o.hide_render = True
mat.displacement_method = "BUMP"   # flat bake plane; height is emitted, not displaced

DEFAULT_PROPS = {k: terrain[k] for k in terrain.keys() if ":" in k}
def nin(name, sock, val):
    n = nt.nodes.get(name)
    if n is None:
        LOG["notes"].append(f"missing node {name}")
        return
    try:
        n.inputs[sock].default_value = val
    except Exception as e:
        LOG["notes"].append(f"{name}.{sock}: {e}")

CANYON = "Group.025"      # CanyonizerMaster
VALLEYS = "Valleys"
SCATTER = "Group.027"     # ScatterMaster (driven by object props 'ScatterMaster: *')
MIXER = "TerrainMixer"    # Mix Inputs


def configure(var):
    for k, v in DEFAULT_PROPS.items():
        terrain[k] = v
    for s in ("Input 1 Influence", "Input 2 Influence", "Input 3 Influence", "Input 4 Influence"):
        nin(CANYON, s, 0.0)
    if var in ("canyon", "mix", "abyss", "abyss2"):
        for s in ("Input 1 Influence", "Input 2 Influence", "Input 3 Influence", "Input 4 Influence"):
            nin(CANYON, s, 1.0)
        nin(CANYON, "Amount", 2.6)
        nin(CANYON, "Strength", 0.8)
    if var in ("mix", "abyss", "abyss2"):
        terrain["INPUT1: SWITCH1"] = 1.0
        terrain["INPUT2: SWITCH2"] = 2.0
        terrain["INPUT3: SWITCH3"] = 1.0
        terrain["INPUT4: SWITCH4"] = 2.0
        terrain["A: HMix_12"] = 0.6
        terrain["C: HMix_12_34"] = 0.4
    if var == "scatter":
        terrain["ScatterMaster: Activate"] = 1.0
        terrain["ScatterMaster: Scatter"] = 6.0
    if var in ("abyss", "abyss2"):
        # steeper, ridgier: power the inputs (gamma) so peaks sharpen and floors widen
        for i in (1, 2, 3, 4):
            terrain[f"Input{i}: Power{i}"] = 1.6
        nin(VALLEYS, "Scale", 1.8)
    if var == "abyss2":
        terrain["INPUT1: SWITCH1"] = 3.0
        terrain["INPUT2: SWITCH2"] = 0.0
        terrain["ScatterMaster: Activate"] = 1.0
    # colour: rock-only, dark, low saturation (TM's own Snow / Grass-Sand / Rock controls)
    rockonly = var in ("abyss", "abyss2", "mix", "canyon")
    nin("Group.030", "Snow/No", 0.0 if rockonly else 1.0)
    nin("Group.030", "Snow Cover", 0.0)
    nin("Group.013", "Less/More", -1.0 if rockonly else 0.0)
    nin("Group.009", "Value", 0.75 if rockonly else 1.4253)
    nin("Group.009", "Saturation", 0.55 if rockonly else 1.0769)
    terrain.data.update()
    terrain.update_tag()


def save_preview(nrm, path):
    """grey PNG (colorspace set BEFORE writing pixels: changing it afterwards regenerates a generated image)."""
    pv = bpy.data.images.new("pv_" + os.path.basename(path), nrm.shape[1], nrm.shape[0], alpha=False)
    pv.colorspace_settings.name = "Non-Color"
    rgba = np.ones((nrm.shape[0], nrm.shape[1], 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = nrm
    pv.pixels.foreach_set(rgba.ravel())
    pv.update()
    pv.filepath_raw = path
    pv.file_format = "PNG"
    pv.save()
    bpy.data.images.remove(pv)


def set_active_output(name):
    for n in nt.nodes:
        if n.bl_idname == "ShaderNodeOutputMaterial":
            n.is_active_output = (n.name == name)


# ---- TM baking mode (its own operator) -------------------------------------------------------
bake_cam["tm_bake_resolution_x"] = RES
bake_cam["tm_bake_resolution_y"] = RES
bake_cam["tm_bake_samples"] = SAMPLES
bpy.ops.terrainmixer.toggle_baking_camera()
LOG["baking_mode"] = {"active": sc.terrain_mixer.tm_baking_mode_active, "camera": sc.camera.name,
                      "engine": sc.render.engine, "res": [sc.render.resolution_x, sc.render.resolution_y],
                      "samples": sc.cycles.samples}
sc.cycles.device = "CPU"
sc.cycles.use_denoising = False
sc.cycles.use_adaptive_sampling = False
sc.render.film_transparent = False
sc.view_settings.view_transform = "Raw" if "Raw" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
sc.view_settings.look = "None"
sc.view_settings.exposure = 0.0
sc.view_settings.gamma = 1.0
sc.render.image_settings.file_format = "OPEN_EXR"
sc.render.image_settings.color_depth = "32"
sc.render.image_settings.color_mode = "RGB"
try:
    LOG["tm_render_op_poll"] = bpy.ops.terrainmixer.render_with_baking_settings.poll()
except Exception as e:
    LOG["tm_render_op_poll"] = repr(e)

for var in VARS:
    t1 = time.time()
    configure(var)
    set_active_output("Height Output")
    p = os.path.join(OUT, f"{TAG}_{var}_height.exr")
    sc.render.filepath = p
    try:
        # TM's operator calls render('INVOKE_DEFAULT') - no window in background, so call the render directly
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        LOG["variants"][var] = "render fail " + repr(e)
        continue
    img = bpy.data.images.load(p, check_existing=False)
    a = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)[..., 0]
    bpy.data.images.remove(img)
    lo, hi = float(np.percentile(a, 0.5)), float(np.percentile(a, 99.5))
    nrm = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    save_preview(nrm, os.path.join(OUT, f"{TAG}_{var}_preview.png"))
    LOG["variants"][var] = {"exr": os.path.basename(p), "min": float(a.min()), "max": float(a.max()),
                            "p0.5": lo, "p99.5": hi, "mean": float(a.mean()), "s": round(time.time() - t1, 1)}
    print("[tm] baked", var, LOG["variants"][var], flush=True)

    if COLOR:
        # albedo via Cycles bake (TM 'Material Output' active), UV image on the TM plane
        t2 = time.time()
        set_active_output("Material Output")
        cimg = bpy.data.images.new(f"tmcol_{var}", RES, RES, alpha=False, float_buffer=False)
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = cimg
        nt.nodes.active = tn
        bpy.context.view_layer.objects.active = terrain
        for o in bpy.context.view_layer.objects:
            o.select_set(o is terrain)
        try:
            sc.cycles.samples = max(4, SAMPLES // 2)
            bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True, margin=4)
            cimg.filepath_raw = os.path.join(OUT, f"{TAG}_{var}_color.png")
            cimg.file_format = "PNG"
            cimg.save()
            LOG["variants"][var]["color"] = os.path.basename(cimg.filepath_raw)
            LOG["variants"][var]["color_s"] = round(time.time() - t2, 1)
        except Exception as e:
            LOG["variants"][var]["color"] = "bake fail " + repr(e)
            traceback.print_exc()
        nt.nodes.remove(tn)
        sc.cycles.samples = SAMPLES

bpy.ops.terrainmixer.toggle_baking_camera()     # leave baking mode (restores settings)
LOG["seconds"] = round(time.time() - t0, 1)
T.write_json(os.path.join(OUT, f"{TAG}_bake_log.json"), LOG)
print("TM_BAKE_DONE", json.dumps({k: LOG[k] for k in ("variants", "notes", "baking_mode")}, default=str)[:3000])
