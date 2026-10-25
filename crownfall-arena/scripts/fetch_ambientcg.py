"""Fetch CC0 ambientCG materials into assets/CFCL_PBR/textures/ambientcg_<id>/ and register them in SOURCES.json
(same layout as the existing library: maps color / nrm_gl / rough / disp / ao / metal).
Usage: python -I scripts/fetch_ambientcg.py <AssetId>:<2K|4K>:"<role>" [...]"""
import hashlib
import io
import json
import os
import sys
import time
import urllib.request
import zipfile

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(CL, "assets", "CFCL_PBR")
SRC = os.path.join(LIB, "SOURCES.json")
UA = {"User-Agent": "crownfall-env/1.0"}
MAPKEY = {"Color": "color", "NormalGL": "nrm_gl", "Roughness": "rough", "Displacement": "disp",
          "AmbientOcclusion": "ao", "Metalness": "metal", "Opacity": "alpha"}


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    for arg in sys.argv[1:]:
        aid, res, role = (arg.split(":", 2) + [""])[:3]
        key = f"ambientcg_{aid}"
        tag = f"{res}-JPG"
        url = f"https://ambientcg.com/get?file={aid}_{tag}.zip"
        t = time.time()
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600).read()
        sha = hashlib.sha256(data).hexdigest()
        out = os.path.join(LIB, "textures", key)
        os.makedirs(out, exist_ok=True)
        maps, files = {}, {}
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for m in z.namelist():
                base = os.path.basename(m)
                if not base.lower().endswith((".jpg", ".png")) or "/" in m.strip("/"):
                    continue
                kind = base.rsplit(".", 1)[0].split("_")[-1]
                if kind not in MAPKEY:
                    continue
                dst = f"{aid}_{MAPKEY[kind]}_{res.lower()}.{base.rsplit('.', 1)[1]}"
                blob = z.read(m)
                open(os.path.join(out, dst), "wb").write(blob)
                maps[MAPKEY[kind]] = f"textures/{key}/{dst}"
                files[dst] = {"from_archive_member": base, "bytes": len(blob),
                              "sha256": hashlib.sha256(blob).hexdigest()}
        open(os.path.join(out, "_archive_sha256.txt"), "w").write(sha + "\n")
        d["sets"][key] = {"source": "ambientCG", "asset_id": aid, "name": aid, "role": role,
                          "page_url": f"https://ambientcg.com/view?id={aid}", "authors": "ambientCG (Lennart Demes)",
                          "license": "CC0 1.0 Universal (ambientCG)", "license_url": "https://docs.ambientcg.com/license/",
                          "resolution": tag, "maps": maps, "files": files,
                          "archive": {"download_url": url, "bytes_published": len(data), "sha256": sha, "bytes": len(data)}}
        print(f"{key:36} {tag} {len(data) / 1e6:6.1f} MB  maps={sorted(maps)}  {time.time() - t:.0f}s", flush=True)
    d["count"] = len(d["sets"])
    tmp = SRC + ".tmp"
    json.dump(d, open(tmp, "w", encoding="utf-8"), indent=1)
    os.replace(tmp, SRC)


if __name__ == "__main__":
    main()
