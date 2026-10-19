#!/usr/bin/env python3
"""Turns generated P-School art into the game's WebP assets under public/p_school/assets/v2/.

Usage:
    python3 scripts/assets/prepare-pschool-art.py <dir> [<dir> ...]

Each <dir> holds try-image-models.mjs output named stageNN-enemy__<model>.png and
stageNN-bg__<model>.png; when a file is in several dirs, the later dir wins (for regenerated
images). Stage 1 and the hero come from the new-style assets already in public/p_school/assets/.

Sprites: transparent margins trimmed (a 2% border kept), longest side at most 1024 px, WebP with
alpha. Backgrounds: longest side at most 1920 px, WebP. Needs Pillow.
"""
import glob
import os
import re
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'public', 'p_school', 'assets')
OUT = os.path.join(ASSETS, 'v2')
SPRITE_MAX = 1024
BACKGROUND_MAX = 1920


def fit(image, longest):
    scale = min(1.0, longest / max(image.size))
    if scale == 1.0:
        return image
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)


def sprite(source, target):
    image = Image.open(source).convert('RGBA')
    box = image.getchannel('A').point(lambda a: 255 if a > 10 else 0).getbbox()
    if box:
        pad = round(max(box[2] - box[0], box[3] - box[1]) * 0.02)
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(image.width, box[2] + pad), min(image.height, box[3] + pad))
        image = image.crop(box)
    fit(image, SPRITE_MAX).save(target, 'WEBP', quality=88, method=6)


def background(source, target):
    fit(Image.open(source).convert('RGB'), BACKGROUND_MAX).save(target, 'WEBP', quality=84, method=6)


def main(dirs):
    if not dirs:
        sys.exit(__doc__)
    sources = {}
    for folder in dirs:
        for path in glob.glob(os.path.join(folder, 'stage*-*__*.png')):
            match = re.match(r'stage(\d+)-(enemy|bg)__', os.path.basename(path))
            if match:
                sources[(int(match.group(1)), match.group(2))] = path
    sources[(1, 'enemy')] = os.path.join(ASSETS, 'serirei01.png')
    sources[(1, 'bg')] = os.path.join(ASSETS, 'battle-seen01.jpeg')

    for sub in ('enemies', 'backgrounds', 'characters'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    jobs = [('hero', os.path.join(ASSETS, 'main-chara01_transparent.png'), os.path.join(OUT, 'characters', 'hero.webp'), sprite)]
    for stage in range(1, 21):
        for kind, sub, convert in (('enemy', 'enemies', sprite), ('bg', 'backgrounds', background)):
            source = sources.get((stage, kind))
            if not source:
                print(f'missing: stage {stage} {kind}')
                continue
            jobs.append((f'stage{stage:02d} {kind}', source, os.path.join(OUT, sub, f'stage{stage:02d}.webp'), convert))

    total = 0
    for label, source, target, convert in jobs:
        convert(source, target)
        size = os.path.getsize(target)
        total += size
        with Image.open(target) as done:
            print(f'{label:16s} {done.width}x{done.height} {size // 1024:4d} KB  <- {os.path.relpath(source, ROOT)}')
    print(f'{len(jobs)} files, {total / 1024 / 1024:.1f} MB in {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main(sys.argv[1:])
