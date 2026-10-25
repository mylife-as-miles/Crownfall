"""Contact sheet: baked (left) vs live (right) for every shot of an iteration.  (system python + PIL)
python scripts/ucupaint_sheet.py <target> <iter>  -> renders/ucupaint/<target>/iterNN_sheet.png
"""
import sys
import os
import glob
from PIL import Image, ImageDraw

CL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
t, it = sys.argv[1], int(sys.argv[2])
d = os.path.join(CL, "renders", "ucupaint", t)
pre = os.path.join(d, "iter%02d" % it)
shots = sorted({os.path.basename(p)[len("iter%02d_baked_" % it):] for p in glob.glob(pre + "_baked_*.png")})
W = 560
rows = []
for s in shots:
    pair = []
    for mode in ("baked", "live"):
        p = "%s_%s_%s" % (pre, mode, s)
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            im = im.resize((W, int(im.height * W / im.width)))
            dr = ImageDraw.Draw(im)
            dr.text((6, 4), "%s %s" % (mode, s[:-4]), fill=(255, 255, 0))
            pair.append(im)
    if pair:
        rows.append(pair)
H = sum(max(i.height for i in r) for r in rows)
sheet = Image.new("RGB", (W * 2, H), (20, 20, 20))
y = 0
for r in rows:
    for j, im in enumerate(r):
        sheet.paste(im, (j * W, y))
    y += max(i.height for i in r)
out = pre + "_sheet.png"
sheet.save(out)
print(out, sheet.size)
