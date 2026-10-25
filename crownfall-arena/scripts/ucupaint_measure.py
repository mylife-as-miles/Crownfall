"""Luma / colour checks for Ucupaint monument renders (system python: numpy + PIL).

python scripts/ucupaint_measure.py <render.png> [crop x0 y0 x1 y1 as fractions] ...
Prints display-luma percentiles and HSV saturation of the subject pixels (the preview world/background is
excluded by a simple colour-distance key against the top-left corner), plus distance to the LOCKED palette
targets: ancient stone mid #5d574e (luma ~0.35) / lit #8a8377 (~0.52); moss #3e4a26-#4a5a2e.
Also writes a json next to the image (<name>_metrics.json).
"""
import sys
import os
import json
import numpy as np
from PIL import Image


def luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def hsv_s(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    return np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)


def measure(path, crop=None):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255.0
    h, w, _ = im.shape
    if crop:
        x0, y0, x1, y1 = crop
        im = im[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
    bg = im[:6, :6].reshape(-1, 3).mean(0)
    d = np.abs(im - bg).sum(-1)
    subj = d > 0.06
    # drop the near-black preview ground disk (luma < 0.03, low sat) from the subject statistics
    L = luma(im)
    subj &= ~((L < 0.035) & (hsv_s(im) < 0.25))
    px = im[subj]
    if len(px) < 100:
        px = im.reshape(-1, 3)
    Lp = luma(px)
    S = hsv_s(px)
    r = {
        "file": os.path.basename(path), "crop": crop, "subject_frac": round(float(subj.mean()), 3),
        "luma_p5_25_50_75_95": [round(float(np.percentile(Lp, q)), 3) for q in (5, 25, 50, 75, 95)],
        "luma_mean": round(float(Lp.mean()), 3), "sat_mean": round(float(S.mean()), 3),
        "frac_luma_gt_0.70": round(float((Lp > 0.70).mean()), 3),
        "mean_rgb_hex": "#%02x%02x%02x" % tuple(int(255 * c) for c in px.mean(0)),
        "lit_rgb_hex(p80-95 luma)": "#%02x%02x%02x" % tuple(int(255 * c) for c in
                                                         px[(Lp >= np.percentile(Lp, 80)) & (Lp <= np.percentile(Lp, 95))].mean(0)),
        "mid_rgb_hex(p40-60 luma)": "#%02x%02x%02x" % tuple(int(255 * c) for c in
                                                         px[(Lp >= np.percentile(Lp, 40)) & (Lp <= np.percentile(Lp, 60))].mean(0)),
    }
    # greenness: fraction of subject pixels that read as moss green (hue 70-110, S>0.25)
    mx = px.max(-1)
    mn = px.min(-1)
    dd = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == px[:, 0], ((px[:, 1] - px[:, 2]) / dd) % 6,
                   np.where(mx == px[:, 1], (px[:, 2] - px[:, 0]) / dd + 2, (px[:, 0] - px[:, 1]) / dd + 4)) * 60
    r["frac_moss_green"] = round(float(((hue > 65) & (hue < 115) & (S > 0.22)).mean()), 3)
    r["targets"] = {"stone_mid": "#5d574e L0.35", "stone_lit": "#8a8377 L0.52", "moss": "#3e4a26-#4a5a2e"}
    return r


if __name__ == "__main__":
    args = sys.argv[1:]
    out = []
    i = 0
    while i < len(args):
        p = args[i]
        crop = None
        if i + 4 < len(args) and all(a.replace(".", "", 1).isdigit() for a in args[i + 1:i + 5]):
            crop = [float(a) for a in args[i + 1:i + 5]]
            i += 4
        r = measure(p, crop)
        out.append(r)
        print(json.dumps(r))
        i += 1
