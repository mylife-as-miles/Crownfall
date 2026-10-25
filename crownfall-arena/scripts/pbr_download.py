"""Download the CFCL_PBR CC0 texture library (system python 3.12 + PIL + numpy, NOT Blender).

Sources (only): Poly Haven (api.polyhaven.com / dl.polyhaven.org) and ambientCG (ambientcg.com/api/v2 + its
download links).  Both libraries publish every asset under CC0 1.0.

Per set it stores, under assets/CFCL_PBR/textures/<source>_<asset_id>/ :
  <id>_color_2k.jpg      sRGB albedo
  <id>_nrm_gl_2k.jpg     OpenGL tangent normal (for UV'd / baked use; box-projected materials use bump instead)
  <id>_rough_2k.jpg, <id>_ao_2k.jpg (if provided), <id>_disp_2k.(jpg|png), <id>_emit_2k.jpg (lava only)
  <id>_rad_2k.png        DERIVED pack made here: R=roughness, G=AO (1 if missing), B=height (displacement,
                         re-normalised 0..1).  Lets the box-projected material use 2 GPU textures per sample.
and records everything in assets/CFCL_PBR/SOURCES.json (asset id, page URL, download URL(s), authors, licence,
sha256 of every stored file + of the original archive for ambientCG).

Usage:  python scripts/pbr_download.py            (idempotent; skips files already present with matching size)
"""
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile

import numpy as np
from PIL import Image

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(CL, "assets", "CFCL_PBR")
TEX = os.path.join(LIB, "textures")
UA = {"User-Agent": "CrownfallPBR/1.0 (CC0 texture fetch for a Blender look-dev scene)"}

# (source, asset_id, role) -- chosen from contact sheets of the catalogues (see README.md)
SETS = [
    ("polyhaven", "rock_face_03", "cliff rock face, warm grey-brown, cracked"),
    ("polyhaven", "cliff_side", "layered sedimentary cliff, strong horizontal strata"),
    ("polyhaven", "marble_cliff_03", "blocky orthogonally fractured cliff (E33 cubic cliffs)"),
    ("polyhaven", "dark_rock_02", "dark stratified fractured rock -> basalt ribs / columns"),
    ("polyhaven", "mossy_rock", "rock face with moss + lichen"),
    ("polyhaven", "lichen_rock", "dark rock with lichen crust"),
    ("polyhaven", "forest_leaves_02", "forest floor: moss, leaves, twigs"),
    ("polyhaven", "burned_ground_01", "burned ground / ash with plant debris"),
    ("polyhaven", "mud_cracked_dry_riverbed_002", "dry cracked earth"),
    ("polyhaven", "sand_01", "trampled sand / dust"),
    ("polyhaven", "large_sandstone_blocks_01", "ancient large stone blocks (ruin walls)"),
    ("polyhaven", "stone_wall_05", "ancient fitted ashlar wall, grey"),
    ("polyhaven", "seaworn_stone_tiles", "timeworn cast stone blocks (carved masonry, dais)"),
    ("polyhaven", "monastery_stone_floor", "irregular flagstone paving (plaza)"),
    ("polyhaven", "rock_wall_16", "dark squared stone blocks (dark masonry / plaza)"),
    ("ambientcg", "Rock030", "grey layered cliff rock"),
    ("ambientcg", "Rock028", "grey layered cliff with moss in the ledges"),
    ("ambientcg", "Rock035", "very dark blue-black rock (basalt alternative)"),
    ("ambientcg", "Lava002", "cooled lava crust with emissive flow cracks"),
    ("ambientcg", "Moss002", "dense moss (blend layer)"),
    ("ambientcg", "Marble012", "white/grey veined marble (optional board light squares)"),
    ("ambientcg", "Marble016", "black veined marble (optional board dark squares)"),
]


def get(url, tries=4):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180).read()
        except Exception as e:  # noqa
            if i == tries - 1:
                raise
            print("  retry", url, e)
            time.sleep(3 + 4 * i)


def getj(url):
    return json.loads(get(url).decode("utf-8"))


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""):
            h.update(ch)
    return h.hexdigest()


def load_gray(path):
    im = Image.open(path)
    if im.mode in ("I;16", "I;16B", "I"):
        a = np.asarray(im, dtype=np.float32) / 65535.0
    else:
        a = np.asarray(im.convert("L"), dtype=np.float32) / 255.0
    return a


def make_rad(folder, aid, rough, ao, disp):
    out = os.path.join(folder, f"{aid}_rad_2k.png")
    r = load_gray(rough)
    n = r.shape
    a = load_gray(ao) if ao else np.ones(n, np.float32)
    d = load_gray(disp) if disp else np.full(n, 0.5, np.float32)
    if a.shape != n:
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize(n[::-1], Image.BILINEAR), np.float32) / 255
    if d.shape != n:
        d = np.asarray(Image.fromarray((d * 65535).astype(np.uint16)).resize(n[::-1], Image.BILINEAR), np.float32) / 65535
    lo, hi = np.percentile(d, 0.5), np.percentile(d, 99.5)
    d = np.clip((d - lo) / max(hi - lo, 1e-4), 0, 1)
    rgb = np.stack([r, a, d], -1)
    Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB").save(out, optimize=True)
    return out


def do_polyhaven(aid, role):
    folder = os.path.join(TEX, f"polyhaven_{aid}")
    os.makedirs(folder, exist_ok=True)
    info = getj(f"https://api.polyhaven.com/info/{aid}")
    files = getj(f"https://api.polyhaven.com/files/{aid}")
    want = {"color": ("Diffuse", "jpg"), "nrm_gl": ("nor_gl", "jpg"), "rough": ("Rough", "jpg"),
            "ao": ("AO", "jpg"), "disp": ("Displacement", "png")}
    rec = {"source": "Poly Haven", "asset_id": aid, "name": info.get("name"), "role": role,
           "page_url": f"https://polyhaven.com/a/{aid}", "authors": info.get("authors"),
           "license": "CC0 1.0 Universal (Poly Haven)", "license_url": "https://polyhaven.com/license",
           "real_world_size_mm": info.get("dimensions"), "resolution": "2k", "maps": {}, "files": {}}
    for key, (ph, fmt) in want.items():
        node = files.get(ph, {}).get("2k", {})
        ent = node.get(fmt) or node.get("jpg") or node.get("png")
        if not ent:
            print("  missing map", aid, key)
            continue
        url = ent["url"]
        ext = os.path.splitext(url)[1]
        dst = os.path.join(folder, f"{aid}_{key}_2k{ext}")
        if not (os.path.exists(dst) and os.path.getsize(dst) == ent.get("size", -1)):
            data = get(url)
            open(dst, "wb").write(data)
        rec["maps"][key] = os.path.relpath(dst, LIB).replace("\\", "/")
        rec["files"][os.path.basename(dst)] = {"download_url": url, "bytes": os.path.getsize(dst), "sha256": sha(dst),
                                               "md5_published": ent.get("md5")}
    m = rec["maps"]
    rad = make_rad(folder, aid, os.path.join(LIB, m["rough"]), os.path.join(LIB, m["ao"]) if "ao" in m else None,
                   os.path.join(LIB, m["disp"]) if "disp" in m else None)
    rec["maps"]["rad"] = os.path.relpath(rad, LIB).replace("\\", "/")
    rec["files"][os.path.basename(rad)] = {"derived_from": ["rough", "ao", "disp"], "bytes": os.path.getsize(rad),
                                           "sha256": sha(rad)}
    return rec


def do_ambientcg(aid, role):
    folder = os.path.join(TEX, f"ambientcg_{aid}")
    os.makedirs(folder, exist_ok=True)
    d = getj(f"https://ambientcg.com/api/v2/full_json?id={aid}&include=downloadData,tagData")
    a = d["foundAssets"][0]
    dl = None
    for cat in a["downloadFolders"]["default"]["downloadFiletypeCategories"].values():
        for x in cat["downloads"]:
            if x["attribute"] == "2K-JPG":
                dl = x
    rec = {"source": "ambientCG", "asset_id": aid, "name": a.get("displayName"), "role": role,
           "page_url": f"https://ambientcg.com/view?id={aid}", "authors": "ambientCG (Lennart Demes)",
           "license": "CC0 1.0 Universal (ambientCG)", "license_url": "https://docs.ambientcg.com/license/",
           "creation_method": a.get("creationMethodName"), "resolution": "2K-JPG",
           "archive": {"download_url": dl["downloadLink"], "bytes_published": dl.get("size")}, "maps": {}, "files": {}}
    keymap = {"_Color.": "color", "_NormalGL.": "nrm_gl", "_Roughness.": "rough", "_AmbientOcclusion.": "ao",
              "_Displacement.": "disp", "_Emission.": "emit"}
    have = all(any(f.startswith(f"{aid}_{k}_2k") for f in os.listdir(folder)) for k in ("color", "rough", "disp"))
    tmpd = tempfile.mkdtemp(prefix=f"acg_{aid}_")      # untrusted archive goes to its own empty dir
    try:
        zpath = os.path.join(tmpd, f"{aid}_2K-JPG.zip")
        data = get(dl["downloadLink"]) if not have or not os.path.exists(os.path.join(folder, "_archive_sha256.txt")) else None
        if data is not None:
            open(zpath, "wb").write(data)
            rec["archive"]["sha256"] = sha(zpath)
            rec["archive"]["bytes"] = os.path.getsize(zpath)
            open(os.path.join(folder, "_archive_sha256.txt"), "w").write(rec["archive"]["sha256"] + "\n")
            with zipfile.ZipFile(zpath) as z:
                for nm in z.namelist():
                    base = os.path.basename(nm)               # never trust archive paths
                    if not base.lower().endswith((".jpg", ".png")):
                        continue
                    for tag, key in keymap.items():
                        if tag in base:
                            ext = os.path.splitext(base)[1].lower()
                            dst = os.path.join(folder, f"{aid}_{key}_2k{ext}")
                            with z.open(nm) as src, open(dst, "wb") as out:
                                shutil.copyfileobj(src, out)
                            rec["files"][os.path.basename(dst)] = {"from_archive_member": base}
        else:
            rec["archive"]["sha256"] = open(os.path.join(folder, "_archive_sha256.txt")).read().strip()
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)
    for f in sorted(os.listdir(folder)):
        for key in keymap.values():
            if f.startswith(f"{aid}_{key}_2k"):
                p = os.path.join(folder, f)
                rec["maps"][key] = os.path.relpath(p, LIB).replace("\\", "/")
                rec["files"].setdefault(f, {})
                rec["files"][f].update({"bytes": os.path.getsize(p), "sha256": sha(p)})
    m = rec["maps"]
    rad = make_rad(folder, aid, os.path.join(LIB, m["rough"]), os.path.join(LIB, m["ao"]) if "ao" in m else None,
                   os.path.join(LIB, m["disp"]) if "disp" in m else None)
    rec["maps"]["rad"] = os.path.relpath(rad, LIB).replace("\\", "/")
    rec["files"][os.path.basename(rad)] = {"derived_from": ["rough", "ao", "disp"], "bytes": os.path.getsize(rad),
                                           "sha256": sha(rad)}
    return rec


def main():
    os.makedirs(TEX, exist_ok=True)
    src_json = os.path.join(LIB, "SOURCES.json")
    old = json.load(open(src_json)) if os.path.exists(src_json) else {}
    sets = dict(old.get("sets", {}))
    only = set(sys.argv[1:])
    for source, aid, role in SETS:
        key = f"{source}_{aid}"
        if only and aid not in only:
            continue
        t = time.time()
        try:
            rec = do_polyhaven(aid, role) if source == "polyhaven" else do_ambientcg(aid, role)
            sets[key] = rec
            mb = sum(v.get("bytes", 0) for v in rec["files"].values()) / 1e6
            print(f"OK {key:40s} {mb:6.1f} MB  {time.time() - t:5.1f}s  maps={sorted(rec['maps'])}", flush=True)
        except Exception as e:
            print(f"FAIL {key}: {e!r}", flush=True)
    total = 0
    for root, _, fs in os.walk(TEX):
        total += sum(os.path.getsize(os.path.join(root, f)) for f in fs)
    out = {"_about": "CFCL_PBR texture library for the Crownfall main environment (Claude track). Every set is CC0 1.0 "
                     "from Poly Haven or ambientCG; *_rad_2k.png files are derived packs made by scripts/pbr_download.py.",
           "generated": time.strftime("%Y-%m-%d %H:%M:%S"), "total_bytes_on_disk": total, "count": len(sets),
           "sets": sets}
    json.dump(out, open(src_json, "w"), indent=1)
    print(f"SOURCES.json: {len(sets)} sets, {total / 1e6:.1f} MB on disk")


if __name__ == "__main__":
    main()
