"""Write meta.json for the arch_* assets from the per-iteration report JSONs (system python, no Blender).

python scripts/arch_write_meta.py altar 3      -> assets/CFCL_Arch_AltarDais/meta.json (+ arrangement.json)
python scripts/arch_write_meta.py kit 1        -> assets/CFCL_Arch_RuinsKit/meta.json
python scripts/arch_write_meta.py far 1        -> assets/CFCL_Arch_FarRuins/meta.json
"""
import json
import os
import sys

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RD = os.path.join(CL, "renders", "arch")


def objs(rep):
    return [dict(name=o["name"], dims=o["dims"], tris=o["tris"], materials=o["materials"]) for o in rep["objects"]]


def main():
    kind, ver = sys.argv[1], int(sys.argv[2])
    if kind == "altar":
        asset = "CFCL_Arch_AltarDais"
        rep = json.load(open(os.path.join(RD, f"iter{ver:02d}_report.json")))
        o = objs(rep)
        drum = [x for x in o if x["name"].startswith("CFCL_Arch_Altar")]
        floor = [x for x in o if not x["name"].startswith("CFCL_Arch_Altar")]
        meta = dict(asset=asset, version=ver, blend=rep["blend"], units="metres, +Z up",
                    origin="board centre (0,0,0); place the whole asset at world origin with identity transform",
                    collections={"CFCL_Arch_AltarDais_Drum": [x["name"] for x in drum],
                                 "CFCL_Arch_AltarDais_Floor (optional seated-VR floor, top Z=-0.76)":
                                     [x["name"] for x in floor]},
                    tris_total=rep["tris_total"], tris_drum_group=rep["tris_drum_group"],
                    tris_floor_group=rep["tris_total"] - rep["tris_drum_group"], budget="altar+dais <= 90k",
                    board_contract=dict(drum_top_z=-0.054, board_footprint="+-0.38 m", **rep["drum_top"]),
                    board_clearance={k: v for k, v in rep["board_clearance"].items() if k != "objects"},
                    board_clearance_per_object=rep["board_clearance"]["objects"],
                    objects=o,
                    renders=sorted(f for f in os.listdir(RD) if f.startswith(f"iter{ver:02d}_") and f.endswith(".png")),
                    lod="LOD0 only (render/hero). Decimate/bake before runtime GLB export.",
                    materials_note="CFCL_AncientStone__moss0p3 (cf_materials variant), CFCL_AncientStone_Polished "
                                   "(kneeling dips, derived copy), CFCL_Bronze, CFCL_Arch_Wax (local, proposed), "
                                   "CFCL_AncientStone__moss0 (pebbles), CFCL_BoneStone; procedural, bake before export")
        arr = dict(asset=asset, blend=rep["blend"], placements=[
            dict(source="COLLECTION:CFCL_Arch_AltarDais_Drum", name="AltarDrum", location=[0, 0, 0],
                 rotation_deg=[0, 0, 0], scale=[1, 1, 1]),
            dict(source="COLLECTION:CFCL_Arch_AltarDais_Floor", name="DaisFloor_OPTIONAL", location=[0, 0, 0],
                 rotation_deg=[0, 0, 0], scale=[1, 1, 1])])
        json.dump(arr, open(os.path.join(CL, "assets", asset, "arrangement.json"), "w"), indent=2)
    else:
        asset = "CFCL_Arch_RuinsKit" if kind == "kit" else "CFCL_Arch_FarRuins"
        tag = "kit" if kind == "kit" else "far"
        rep = json.load(open(os.path.join(RD, f"{tag}_iter{ver:02d}_report.json")))
        o = objs(rep)
        meta = dict(asset=asset, version=ver, blend=f"{asset}_v{ver:03d}.blend", units="metres, +Z up",
                    origin="each object: ground-contact centre (bottom centre); objects are laid out in a lineup "
                           "row in the file - use arrangement.json for world placement",
                    objects=o, tris_max_piece=max(x["tris"] for x in o),
                    budget="<= 15k tris per piece" if kind == "kit" else "<= 8k tris per piece",
                    hero_camera_checks=rep["hero_checks"],
                    hero_camera="(0,-1.31,0.22) 28 mm, pitch +2 deg; haze column x0.45-0.58 y0.28-0.60; eclipse "
                                "(3.95,20,5.25) r2 + 3% margin",
                    lineup_locations=rep["lineup_locations"],
                    renders=sorted(f for f in os.listdir(RD) if f.startswith(f"{tag}_iter{ver:02d}_") and f.endswith(".png")),
                    lod="LOD0 only. Bake procedural material before runtime export.")
    json.dump(meta, open(os.path.join(CL, "assets", asset, "meta.json"), "w"), indent=2)
    print("wrote", os.path.join(CL, "assets", asset, "meta.json"))


main()
