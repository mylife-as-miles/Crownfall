"""UCUPAINT probe: find out which Ucupaint operators / internals work headless (blender -b).
python lib/run_blender.py scripts/ucupaint_probe.py --timeout 900
Writes logs/ucupaint_probe.json + renders/ucupaint/_probe/*.png
"""
import sys, os, time, json, traceback
import bpy, addon_utils

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(CL, "renders", "ucupaint", "_probe")
os.makedirs(OUT, exist_ok=True)
res = {}


def step(name, fn):
    t = time.time()
    try:
        r = fn()
        res[name] = ["OK", r, round(time.time() - t, 2)]
        print("STEP OK", name, r, round(time.time() - t, 2), flush=True)
        return r
    except Exception as e:
        res[name] = ["FAIL", repr(e), round(time.time() - t, 2)]
        print("STEP FAIL", name, repr(e), flush=True)
        traceback.print_exc()
        return None


addon_utils.enable("bl_ext.blender_org.ucupaint", default_set=True, persistent=False)
import bl_ext.blender_org.ucupaint as UP
from bl_ext.blender_org.ucupaint import common as C, Layer, Mask, MaskModifier, Modifier, Bake, Root
from bl_ext.blender_org.ucupaint import layer_common, mask_common, modifier_common, bake_common
from bl_ext.blender_org.ucupaint.node_arrangements import rearrange_layer_nodes, rearrange_yp_nodes
from bl_ext.blender_org.ucupaint.node_connections import reconnect_layer_nodes, reconnect_yp_nodes

wm = bpy.context.window_manager
step("ctx_info", lambda: {"window": str(bpy.context.window), "screen": str(bpy.context.screen),
                          "n_windows": len(wm.windows), "screens": [s.name for s in bpy.data.screens][:12],
                          "area": str(bpy.context.area), "space_data": str(getattr(bpy.context, "space_data", None))})

# clean scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.0)
obj = bpy.context.active_object
obj.name = "ProbeObj"
# some displacement for AO/edges
import mathutils
for v in obj.data.vertices:
    n = mathutils.noise.noise(v.co * 3.0)
    v.co *= 1.0 + 0.15 * n
obj.data.shade_smooth()
mat = bpy.data.materials.new("ProbeMat")
obj.data.materials.append(mat)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
step("uv_layers", lambda: [u.name for u in obj.data.uv_layers])

ypup = C.get_user_preferences()
step("prefs", lambda: {k: str(getattr(ypup, k)) for k in ("skip_property_popups", "default_bake_device",
                                                             "default_image_resolution", "default_new_image_size")
                       if hasattr(ypup, k)})


def win_ctx():
    """Best UI-like context we can get in background mode."""
    kw = dict(object=obj, active_object=obj, selected_objects=[obj], edit_object=None)
    if len(wm.windows):
        w = wm.windows[0]
        kw["window"] = w
        scr = w.screen
        kw["screen"] = scr
        a3 = [a for a in scr.areas if a.type == "VIEW_3D"]
        if a3:
            kw["area"] = a3[0]
            kw["region"] = [r for r in a3[0].regions if r.type == "WINDOW"][0]
    return kw


step("win_ctx_keys", lambda: list(win_ctx().keys()))


def quick_setup():
    with bpy.context.temp_override(**win_ctx()):
        r = bpy.ops.wm.y_quick_ypaint_node_setup(enable_ao=True, enable_metallic=False, enable_height=True,
                                                 enable_normal=True, use_orm_bake_target=True,
                                                 switch_to_material_view=False)
    return str(r)


step("quick_setup", quick_setup)
node = None


def get_node():
    global node
    node = C.get_active_ypaint_node(obj, mat)
    yp = node.node_tree.yp
    return {"node": node.name, "channels": [(c.name, c.type, c.special_type) for c in yp.channels],
            "bake_targets": [b.name for b in yp.bake_targets]}


step("yp_node", get_node)


def new_layer(**kw):
    with bpy.context.temp_override(**win_ctx()):
        r = bpy.ops.wm.y_new_layer(**kw)
    yp = node.node_tree.yp
    return str(r), [l.name + ":" + l.type for l in yp.layers]


step("layer_color", lambda: new_layer(name="Base", type="COLOR", solid_color=(0.4, 0.42, 0.35), channel_idx="0",
                                      blend_type="MIX", uv_map="UVMap"))
step("layer_noise", lambda: new_layer(name="Tone", type="NOISE", channel_idx="0", blend_type="OVERLAY",
                                      texcoord_type="Object", uv_map="UVMap"))
step("layer_moss", lambda: new_layer(name="Moss", type="COLOR", solid_color=(0.25, 0.3, 0.2), channel_idx="-1",
                                     blend_type="MIX", uv_map="UVMap"))


def layer_info():
    yp = node.node_tree.yp
    out = {}
    for i, l in enumerate(yp.layers):
        out[l.name] = {"idx": i, "chans": [(yp.channels[j].name, c.enable, c.blend_type) for j, c in enumerate(l.channels)],
                       "src": str(C.get_layer_source(l)), "tex": l.texcoord_type}
    return out


step("layer_info", layer_info)


def masks():
    yp = node.node_tree.yp
    li = [i for i, l in enumerate(yp.layers) if l.name == "Moss"][0]
    yp.active_layer_index = li
    out = []
    for t, kw in (("HEMI", {}), ("NOISE", {"texcoord_type": "Object"}), ("AO", {}), ("EDGE_DETECT", {})):
        try:
            with bpy.context.temp_override(**win_ctx()):
                r = bpy.ops.wm.y_new_layer_mask(name="M_" + t, type=t, blend_type="MULTIPLY", uv_map="UVMap", **kw)
            out.append((t, str(r)))
        except Exception as e:
            out.append((t, "ERR " + repr(e)))
    layer = yp.layers[li]
    out.append([(m.name, m.type, m.blend_type) for m in layer.masks])
    return out


step("masks", masks)


def mask_mod():
    yp = node.node_tree.yp
    layer = [l for l in yp.layers if l.name == "Moss"][0]
    m = layer.masks[0]
    MaskModifier.add_new_mask_modifier(m, "RAMP")
    rearrange_layer_nodes(layer)
    reconnect_layer_nodes(layer)
    how = "internal"
    tree = C.get_mask_tree(m)
    mod = m.modifiers[0]
    ramp = tree.nodes.get(mod.ramp)
    return how, str(ramp), [e.position for e in ramp.color_ramp.elements] if ramp else None


step("mask_modifier", mask_mod)


def layer_mod():
    yp = node.node_tree.yp
    layer = [l for l in yp.layers if l.name == "Tone"][0]
    modifier_common.add_new_modifier(layer, "COLOR_RAMP")
    reconnect_layer_nodes(layer)
    rearrange_layer_nodes(layer)
    how = "internal"
    mod = layer.modifiers[0]
    tree = C.get_mod_tree(layer)
    ramp = tree.nodes.get(mod.color_ramp)
    return how, mod.type, str(ramp)


step("layer_modifier", layer_mod)


def overrides():
    yp = node.node_tree.yp
    layer = [l for l in yp.layers if l.name == "Moss"][0]
    names = [c.name for c in yp.channels]
    ri = names.index("Roughness")
    hi = names.index("Height")
    lc = layer.channels[ri]
    lc.enable = True
    lc.override = True
    lc.override_value = 0.92
    hc = layer.channels[hi]
    hc.enable = True
    hc.override = True
    hc.override_value = 1.0
    hc.bump_distance = 0.02
    return "ok", [(names[i], c.enable, c.override) for i, c in enumerate(layer.channels)]


step("channel_overrides", overrides)

# render live EEVEE
sc = bpy.context.scene
sys.path.insert(0, os.path.join(CL, "lib"))
import cf_render as R
for o in [o for o in bpy.data.objects if o.type in ("CAMERA", "LIGHT")]:
    bpy.data.objects.remove(o)
R.setup_render(sc, "EEVEE", (480, 360), 16)
R.setup_world(sc)
R.standard_lights(2.0)
cam = R.camera("C", (0, -4.5, 1.2), (0, 0, 0), 50)
step("render_live", lambda: R.render_to(os.path.join(OUT, "probe_live.png"), cam))


def bake():
    yp = node.node_tree.yp
    tree = node.node_tree
    g = yp.bake_target_global_settings
    g.use_custom_resolution = True
    g.width = g.height = 512
    g.samples = 8
    g.margin = 4
    g.uv_map = "UVMap"
    g.fxaa = True
    g.denoise = False
    g.necessary_only = False
    gprops = {p: str(getattr(g, p)) for p in ("bake_device", "samples", "margin", "margin_type", "uv_map", "width",
                                               "height", "aa_level", "ssaa", "hdr", "interpolation")
              if hasattr(g, p)}
    bts = [(bt.name, bt.data_type, [(l, getattr(bt, l).channel_name, getattr(bt, l).subchannel_index) for l in "rgba"],
            getattr(bt.r, "normal_type", None)) for bt in yp.bake_targets]
    t = time.time()
    with bpy.context.temp_override(**win_ctx()):
        r = bpy.ops.wm.y_bake_all_targets()
    out = {"ret": str(r), "gprops": gprops, "bts": bts, "secs": round(time.time() - t, 1)}
    out["targets"] = []
    for bt in yp.bake_targets:
        bn = tree.nodes.get(bt.baked_node)
        out["targets"].append((bt.name, bn.image.name if bn and getattr(bn, "image", None) else str(bn)))
    out["use_baked"] = yp.use_baked
    return out


binfo = step("bake_channels", bake)


def save_imgs():
    saved = []
    for img in bpy.data.images:
        if img.size[0] >= 256 and img.has_data:
            p = os.path.join(OUT, "probe_" + bpy.path.clean_name(img.name) + ".png")
            img.filepath_raw = p
            img.file_format = "PNG"
            img.save()
            saved.append((img.name, img.colorspace_settings.name, list(img.size), img.is_float))
    return saved


step("save_images", save_imgs)
step("render_baked", lambda: R.render_to(os.path.join(OUT, "probe_baked.png"), cam))
json.dump(res, open(os.path.join(CL, "logs", "ucupaint_probe.json"), "w"), indent=1, default=str)
print("PROBE_DONE")
