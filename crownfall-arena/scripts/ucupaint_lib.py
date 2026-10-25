"""Ucupaint (bl_ext.blender_org.ucupaint 3.0.0) helpers for HEADLESS use (blender -b), Crownfall Claude track.

What works headless (verified by scripts/ucupaint_probe.py, Blender 5.2.3):
  * bpy.context in -b mode still has wm.windows[0] / its screen.  Ucupaint's operators touch
    context.screen.areas / context.space_data, so every op runs inside temp_override(window, screen,
    area=<VIEW_3D>, region).  DO NOT override object/active_object (the FXAA pass of the bake makes a
    temp plane active and a forced active_object breaks it) -> set view_layer.objects.active instead.
  * wm.y_quick_ypaint_node_setup, wm.y_new_layer, wm.y_new_layer_mask, wm.y_bake_to_layer,
    wm.y_bake_all_targets run as operators (EXEC_DEFAULT).
  * wm.y_new_mask_modifier / wm.y_new_ypaint_modifier FAIL headless (they write to UI-only props
    `layer_ui.masks[i]` / `context.layer_ui` AFTER adding the modifier -> duplicate on retry).  Use the
    internals MaskModifier.add_new_mask_modifier / modifier_common.add_new_modifier + reconnect/rearrange.
  * wm.y_bake_channels is deprecated/unregistered in 3.0 -> bake via bake targets (y_bake_all_targets
    with yp.bake_target_global_settings).
  * Masks from EXISTING data (an already-baked image, an existing colour attribute) go through
    mask_common.add_new_mask(...) directly (the operator refuses existing names).
  * NOISE layer/mask outputs default to the 3-channel 'Color' socket -> set socket_input_name 'Fac'
    (VORONOI masks 'Distance'), otherwise ramps calibrated on Fac read a compressed grey.
  * HEMI ("fake lighting") mask = dot(N, vector) * 0.5 + 0.5 (vertical faces = 0.5).
UVs: Smart UV Project fragments decimated Surface-Nets meshes (15-17k islands); seam Unwrap (ABF / LSCM /
MINIMUM_STRETCH) fails on some charts -> chart_project(): smoothed-normal charts (14 dirs) + orthographic
projection per chart + fold re-labelling + Pack Islands.
"""
import os
import sys
import time
import math
import bpy
import addon_utils

U = {}


def enable():
    addon_utils.enable("bl_ext.blender_org.ucupaint", default_set=True, persistent=False)
    import importlib
    base = "bl_ext.blender_org.ucupaint"
    for m in ("common", "MaskModifier", "modifier_common", "mask_common", "node_arrangements",
              "node_connections", "lib", "Bake", "BakeToLayer"):
        U[m] = importlib.import_module(base + "." + m)
    return U


def C():
    return U["common"]


# ------------------------------------------------------------------ context
def ui_ctx():
    wm = bpy.context.window_manager
    kw = {}
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


def set_active(obj, others=()):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    vl.objects.active = obj


def op(fn, **kw):
    with bpy.context.temp_override(**ui_ctx()):
        return fn(**kw)


def relink(layer):
    na, nc = U["node_arrangements"], U["node_connections"]
    nc.reconnect_layer_nodes(layer)
    na.rearrange_layer_nodes(layer)
    nc.reconnect_yp_nodes(layer.id_data)
    na.rearrange_yp_nodes(layer.id_data)


# ------------------------------------------------------------------ UV + attributes (manual prep)
def smart_uv(objs, uv_name="UVMap", angle=60.0, margin=0.0035):
    """Smart UV Project all objs into ONE shared 0-1 atlas (multi-object edit packs them together)."""
    for o in objs:
        me = o.data
        uvl = me.uv_layers.get(uv_name)
        if uvl is None:
            uvl = me.uv_layers.new(name=uv_name)
        me.uv_layers.active = uvl
        uvl.active_render = True
    set_active(objs[0], objs)
    kw = ui_ctx()
    kw.update(active_object=objs[0], object=objs[0], selected_objects=list(objs),
              selected_editable_objects=list(objs), objects_in_mode=list(objs))
    with bpy.context.temp_override(**kw):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        try:
            bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin,
                                     area_weight=0.0, correct_aspect=True, scale_to_bounds=False,
                                     margin_method="FRACTION")
        except TypeError:
            bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
        bpy.ops.object.mode_set(mode="OBJECT")


def chart_seams(obj, n_smooth=40, majority_iters=10, min_faces=60, dirs="cube", return_labels=False, fold_dot=0.42):
    """Mark seams for a low-island-count chart layout.  Smart UV Project fragments these decimated
    Surface-Nets meshes into 15-17k islands (avg 7 faces), so instead: smooth the vertex normals, label each
    face by its best of 6 (cube) / 14 projection directions, majority-filter the labels over face adjacency,
    merge regions smaller than min_faces into their dominant neighbour, then put seams on label boundaries.
    Returns (n_regions, n_seam_edges)."""
    import numpy as np
    me = obj.data
    nv, nf = len(me.vertices), len(me.polygons)
    vn = np.empty(nv * 3, np.float32)
    me.vertex_normals.foreach_get("vector", vn)
    vn = vn.reshape(-1, 3).astype(np.float64)
    ed = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", ed)
    ed = ed.reshape(-1, 2)
    for _ in range(n_smooth):
        acc = np.zeros_like(vn)
        for k in range(3):
            acc[:, k] = (np.bincount(ed[:, 0], weights=vn[ed[:, 1], k], minlength=nv) +
                         np.bincount(ed[:, 1], weights=vn[ed[:, 0], k], minlength=nv))
        vn = 0.5 * vn + 0.5 * acc / np.maximum(np.linalg.norm(acc, axis=1), 1e-9)[:, None]
        vn /= np.maximum(np.linalg.norm(vn, axis=1), 1e-9)[:, None]
    ls = np.empty(nf, np.int32)
    lt = np.empty(nf, np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    le = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("edge_index", le)
    fn = np.add.reduceat(vn[lv], ls, axis=0)
    fn /= np.maximum(np.linalg.norm(fn, axis=1), 1e-9)[:, None]
    D = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    if dirs != "cube":
        D += [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    D = np.array(D, np.float64)
    D /= np.linalg.norm(D, axis=1)[:, None]
    lab = np.argmax(fn @ D.T, axis=1)
    # edge -> two faces
    lf = np.repeat(np.arange(nf), lt)
    order = np.argsort(le, kind="stable")
    le_s, lf_s = le[order], lf[order]
    first = np.r_[True, le_s[1:] != le_s[:-1]]
    starts = np.nonzero(first)[0]
    cnts = np.diff(np.r_[starts, len(le_s)])
    two = starts[cnts == 2]
    e_id = le_s[two]
    f0, f1 = lf_s[two], lf_s[two + 1]
    L = len(D)
    for _ in range(majority_iters):
        votes = np.zeros((nf, L))
        np.add.at(votes, (f0, lab[f1]), 1.0)
        np.add.at(votes, (f1, lab[f0]), 1.0)
        votes[np.arange(nf), lab] += 1.01
        lab = votes.argmax(1)

    def regions(lab):
        par = np.arange(nf)

        def find(x):
            r = x
            while par[r] != r:
                r = par[r]
            while par[x] != r:
                par[x], x = r, par[x]
            return r
        same = lab[f0] == lab[f1]
        for a, b in zip(f0[same].tolist(), f1[same].tolist()):
            ra, rb = find(a), find(b)
            if ra != rb:
                par[ra] = rb
        return np.array([find(i) for i in range(nf)])
    for _ in range(4):
        reg = regions(lab)
        u, inv, cnt = np.unique(reg, return_inverse=True, return_counts=True)
        small = cnt[inv] < min_faces
        if not small.any():
            break
        votes = np.zeros((nf, L))
        np.add.at(votes, (f0, lab[f1]), (~small[f1]).astype(float) + 0.01)
        np.add.at(votes, (f1, lab[f0]), (~small[f0]).astype(float) + 0.01)
        votes[np.arange(nf), lab] -= 0.5
        newlab = votes.argmax(1)
        lab = np.where(small & (votes.max(1) > 0.5), newlab, lab)
    # v003: faces whose REAL normal is > ~75 deg from their chart direction (crack / breach walls seen edge-on)
    # smear under projection -> re-label them with a direction they actually face, grouped with compatible
    # neighbours (constrained majority vote)
    fr = np.empty(nf * 3, np.float32)
    me.polygons.foreach_get("normal", fr)
    fr = fr.reshape(-1, 3).astype(np.float64)
    okm = (fr @ D.T) >= fold_dot
    bad = ~okm[np.arange(nf), lab]
    lab[bad] = np.argmax(fr[bad] @ D.T, axis=1)
    for _ in range(6):
        votes = np.zeros((nf, L))
        np.add.at(votes, (f0, lab[f1]), 1.0)
        np.add.at(votes, (f1, lab[f0]), 1.0)
        votes[np.arange(nf), lab] += 0.5
        votes[~okm] = -1.0
        lab = np.where(bad, votes.argmax(1), lab)
    reg = regions(lab)
    seam = np.zeros(len(me.edges), bool)
    seam[e_id[lab[f0] != lab[f1]]] = True
    me.edges.foreach_set("use_seam", seam)
    if return_labels:
        return int(len(np.unique(reg))), int(seam.sum()), lab, D, lv, ls, lt
    return int(len(np.unique(reg))), int(seam.sum())


def chart_project(objs, margin=0.002, dirs="14", min_faces=150, n_smooth=40):
    """Deterministic atlas: chart labels from chart_seams, then each face is projected ORTHOGRAPHICALLY along its
    chart direction (no unwrap solver -> no failed islands; metric scale kept, foreshortening <= ~1.4x for 14 dirs),
    then Pack Islands (CONCAVE, rotate) into one 0-1 atlas.  Returns info incl. folded-face fraction."""
    import numpy as np
    info = {}
    for o in objs:
        me = o.data
        uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
        me.uv_layers.active = uvl
        uvl.active_render = True
        nreg, nseam, lab, D, lv, ls, lt = chart_seams(o, n_smooth=n_smooth, min_faces=min_faces, dirs=dirs,
                                                      return_labels=True)
        nv = len(me.vertices)
        co = np.empty(nv * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3).astype(np.float64)
        ref = np.where(np.abs(D[:, 2:3]) > 0.9, np.array([[1.0, 0, 0]]), np.array([[0, 0, 1.0]]))
        U = np.cross(ref, D)
        U /= np.linalg.norm(U, axis=1)[:, None]
        V = np.cross(D, U)
        lf = np.repeat(np.arange(len(lab)), lt)
        ll = lab[lf]
        p = co[lv]
        uv = np.stack([(p * U[ll]).sum(1), (p * V[ll]).sum(1)], 1)
        uvl.data.foreach_set("uv", uv.astype(np.float32).ravel())
        # folded faces (real normal pointing away from the chart direction) -> overlap risk
        fnor = np.empty(len(lab) * 3, np.float32)
        me.polygons.foreach_get("normal", fnor)
        fnor = fnor.reshape(-1, 3)
        fold = float(((fnor * D[lab]).sum(1) < 0.05).mean())
        info[o.name] = {"regions": nreg, "seam_edges": nseam, "folded_face_frac": round(fold, 4)}
    set_active(objs[0], objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=margin, pin=False,
                            shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    return info


def chart_unwrap(objs, margin=0.003, method="ANGLE_BASED", **kw):
    """chart_seams on every obj, then Unwrap (seams) + Pack Islands into one shared atlas."""
    import numpy as np
    info = {}
    for o in objs:
        me = o.data
        uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
        me.uv_layers.active = uvl
        uvl.active_render = True
        # zero all UVs first: islands the solver fails on stay degenerate (instead of keeping the default
        # per-face unit squares, which the packer then inflates into a grid of huge triangles - seen in v001)
        uvl.data.foreach_set("uv", np.zeros(len(me.loops) * 2, np.float32))
        for p in me.polygons:
            p.hide = False
        info[o.name] = chart_seams(o, **kw)
    set_active(objs[0], objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.mark_sharp(clear=True)
    bpy.ops.uv.unwrap(method=method, fill_holes=True, correct_aspect=True, margin_method="FRACTION", margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    # faces the solver could not unwrap (closed charts / degenerate) -> Smart UV Project only those
    nfail = {}
    for o in objs:
        me = o.data
        n = len(me.polygons)
        ls = np.empty(n, np.int32)
        lt = np.empty(n, np.int32)
        me.polygons.foreach_get("loop_start", ls)
        me.polygons.foreach_get("loop_total", lt)
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers["UVMap"].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        span = np.maximum.reduceat(uv, ls, axis=0) - np.minimum.reduceat(uv, ls, axis=0)
        bad = (span.max(1) < 1e-7)
        me.polygons.foreach_set("select", bad)
        nfail[o.name] = int(bad.sum())
    info["failed_faces_reprojected"] = nfail
    bpy.ops.object.mode_set(mode="EDIT")
    if sum(nfail.values()):
        bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False, margin_method="FRACTION")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=margin, pin=False,
                            shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    return info


def uv_islands(o):
    import bmesh
    from bpy_extras import bmesh_utils
    bm = bmesh.new()
    bm.from_mesh(o.data)
    n = len(bmesh_utils.bmesh_linked_uv_islands(bm, bm.loops.layers.uv.active))
    bm.free()
    return n


def stretch_stats(objs, uv_name="UVMap"):
    """spread of per-triangle texel density (log2 of uv/3d area ratio, area-weighted std)."""
    import numpy as np
    rs, ws = [], []
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        ar = np.empty(n, np.float32)
        me.loop_triangles.foreach_get("area", ar)
        lp = np.empty(n * 3, np.int32)
        me.loop_triangles.foreach_get("loops", lp)
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers[uv_name].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)[lp].reshape(n, 3, 2)
        e1 = uv[:, 1] - uv[:, 0]
        e2 = uv[:, 2] - uv[:, 0]
        au = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) * 0.5
        ok = (ar > 1e-12) & (au > 1e-14)
        rs.append(np.log2(au[ok] / ar[ok]) * 0.5)
        ws.append(ar[ok])
    r = np.concatenate(rs)
    w = np.concatenate(ws)
    mu = (r * w).sum() / w.sum()
    sd = math.sqrt(((r - mu) ** 2 * w).sum() / w.sum())
    return {"density_log2_std": round(sd, 3)}


def texel_stats(objs, res, uv_name="UVMap", scene_scale=4.6):
    import numpy as np
    a3 = 0.0
    auv = 0.0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        ar = np.empty(n, np.float32)
        me.loop_triangles.foreach_get("area", ar)
        lp = np.empty(n * 3, np.int32)
        me.loop_triangles.foreach_get("loops", lp)
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers[uv_name].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)[lp].reshape(n, 3, 2)
        e1 = uv[:, 1] - uv[:, 0]
        e2 = uv[:, 2] - uv[:, 0]
        auv += float(np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum() * 0.5)
        sc = sum(abs(x) for x in o.matrix_world.to_scale()) / 3.0
        a3 += float(ar.sum()) * sc * sc
    px_per_env_m = math.sqrt(auv * res * res / max(a3, 1e-9))
    return {"surface_area_env_m2": round(a3, 3), "uv_coverage": round(auv, 4),
            "px_per_env_m": round(px_per_env_m, 1), "px_per_scene_m": round(px_per_env_m / scene_scale, 1),
            "cm_per_texel_scene": round(100.0 / (px_per_env_m / scene_scale), 2), "res": res}


def write_gray_attr(obj, name, values):
    """POINT FLOAT_COLOR grey attribute (Ucupaint VCOL masks read colour attributes)."""
    import numpy as np
    me = obj.data
    a = me.color_attributes.get(name)
    if a is None:
        a = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    v = np.clip(np.asarray(values, np.float32), 0, 1)
    rgba = np.stack([v, v, v, np.ones_like(v)], 1).ravel()
    a.data.foreach_set("color", rgba)
    return a


def vert_arrays(obj):
    import numpy as np
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    nor = np.empty(n * 3, np.float32)
    me.vertex_normals.foreach_get("vector", nor)
    return co.reshape(-1, 3), nor.reshape(-1, 3)


def float_attr(obj, name):
    import numpy as np
    a = obj.data.attributes.get(name)
    if a is None or a.domain != "POINT":
        return None
    v = np.empty(len(a.data), np.float32)
    a.data.foreach_get("value", v)
    return v


# ------------------------------------------------------------------ yp setup
def setup_yp(obj, mat_name, ao=True):
    """Fresh material on all slots of obj + Ucupaint quick setup (Color, AO, Roughness, Height, Normal, ORM target)."""
    mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    for n in list(mat.node_tree.nodes):
        mat.node_tree.nodes.remove(n)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    set_active(obj)
    r = op(bpy.ops.wm.y_quick_ypaint_node_setup, enable_ao=ao, enable_metallic=False, enable_height=True,
           enable_normal=True, use_orm_bake_target=True, switch_to_material_view=False,
           use_linear_blending=True)
    node = C().get_active_ypaint_node(obj, mat)
    return mat, node, node.node_tree.yp, str(r)


def ch_index(yp, name):
    return [c.name for c in yp.channels].index(name)


def find_layer(yp, name):
    for i, l in enumerate(yp.layers):
        if l.name == name:
            return i, l
    raise KeyError(name)


def add_layer(obj, node, name, ltype, channel="Color", blend="MIX", color=None, texcoord="Object",
              intensity=1.0, src=None, scale=None, translation=None, rotation=None, out=None):
    """channel: channel name, or 'ALL'.  color: linear RGB for COLOR layers.  src: dict of source-node inputs.
    out: source output socket for every layer channel (NOISE defaults to 'Fac', not the 3-channel 'Color')."""
    yp = node.node_tree.yp
    set_active(obj)
    cidx = "-1" if channel == "ALL" else str(ch_index(yp, channel))
    kw = dict(name=name, type=ltype, channel_idx=cidx, blend_type=blend, uv_map="UVMap")
    if ltype not in ("COLOR", "VCOL", "HEMI", "EDGE_DETECT", "AO", "BACKGROUND", "GROUP", "PREV_LAYERS"):
        kw["texcoord_type"] = texcoord
    if color is not None:
        kw["solid_color"] = color
    r = op(bpy.ops.wm.y_new_layer, **kw)
    if "FINISHED" not in str(r):
        raise RuntimeError("y_new_layer failed " + name + " " + str(r))
    i, layer = find_layer(yp, name)
    layer.intensity_value = intensity
    if out is None and ltype in ("NOISE", "WAVE", "MUSGRAVE", "GRADIENT"):
        out = "Fac"
    if out:
        for c in layer.channels:
            c.socket_input_name = out
    if src:
        set_inputs(C().get_layer_source(layer), src)
    if scale is not None or translation is not None or rotation is not None:
        try:
            layer.enable_uniform_scale = False
        except Exception:
            pass
        if scale is not None:
            layer.scale = scale
        if translation is not None:
            layer.translation = translation
        if rotation is not None:
            layer.rotation = rotation
    return layer


def set_inputs(node, d):
    for k, v in d.items():
        if k.startswith("_"):
            setattr(node, k[1:], v)
        else:
            node.inputs[k].default_value = v


def lch(layer, yp, chname, enable=True, blend=None, intensity=None, value=None, color=None, bump=None,
        height_blend=None, override=None):
    """Configure one layer channel.  value/color -> constant override for this channel."""
    i = ch_index(yp, chname)
    c = layer.channels[i]
    c.enable = enable
    if not enable:
        return c
    if blend is not None:
        if yp.channels[i].special_type == "HEIGHT":
            c.height_blend_type = blend
        elif yp.channels[i].special_type == "NORMAL":
            c.normal_blend_type = blend
        else:
            c.blend_type = blend
    if height_blend is not None:
        c.height_blend_type = height_blend
    if intensity is not None:
        c.intensity_value = intensity
    if value is not None or color is not None or override:
        c.override = True
        c.override_type = "DEFAULT"
        if value is not None:
            c.override_value = value
        if color is not None:
            c.override_color = color
    if bump is not None:
        c.bump_distance = bump
    return c


def add_mask(obj, node, layer, mtype, name, blend="MULTIPLY", texcoord="Object", intensity=1.0, src=None,
             scale=None, translation=None, rotation=None, hemi_vector=None, hemi_space="WORLD",
             hemi_prev_normal=True, modifier_type="RAMP", image=None, vcol=None, out=None):
    yp = node.node_tree.yp
    li, _ = find_layer(yp, layer.name)
    yp.active_layer_index = li
    layer = yp.layers[li]
    if image is not None or vcol is not None:
        mc = U["mask_common"]
        m = mc.add_new_mask(layer, name, "IMAGE" if image is not None else "VCOL", "UV", "UVMap",
                            image=image, vcol_name=vcol or "", blend_type=blend)
        relink(layer)
    else:
        set_active(obj)
        kw = dict(name=name, type=mtype, blend_type=blend, uv_map="UVMap")
        if mtype in ("NOISE", "VORONOI", "WAVE", "MUSGRAVE", "GRADIENT", "MAGIC", "BRICK", "CHECKER", "GABOR"):
            kw["texcoord_type"] = texcoord
        if mtype == "HEMI":
            kw["hemi_space"] = hemi_space
            kw["hemi_use_prev_normal"] = hemi_prev_normal
        if mtype == "MODIFIER":
            kw["modifier_type"] = modifier_type
        r = op(bpy.ops.wm.y_new_layer_mask, **kw)
        if "FINISHED" not in str(r):
            raise RuntimeError("y_new_layer_mask failed " + name + " " + str(r))
        layer = yp.layers[li]
        m = [mm for mm in layer.masks if mm.name == name][0]
    m.intensity_value = intensity
    if out is None:
        out = {"NOISE": "Fac", "WAVE": "Fac", "MUSGRAVE": "Fac", "GRADIENT": "Fac", "VORONOI": "Distance"}.get(mtype)
    if out:
        m.socket_input_name = out
    if hemi_vector is not None:
        m.hemi_vector = hemi_vector
    if src:
        set_inputs(C().get_mask_source(m), src)
    if scale is not None or translation is not None or rotation is not None:
        try:
            m.enable_uniform_scale = False
        except Exception:
            pass
        if scale is not None:
            m.scale = scale
        if translation is not None:
            m.translation = translation
        if rotation is not None:
            m.rotation = rotation
    return m


def set_ramp(ramp, stops, interp="LINEAR"):
    """stops: [(pos, value_or_rgb[, alpha])...]"""
    cr = ramp.color_ramp
    cr.interpolation = interp
    while len(cr.elements) > len(stops):
        cr.elements.remove(cr.elements[-1])
    while len(cr.elements) < len(stops):
        cr.elements.new(0.5)
    for e, s in zip(cr.elements, sorted(stops, key=lambda t: t[0])):
        e.position = s[0]
        v = s[1]
        a = s[2] if len(s) > 2 else 1.0
        e.color = (v, v, v, a) if isinstance(v, (int, float)) else (v[0], v[1], v[2], a)
    return ramp


def mask_ramp(layer, mask, stops, interp="LINEAR"):
    """RAMP mask-modifier (internal API; the operator fails headless)."""
    U["MaskModifier"].add_new_mask_modifier(mask, "RAMP")
    relink(layer)
    tree = C().get_mask_tree(mask)
    mod = mask.modifiers[len(mask.modifiers) - 1]
    return set_ramp(tree.nodes.get(mod.ramp), stops, interp)


def mask_invert(layer, mask):
    U["MaskModifier"].add_new_mask_modifier(mask, "INVERT")
    relink(layer)


def modmask_ramp(mask, stops, interp="LINEAR"):
    """Ramp on a MODIFIER-type mask (acts on the accumulated mask value)."""
    return set_ramp(C().get_mask_source(mask), stops, interp)


def layer_ramp(layer, stops, interp="LINEAR"):
    """COLOR_RAMP layer modifier (internal API)."""
    mc = U["modifier_common"]
    mod = mc.add_new_modifier(layer, "COLOR_RAMP")
    relink(layer)
    tree = C().get_mod_tree(layer)
    mod = [m for m in layer.modifiers if m.type == "COLOR_RAMP"][0]
    return set_ramp(tree.nodes.get(mod.color_ramp), stops, interp)


# ------------------------------------------------------------------ bakes
def bake_ao_layer(obj, node, name, res, distance, samples=32, target="LAYER", channel="Ambient Occlusion"):
    """Ucupaint Bake-to-Layer (AO).  target LAYER -> new image layer in `channel`, MASK -> mask on active layer."""
    yp = node.node_tree.yp
    set_active(obj)
    kw = dict(type="AO", target_type=target, name=name, use_custom_resolution=True, width=res, height=res,
              samples=samples, ao_distance=distance, uv_map="UVMap", hdr=False, denoise=True, fxaa=True,
              margin=8, blend_type="MULTIPLY", use_udim=False, use_image_atlas=False)
    if target == "LAYER":
        kw["channel_idx"] = str(ch_index(yp, channel))
    t = time.time()
    r = op(bpy.ops.wm.y_bake_to_layer, **kw)
    img = bpy.data.images.get(name)
    print("[ucu] bake_to_layer AO", name, r, round(time.time() - t, 1), "s", flush=True)
    return img, str(r), round(time.time() - t, 1)


def bake_targets(obj, node, res, samples=1, margin=16, denoise=False, fxaa=True):
    yp = node.node_tree.yp
    g = yp.bake_target_global_settings
    g.use_custom_resolution = True
    g.width = g.height = res
    g.samples = samples
    g.margin = margin
    g.uv_map = "UVMap"
    g.fxaa = fxaa
    g.denoise = denoise
    g.necessary_only = False
    set_active(obj)
    t = time.time()
    r = op(bpy.ops.wm.y_bake_all_targets)
    out = {}
    tree = node.node_tree
    for bt in yp.bake_targets:
        bn = tree.nodes.get(bt.baked_node)
        out[bt.name] = bn.image if bn is not None and getattr(bn, "image", None) else None
    print("[ucu] bake_all_targets", r, round(time.time() - t, 1), "s", flush=True)
    return out, str(r), round(time.time() - t, 1)


def save_png(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = bpy.path.relpath(path) if bpy.data.filepath else path
    return path


# ------------------------------------------------------------------ report
def describe(yp):
    out = []
    names = [c.name for c in yp.channels]
    for i, l in enumerate(yp.layers):
        d = {"layer": l.name, "type": l.type, "intensity": round(l.intensity_value, 3),
             "texcoord": l.texcoord_type,
             "channels": {names[j]: ({"blend": (c.height_blend_type if yp.channels[j].special_type == "HEIGHT"
                                                else c.blend_type),
                                      "override": (round(c.override_value, 3) if c.override else None),
                                      "bump": round(c.bump_distance, 4) if yp.channels[j].special_type == "HEIGHT" else None,
                                      "intensity": round(c.intensity_value, 3)})
                          for j, c in enumerate(l.channels) if c.enable},
             "modifiers": [m.type for m in l.modifiers],
             "masks": [{"name": m.name, "type": m.type, "blend": m.blend_type, "intensity": round(m.intensity_value, 3),
                        "mods": [mm.type for mm in m.modifiers]} for m in l.masks]}
        out.append(d)
    return out
