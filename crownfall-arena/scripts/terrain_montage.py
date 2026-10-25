"""Contact sheet helper (system python + PIL).  Not a Blender script.

python scripts/terrain_montage.py out.png cols cell_w img1 img2 ...
"""
import sys
from PIL import Image, ImageDraw


def main():
    out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    files = sys.argv[4:]
    ims = [Image.open(f).convert("RGB") for f in files]
    ch = int(cw * ims[0].height / ims[0].width)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for i, (im, f) in enumerate(zip(ims, files)):
        im = im.resize((cw, ch), Image.LANCZOS)
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.paste(im, (x, y))
        d.text((x + 4, y + 4), f.replace("\\", "/").split("/")[-1][:60], fill=(255, 255, 0))
    sheet.save(out)
    print("montage", out, sheet.size)


if __name__ == "__main__":
    main()
