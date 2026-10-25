"""Crownfall (Claude track) - asset placement helpers shared by the preview and the Codex apply script.

append_asset(folder, parent_collection, world_scale=1.0) -> dict(name->placed object)
    Appends the latest <Asset>_v###.blend in `folder`, places objects according to arrangement.json
    ({asset, blend, placements:[{source,name,location,rotation_deg,scale}]}), linked-duplicates sources
    used more than once, and hides unplaced kit masters (unless arrangement has "keep_unplaced": true).
hide_matching(scene, patterns) -> list of names hidden (reversible via unhide(names)).
"""
import glob
import json
import math
import os
import re

import bpy
from mathutils import Euler, Vector


# Main build sets this: integrate only the version the README declares "READY vNNN", never a newer WIP blend.
PREFER_READY = False


def ready_version(folder):
    rd = os.path.join(folder, "README.md")
    if not os.path.exists(rd):
        return None
    m = re.search(r"READY\W{0,3}v(\d{3})", open(rd, encoding="utf-8", errors="ignore").read()[:600])
    return m.group(1) if m else None


def latest_blend(folder):
    files = sorted(glob.glob(os.path.join(folder, "*_v[0-9][0-9][0-9].blend")))
    if PREFER_READY and files:
        rv = ready_version(folder)
        pick = [f for f in files if rv and f.endswith(f"_v{rv}.blend")]
        if pick:
            return pick[0]
    return files[-1] if files else None


def append_asset(folder, parent, world_scale=1.0, warnings=None, tag="cfcl_asset", arrangement="arrangement.json"):
    warnings = warnings if warnings is not None else []
    asset = os.path.basename(folder.rstrip("\\/"))
    blend = latest_blend(folder)
    if not blend:
        warnings.append(f"{asset}: no versioned blend")
        return {}
    arr_path = os.path.join(folder, arrangement)
    if not os.path.exists(arr_path):
        arr_path = os.path.join(folder, "arrangement.json")  # fall back to the default layout
    arr = json.load(open(arr_path)) if os.path.exists(arr_path) else None
    if arr and arr.get("blend") and os.path.exists(os.path.join(folder, arr["blend"])):
        if PREFER_READY and ready_version(folder) and not arr["blend"].endswith(f"_v{ready_version(folder)}.blend"):
            # the layout already targets an unfinished version: keep the READY blend, as authored (saved in place)
            warnings.append(f"{asset}: arrangement pins WIP {arr['blend']} - using READY v{ready_version(folder)} as authored")
            arr = None
        else:
            blend = os.path.join(folder, arr["blend"])  # arrangement pins its blend version
    col = bpy.data.collections.new(asset)
    parent.children.link(col)
    col["cfcl_blend"] = os.path.basename(blend)
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.objects = list(src.objects)
    # remember which source collection each object belonged to (for COLLECTION: placements)
    with bpy.data.libraries.load(blend, link=False) as (src, dst2):
        dst2.collections = [c for c in src.collections if c.startswith("CFCL_")]
    col_members = {}
    for c in dst2.collections:
        if c is None:
            continue
        base = re.sub(r"\.\d{3}$", "", c.name)
        col_members[base] = [re.sub(r"\.\d{3}$", "", o.name) for o in c.all_objects]
        for o in list(c.all_objects):          # these are duplicate copies from the 2nd load: drop them
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
    objs = [o for o in dst.objects if o is not None]
    by = {}
    for o in objs:
        if o.type not in ("MESH", "CURVE", "EMPTY", "LIGHT"):
            continue
        col.objects.link(o)
        o[tag] = asset
        by[o.name] = o
    placed = {}
    if arr and arr.get("placements"):
        used = set()
        src_used_ids = set()
        for pl in arr["placements"]:
            src_name = pl.get("source", "")
            if src_name.startswith("COLLECTION:"):
                cname = src_name.split(":", 1)[1]
                members = [by.get(n) for n in col_members.get(cname, [])]
                members = [m for m in members if m is not None]
                if not members:
                    warnings.append(f"{asset}: empty/missing collection {cname}")
                    continue
                loc = Vector(pl.get("location", (0, 0, 0))) * world_scale
                rot = Euler([math.radians(a) for a in pl.get("rotation_deg", (0, 0, 0))], "XYZ")
                sc_ = pl.get("scale", (1, 1, 1))
                sc_ = Vector(sc_ if isinstance(sc_, (list, tuple)) else (sc_, sc_, sc_)) * world_scale
                identity = loc.length < 1e-9 and all(abs(a) < 1e-9 for a in rot) and all(abs(v - 1) < 1e-9 for v in sc_)
                if not identity:
                    root_e = bpy.data.objects.new(pl.get("name", cname), None)
                    col.objects.link(root_e)
                    root_e.location, root_e.rotation_euler, root_e.scale = loc, rot, sc_
                for m in members:
                    if not identity and m.parent is None:
                        m.parent = root_e
                    used.add(m.name)
                    src_used_ids.add(id(m))
                    placed[m.name] = m
                continue
            o = by.get(src_name)
            if o is None:
                # names may have gained .001 on append
                cand = [v for k, v in by.items() if re.sub(r"\.\d{3}$", "", k) == src_name]
                o = cand[0] if cand else None
            if o is None:
                warnings.append(f"{asset}: missing source {src_name}")
                continue
            # Track usage by SOURCE identity (objects get renamed on placement, so names can't be used).
            if id(o) in src_used_ids:
                o2 = o.copy()  # linked duplicate (shares mesh data)
                col.objects.link(o2)
                for ch in o.children:  # duplicate children too
                    c2 = ch.copy()
                    col.objects.link(c2)
                    c2.parent = o2
                o = o2
            else:
                src_used_ids.add(id(o))
            used.add(o.name)
            o.location = Vector(pl.get("location", (0, 0, 0))) * world_scale
            o.rotation_euler = Euler([math.radians(a) for a in pl.get("rotation_deg", (0, 0, 0))], "XYZ")
            sc = pl.get("scale", (1, 1, 1))
            o.scale = Vector(sc if isinstance(sc, (list, tuple)) else (sc, sc, sc)) * world_scale
            if pl.get("name"):
                o.name = pl["name"]
            placed[o.name] = o
        if not arr.get("keep_unplaced", False):
            for o in list(by.values()):
                if id(o) not in src_used_ids and o.name not in placed and o.parent is None and o.name not in used:
                    o.hide_render = True
                    o.hide_viewport = True
    else:
        placed = dict(by)
        if world_scale != 1.0:
            for o in placed.values():
                if o.parent is None:
                    o.location *= world_scale
                    o.scale *= world_scale
    return placed


def hide_matching(scene, patterns):
    hidden = []
    rx = [re.compile(p) for p in patterns]
    for o in scene.objects:
        if any(r.search(o.name) for r in rx) and not o.hide_render:
            o.hide_render = True
            o.hide_viewport = True
            hidden.append(o.name)
    return hidden


def unhide(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o:
            o.hide_render = False
            o.hide_viewport = False
