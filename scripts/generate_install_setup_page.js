import fs from 'node:fs/promises';
import path from 'node:path';
import { bm25Search, loadImageIndex, DEFAULT_INDEX_PATH } from './blender_image_search_utils.js';

const MANUAL_ROOT = path.join(
  process.cwd(),
  'data/curricula/blender/blender_manual_v500_en.html'
);
const OUTPUT_HTML = path.join(
  process.cwd(),
  'public/debug/blender_install_setup_sample.html'
);
const OUTPUT_IMAGE_DIR = path.join(
  process.cwd(),
  'public/data/curricula/blender/_images_test'
);

const DEFAULT_QUERY = 'Blender install setup language preferences';
const IMAGE_LIMIT = 30;

const preferFile = (record, keywords) => {
  const hay = `${record.file || ''} ${record.headingPath || ''} ${record.pageTitle || ''}`.toLowerCase();
  return keywords.some((kw) => hay.includes(kw));
};

const pickImageForQuery = (records, query, used, preferKeywords) => {
  const ranked = bm25Search(records, query, IMAGE_LIMIT);
  const preferred = ranked.find(({ record }) => !used.has(record.image) && preferFile(record, preferKeywords));
  if (preferred) return preferred.record;
  const fallback = ranked.find(({ record }) => !used.has(record.image));
  return fallback ? fallback.record : null;
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const clearDir = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => fs.unlink(path.join(dir, entry.name)))
  );
};

const copyImage = async (imagePath, index) => {
  const src = path.join(MANUAL_ROOT, imagePath);
  const base = path.posix.basename(imagePath);
  const filename = `${index + 1}-${base}`;
  const dest = path.join(OUTPUT_IMAGE_DIR, filename);
  await fs.copyFile(src, dest);
  return `/data/curricula/blender/_images_test/${filename}`;
};

const buildHtml = (steps, images) => {
  const stepBlocks = steps
    .map((step, idx) => {
      const image = images[idx];
      const figure = image
        ? `
          <figure>
            <img src="${image.src}" alt="${image.caption || 'Blender image'}" />
            <figcaption>${image.caption || 'Reference image from Blender manual.'}</figcaption>
            <div class="meta">${image.heading || ''}</div>
          </figure>
        `
        : `
          <div class="placeholder">
            <div class="placeholder-box">Image pending</div>
          </div>
        `;
      return `
        <section class="card">
          <div class="step">
            <div class="step-title">${step.title}</div>
            <p>${step.body}</p>
          </div>
          ${figure}
        </section>
      `;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blender Install Setup (Sample)</title>
    <style>
      :root {
        --bg: #0f172a;
        --card: #111827;
        --accent: #38bdf8;
        --text: #e2e8f0;
        --muted: #94a3b8;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Trebuchet MS", "Gill Sans", "Arial", sans-serif;
        background: radial-gradient(circle at top, #1e293b, #0f172a 70%);
        color: var(--text);
      }
      header {
        padding: 48px 24px 20px;
        text-align: center;
      }
      header h1 {
        margin: 0 0 12px;
        font-size: 2.4rem;
        letter-spacing: 0.04em;
      }
      header p {
        margin: 0 auto;
        max-width: 640px;
        color: var(--muted);
        font-size: 1rem;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 24px;
        display: grid;
        gap: 20px;
      }
      .card {
        background: rgba(17, 24, 39, 0.9);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 20px;
        padding: 24px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
        align-items: center;
      }
      .step-title {
        font-size: 1.3rem;
        font-weight: 700;
        color: var(--accent);
        margin-bottom: 10px;
      }
      .card p {
        color: var(--text);
        line-height: 1.6;
      }
      figure {
        margin: 0;
        display: grid;
        gap: 8px;
      }
      img {
        width: 100%;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: #0b1220;
      }
      figcaption {
        font-size: 0.9rem;
        color: var(--muted);
      }
      .meta {
        font-size: 0.8rem;
        color: var(--muted);
      }
      .placeholder {
        display: grid;
        place-items: center;
        padding: 24px;
        border-radius: 16px;
        border: 1px dashed rgba(148, 163, 184, 0.4);
      }
      .placeholder-box {
        width: 100%;
        height: 160px;
        border-radius: 12px;
        background: rgba(148, 163, 184, 0.15);
        display: grid;
        place-items: center;
        color: var(--muted);
        font-size: 0.9rem;
      }
      @media (max-width: 840px) {
        .card {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Blender Install Setup</h1>
      <p>A lightweight sample page generated from Blender manual images and metadata.</p>
    </header>
    <main>
      ${stepBlocks}
    </main>
  </body>
</html>`;
};

const main = async () => {
  const query = process.argv.slice(2).join(' ').trim() || DEFAULT_QUERY;
  const records = await loadImageIndex(DEFAULT_INDEX_PATH);

  await ensureDir(path.dirname(OUTPUT_HTML));
  await ensureDir(OUTPUT_IMAGE_DIR);
  await clearDir(OUTPUT_IMAGE_DIR);

  const steps = [
    {
      title: 'Step 1: Download Blender',
      body: 'Visit the official Blender site and download the latest stable installer for your OS.',
      query: 'download blender',
      prefer: ['download', 'getting_started']
    },
    {
      title: 'Step 2: Run the Installer',
      body: 'Follow the installer prompts and keep the default options for a clean setup.',
      query: 'install windows blender',
      prefer: ['install_windows', 'install', 'installing']
    },
    {
      title: 'Step 3: Set Language Preferences',
      body: 'Open Preferences, then choose your UI language and save the settings.',
      query: 'Blender preferences interface',
      prefer: ['preferences']
    }
  ];

  const used = new Set();
  const images = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const record = pickImageForQuery(records, step.query || query, used, step.prefer || []);
    if (!record) {
      images.push(null);
      continue;
    }
    used.add(record.image);
    const src = await copyImage(record.image, i);
    images.push({
      src,
      caption: record.caption || record.alt || '',
      heading: record.headingPath || record.pageTitle || ''
    });
  }

  const html = buildHtml(steps, images);
  await fs.writeFile(OUTPUT_HTML, html, 'utf8');
  console.log(`Wrote sample page to ${OUTPUT_HTML}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
