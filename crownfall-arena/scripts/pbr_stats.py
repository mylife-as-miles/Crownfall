"""System-python helper (NOT Blender): luma stats of renders vs the E33 targets, sheet labelling, side-by-side.

python scripts/pbr_stats.py stats <png> [<png> ...]
python scripts/pbr_stats.py label <sheet.png> <labels.json>
python scripts/pbr_stats.py pair <before.png> <after.png> <out.png> [title]
Targets (research/E33_RITUAL_FLOOR_DIRECTION.md): mean luma 0.38-0.46, RMS >= 0.20, < 4 % below 0.08.
Luma = Rec.709 on sRGB-encoded values (same as research/measure_refs.py)."""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw


def stats(p):
    a = np.asarray(Image.open(p).convert("RGB"), np.float32) / 255.0
    y = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    h, w = y.shape
    mean_rgb = a.reshape(-1, 3).mean(0)
    sat = (a.max(-1) - a.min(-1)).mean()
    # bottom third (foreground floor) vs top
    return {"file": p.replace("\\", "/").split("/")[-1], "mean": round(float(y.mean()), 3), "rms": round(float(y.std()), 3),
            "crushed_lt0.08": round(float((y < 0.08).mean()), 4), "clip_gt0.95": round(float((y > 0.95).mean()), 4),
            "p5_50_95": [round(float(np.percentile(y, q)), 3) for q in (5, 50, 95)],
            "mean_rgb": [round(float(x), 3) for x in mean_rgb], "sat": round(float(sat), 3),
            "rows_top_mid_bot": [round(float(y[i * h // 3:(i + 1) * h // 3].mean()), 3) for i in range(3)]}


def label(png, lj):
    im = Image.open(png).convert("RGB")
    d = ImageDraw.Draw(im)
    for n, (x, y) in json.load(open(lj)).items():
        tw = 7 * len(n)
        d.rectangle([x - tw // 2 - 3, y - 2, x + tw // 2 + 3, y + 12], fill=(0, 0, 0))
        d.text((x - tw // 2, y - 1), n, fill=(255, 255, 255))
    out = png.replace(".png", "_labeled.png")
    im.save(out)
    print(out)


def pair(a, b, out, title=""):
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    w = 960
    A = A.resize((w, int(A.height * w / A.width)))
    B = B.resize((w, int(B.height * w / B.width)))
    S = Image.new("RGB", (w * 2 + 8, max(A.height, B.height) + 22), (20, 20, 20))
    S.paste(A, (0, 22))
    S.paste(B, (w + 8, 22))
    d = ImageDraw.Draw(S)
    d.text((6, 5), "BEFORE  " + a.replace("\\", "/").split("/")[-1], fill=(255, 255, 255))
    d.text((w + 14, 5), "AFTER  " + b.replace("\\", "/").split("/")[-1] + ("  " + title if title else ""), fill=(255, 255, 255))
    S.save(out)
    print(out)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "stats":
        for p in sys.argv[2:]:
            print(json.dumps(stats(p)))
    elif cmd == "label":
        label(sys.argv[2], sys.argv[3])
    elif cmd == "pair":
        pair(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else "")
