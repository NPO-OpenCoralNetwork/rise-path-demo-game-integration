import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'data/curricula/blender/blender_manual_v500_en.html');
const OUTPUT = path.join(process.cwd(), 'data/curricula/blender/index.jsonl');

const SEGMENT_SIZE = 1000; // characters
const OVERLAP = 120; // characters

const skipDirs = new Set(['_static', '_images', '_sources']);
const skipFiles = new Set(['genindex.html', 'search.html', 'versions.html', 'copyright.html', '404.html']);

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ');

const cleanHtml = (html) => {
  const articleMatch = html.match(/<article[^>]*id="furo-main-content"[^>]*>([\s\S]*?)<\/article>/i);
  if (!articleMatch) return null;
  let content = articleMatch[1];

  // Remove unwanted blocks
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  content = content.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  content = content.replace(/<figure[\s\S]*?<\/figure>/gi, '');

  const headings = [];
  const headingReplacer = (level) => (_, text) => {
    const decoded = decodeEntities(stripTags(text)).replace(/¶$/, '').trim();
    if (decoded) headings.push({ level, text: decoded });
    return `\n${'#'.repeat(level)} ${decoded}\n`;
  };

  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, headingReplacer(1));
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, headingReplacer(2));
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, headingReplacer(3));

  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${decodeEntities(stripTags(text)).trim()}\n`);
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${decodeEntities(stripTags(text)).trim()}`);
  content = content.replace(/<br\s*\/?>/gi, '\n');

  content = stripTags(content);
  content = decodeEntities(content);
  content = content.replace(/\r/g, '');
  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n{3,}/g, '\n\n').trim();

  if (!content || content.length < 80) return null;

  return { text: content, headings };
};

const segmentText = (text) => {
  const segments = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + SEGMENT_SIZE, text.length);
    const slice = text.slice(start, end).trim();
    if (slice.length > 80) {
      segments.push(slice);
    }
    if (end === text.length) break;
    start = end - OVERLAP;
  }
  return segments;
};

const collectHtmlFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.html') && !skipFiles.has(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

const main = async () => {
  const htmlFiles = await collectHtmlFiles(ROOT);
  const lines = [];

  for (const file of htmlFiles) {
    const relPath = path.relative(ROOT, file);
    const html = await fs.readFile(file, 'utf8');
    const cleaned = cleanHtml(html);
    if (!cleaned) continue;

    const { text, headings } = cleaned;
    const section = headings.find((h) => h.level === 1)?.text || headings[0]?.text || relPath;
    const segments = segmentText(text);

    const headingPath = headings.map((h) => h.text).join(' / ');

    segments.forEach((segment, idx) => {
      const record = {
        id: `blender-manual-v500-en::${relPath}::${idx + 1}`,
        source: 'Blender Manual',
        version: '5.0.0',
        language: 'en',
        file: relPath,
        section,
        headingPath,
        headings: headings.map((h) => h.text),
        text: segment
      };
      lines.push(JSON.stringify(record));
    });
  }

  await fs.writeFile(OUTPUT, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${lines.length} segments to ${OUTPUT}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
