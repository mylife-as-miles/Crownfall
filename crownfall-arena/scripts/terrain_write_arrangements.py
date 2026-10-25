"""Rewrite arrangement.json files from terrain_layout_data WITHOUT rebuilding geometry (system python).

Keeps the "blend" field pointing at the newest saved version of each asset (or --blend override), so
arrangement and blend stay consistent.  Usage:  python scripts/terrain_write_arrangements.py ribs|islands
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import terrain_layout_data as LD

CL = os.path.dirname(HERE)
KEYS = ("source", "name", "location", "rotation_deg", "scale")


def latest(asset):
    fs = sorted(glob.glob(os.path.join(CL, "assets", asset, f"{asset}_v[0-9][0-9][0-9].blend")))
    return os.path.basename(fs[-1]) if fs else None


def write(asset, placements):
    blend = latest(asset)
    if not blend:
        print("no blend for", asset)
        return
    path = os.path.join(CL, "assets", asset, "arrangement.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"asset": asset, "blend": blend, "placements": [{k: p[k] for k in KEYS} for p in placements]},
                  f, indent=2)
    print("wrote", path, "->", blend, len(placements), "placements")


if __name__ == "__main__":
    what = sys.argv[1:] or ["ribs"]
    if "ribs" in what:
        write("CFCL_Terrain_Ribs", LD.rib_placements())
    if "islands" in what:
        write("CFCL_Terrain_Islands", LD.island_placements())
