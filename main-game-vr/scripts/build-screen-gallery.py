"""Package actual screenshots. Requires Pillow; never redraws the game UI."""
import html
import json
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from PIL import Image, ImageDraw, ImageFont, ImageOps

directory = Path(__file__).resolve().parents[1] / 'artifacts' / 'screens'
manifest = json.loads((directory / 'manifest.json').read_text())
if '--overview-only' not in sys.argv:
    assert manifest['complete'], 'Finish capture-all-screens.mjs before packaging'
captures = manifest['captures']
groups = ['Main menus', 'Settings', 'Showcase', 'Dialogs', 'Entry & visit']

def font(size):
    try:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default()

for capture in captures:
    path = directory / capture['filename']
    with Image.open(path) as image:
        assert image.width > 0 and image.height > 0
        capture['width'], capture['height'] = image.size

main = [next(c for c in captures if c['title'] == title) for title in ['Home', 'Play', 'Showcase', 'Settings']]
tile_w, tile_h, gap = 780, 493, 24
overview = Image.new('RGB', (tile_w * 2 + gap * 3, 1220), '#100d08')
draw = ImageDraw.Draw(overview)
draw.text((gap, 22), 'CROWNFALL / QUEST', font=font(38), fill='#d49130')
draw.text((gap, 74), 'Actual browser-emulator captures. Open the PDF or gallery for every screen.', font=font(20), fill='#cdc6b8')
for index, item in enumerate(main):
    x, y = gap + (index % 2) * (tile_w + gap), 126 + (index // 2) * 544
    draw.text((x, y), item['title'].upper(), font=font(24), fill='#d49130')
    with Image.open(directory / item['filename']) as image:
        overview.paste(image.convert('RGB').resize((tile_w, tile_h), Image.Resampling.LANCZOS), (x, y + 36))
overview.save(directory / 'overview.jpg', quality=94)
if '--overview-only' in sys.argv:
    print(directory / 'overview.jpg')
    raise SystemExit(0)

pages = []
for index, item in enumerate(captures):
    with Image.open(directory / item['filename']) as image:
        screenshot = image.convert('RGB')
    page = Image.new('RGB', (1600, 1180), '#100d08')
    d = ImageDraw.Draw(page)
    d.text((36, 22), f'{index + 1:02d} / {len(captures)}   {item["title"]}', font=font(36), fill='#d49130')
    d.text((36, 76), 'Crownfall Quest — browser emulator / mono rendering / closer capture view', font=font(22), fill='#cdc6b8')
    screenshot = ImageOps.contain(screenshot, (1528, 966), Image.Resampling.LANCZOS)
    page.paste(screenshot, ((1600 - screenshot.width) // 2, 122 + (966 - screenshot.height) // 2))
    d.text((36, 1120), f'{item["group"]}  •  Source {manifest["sourceCommit"][:7]}  •  Physical headset validation pending', font=font(20), fill='#b5b2ac')
    pages.append(page)
pages[0].save(directory / 'Crownfall-Quest-All-Screens.pdf', save_all=True, append_images=pages[1:], resolution=120, quality=92)

cards = []
for item in captures:
    title, group, filename = (html.escape(item[key], quote=True) for key in ['title', 'group', 'filename'])
    cards.append(f'<article data-group="{group}"><a href="{filename}" target="_blank" rel="noopener"><img src="{filename}" alt="{title}" loading="lazy"></a><div><p>{group}</p><h2>{title}</h2><a href="{filename}" download>Download PNG · {item["width"]}×{item["height"]}</a></div></article>')
buttons = '<button aria-pressed="true" data-filter="All">All</button>' + ''.join(f'<button aria-pressed="false" data-filter="{html.escape(g, quote=True)}">{html.escape(g)}</button>' for g in groups)
document = f'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Crownfall Quest — All Screens</title>
<style>
:root{{color-scheme:dark;font-family:system-ui,sans-serif;background:#100d08;color:#cdc6b8}}body{{margin:0;padding:32px;max-width:1680px;margin-inline:auto}}h1{{font-size:clamp(28px,4vw,54px);font-weight:600;color:#d49130;margin:12px 0}}header p{{max-width:850px;line-height:1.6}}a{{color:#e4ba7a}}nav{{display:flex;gap:10px;flex-wrap:wrap;margin:28px 0}}button{{font:inherit;color:#cdc6b8;border:1px solid #bf791a;background:#32291a;padding:12px 18px;cursor:pointer}}button[aria-pressed=true]{{color:#100d08;background:#f87b00}}.screens{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:22px}}article{{border:1px solid #bf791a55;background:#1d170e;overflow:hidden}}article img{{display:block;width:100%;height:auto}}article div{{padding:18px}}article p{{color:#b5b2ac;margin:0;font-size:13px}}h2{{font-size:22px;font-weight:600;margin:8px 0 16px}}[hidden]{{display:none}}a:focus-visible,button:focus-visible{{outline:3px solid #63edce;outline-offset:4px}}
</style>
<header><p>CROWNFALL / QUEST</p><h1>Every Quest screen</h1><p>{len(captures)} actual runtime screenshots: main menus, all six settings categories, Showcase and arenas, mode/Home/chapter dialogs, onboarding, the complete visit and pause. Images use the browser emulator with a closer capture view for reading; they are not physical-headset photographs. Development controls and hand visualization remain visible.</p><p><a href="Crownfall-Quest-All-Screens.pdf">Open the complete PDF</a> · <a href="overview.jpg">Main-menu overview</a> · <a href="manifest.json">Capture details</a></p></header>
<nav aria-label="Filter screenshots">{buttons}</nav><main class="screens">{''.join(cards)}</main>
<script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{{document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-group]').forEach(card=>card.hidden=button.dataset.filter!=='All'&&card.dataset.group!==button.dataset.filter)}}));</script></html>'''
(directory / 'index.html').write_text(document + '\n')

readme = [f'# Crownfall Quest — {len(captures)} screens', '', 'Actual browser-emulator screenshots, using mono rendering and a closer capture field of view for readability. These are not physical-headset photographs. No product layout was changed. Development controls and hand visualization remain visible. Browser entry is a flat preview; the other captures use an active emulated immersive session.', '', '[Complete PDF](Crownfall-Quest-All-Screens.pdf) · [Download gallery](Crownfall-Quest-Screens.zip) · [Capture details](manifest.json)', '', '![Four main Quest menus](overview.jpg)', '']
for group in groups:
    readme += [f'## {group}', '']
    for item in captures:
        if item['group'] == group:
            readme += [f'### {item["title"]}', '', f'![{item["title"]}]({item["filename"]})', '']
(directory / 'README.md').write_text('\n'.join(readme))

with ZipFile(directory / 'Crownfall-Quest-Screens.zip', 'w', ZIP_DEFLATED) as archive:
    for item in captures:
        archive.write(directory / item['filename'], item['filename'])
    for name in ['index.html', 'manifest.json', 'README.md', 'overview.jpg', 'Crownfall-Quest-All-Screens.pdf']:
        archive.write(directory / name, name)
print(f'Packaged {len(captures)} verified PNGs, gallery, PDF, overview and ZIP in {directory}')
