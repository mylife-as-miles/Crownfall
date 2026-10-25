"""Compare render(s) against the primary frontal reference on objective image statistics.
Usage: python scripts/compare_metrics.py <render.png> [more.png ...]   (system python; numpy+PIL)
Uses research/measure_refs.py (stats/grid3).  Metrics are guides for value/colour structure, not a quality score."""
import sys, os, json
CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CL, "research"))
import measure_refs as MR
REF = os.path.join(CL, "research", "user_refs", "01_REF_primary_frontal_concept.png")
KEYS = ["luma_mean", "luma_rms_contrast", "frac_luma_below_0.08", "frac_luma_above_0.85", "sat_hsv_mean",
        "chroma_lab_mean", "frac_warm_saturated", "frac_cool_tinted"]
def summary(p):
    rgb = MR.load(p)[0]; s = MR.stats(rgb); g = MR.grid3(rgb)
    return s, g
rs, rg = summary(REF)
out = {}
for p in sys.argv[1:]:
    s, g = summary(p)
    row = {k: (round(s[k], 3), round(rs[k], 3)) for k in KEYS if k in s}
    pk = lambda d: [round(float(v), 3) for kk, v in sorted(d.items(), key=lambda t: float(t[0])) if float(kk) in (5, 50, 95)]
    row["luma_pct(5,50,95)"] = (pk(s["luma_pct"]), pk(rs["luma_pct"]))
    row["grid_luma"] = ([[round(c["luma"], 2) for c in r] for r in g], [[round(c["luma"], 2) for c in r] for r in rg])
    out[os.path.basename(p)] = row
    print(f"\n== {os.path.basename(p)}   (render, reference)")
    for k, v in row.items():
        print(f"  {k:24s} {v[0]}   ref {v[1]}")
json.dump(out, open(os.path.join(CL, "reviews", "_last_metrics.json"), "w"), indent=1)
