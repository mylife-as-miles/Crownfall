"""Unpack downloaded Sketchfab scan zips (untrusted data) into vendor/scans/<slug>/, one fresh folder each.
Nested source zips are unpacked in place; members with absolute paths or '..' are refused. Nothing is executed.
Usage: python -I scripts/extract_scans.py <slug>=<path-to-zip> [...]"""
import io
import os
import sys
import zipfile

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(CL, "vendor", "scans")
KEEP = (".obj", ".mtl", ".stl", ".fbx", ".ply", ".glb", ".gltf", ".bin", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".exr", ".txt")


def safe(root, name):
    p = os.path.normpath(os.path.join(root, name))
    if os.path.isabs(name) or not p.startswith(root + os.sep):
        raise ValueError(f"unsafe member {name!r}")
    return p


def unpack(z, root, depth=0):
    for i in z.infolist():
        if i.is_dir():
            continue
        data = z.read(i)
        if i.filename.lower().endswith(".zip") and depth < 3:
            sub = os.path.splitext(safe(root, i.filename))[0].replace(".zip", "")
            os.makedirs(sub, exist_ok=True)
            unpack(zipfile.ZipFile(io.BytesIO(data)), sub, depth + 1)
            continue
        if not i.filename.lower().endswith(KEEP):
            print(f"  skip {i.filename}")
            continue
        p = safe(root, i.filename)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(data)
        print(f"  {len(data) / 1e6:7.1f} MB  {os.path.relpath(p, DST)}")


def main():
    for arg in sys.argv[1:]:
        slug, path = arg.split("=", 1)
        root = os.path.join(DST, slug)
        if os.path.exists(root) and os.listdir(root):
            print(f"{slug}: already unpacked, skipping")
            continue
        os.makedirs(root, exist_ok=True)
        print(f"{slug} <- {path}")
        unpack(zipfile.ZipFile(path), os.path.realpath(root))


if __name__ == "__main__":
    main()
