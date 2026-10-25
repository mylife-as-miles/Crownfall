"""CFCL_Sky_Shatter - measure the hero_v013 critic (R5) targets on a hero render (system python, PIL + numpy).

python scripts/sky_shatter_metrics.py renders/sky_shatter/real_v010a_hero.png [more.png ...]
Regions are given in 1920x1080 pixels and scaled to the image.  Luma = Rec.709 on display-referred PNG values.
"""
import sys

import numpy as np
from PIL import Image


def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def seam_mask(a, L):
    """warm, bright, thin-ish structures: luma above local median + warm hue."""
    from PIL import ImageFilter
    med = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(9))) / 255.0
    warm = (a[..., 0] - a[..., 2]) > 0.06
    return (L - med > 0.07) & warm


def report(path):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    k = W / 1920.0
    a = np.asarray(im).astype(float) / 255.0
    L = luma(a)
    sm = seam_mask(a, L)

    def reg(x0, y0, x1, y1):
        return (slice(int(y0 * k), int(y1 * k)), slice(int(x0 * k), int(x1 * k)))

    out = {"image": path, "size": [W, H]}
    for name, r in (("corona_ring", (560, 0, 1400, 470)), ("corner_TL", (0, 0, 380, 200)),
                    ("corner_TR", (1540, 0, 1920, 200)), ("mid_left", (380, 0, 700, 300))):
        s = reg(*r)
        m = sm[s]
        out[name] = {"seam_frac": round(float(m.mean()), 4),
                     "seam_luma_p90": round(float(np.percentile(L[s][m], 90)), 3) if m.any() else None,
                     "luma_p10_p50_p90": [round(float(np.percentile(L[s], q)), 3) for q in (10, 50, 90)]}
    s = reg(120, 20, 520, 150)
    out["landmass_box_x120-520_y20-150"] = [round(float(np.percentile(L[s], q)), 3) for q in (10, 30, 50, 90)]
    s = reg(1380, 130, 1460, 260)
    out["hand_merge_box_x1380-1460_y130-260"] = [round(float(np.percentile(L[s], q)), 3) for q in (10, 50, 90)]
    s = reg(1240, 60, 1500, 140)
    out["above_fingertips_x1240-1500_y60-140"] = [round(float(np.percentile(L[s], q)), 3) for q in (10, 50, 90)]
    s = reg(0, 0, 1920, 520)
    out["sky_band_seam_frac"] = round(float(sm[s].mean()), 4)
    return out


if __name__ == "__main__":
    import json
    for p in sys.argv[1:]:
        print(json.dumps(report(p), indent=1))
