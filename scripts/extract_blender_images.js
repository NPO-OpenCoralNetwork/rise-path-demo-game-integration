import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'data/curricula/blender/blender_manual_v500_en.html');
const OUTPUT = path.join(process.cwd(), 'data/curricula/blender/image_index.jsonl');

const CONTEXT_LIMIT = 240;
const MAX_KEYWORDS = 14;
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'by', 'from', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its',
  'at', 'into', 'out', 'over', 'under', 'above', 'below', 'between', 'after', 'before',
  'about', 'within', 'without', 'via', 'using', 'use', 'used', 'using', 'example'
]);

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

const cleanText = (text) => {
  const cleaned = decodeEntities(stripTags(text)).replace(/\s+/g, ' ').trim();
  return cleaned.replace(/¶\s*$/, '').trim();
};

const extractArticle = (html) => {
  const match = html.match(/<article[^>]*id="furo-main-content"[^>]*>([\s\S]*?)<\/article>/i);
  return match ? match[1] : html;
};

const extractTitle = (html) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const title = cleanText(titleMatch[1]);
    if (title) return title;
  }
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1Match ? cleanText(h1Match[1]) : null;
};

const extractHeadings = (html) => {
  const headings = [];
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const match of html.matchAll(headingRe)) {
    const level = Number(match[1]);
    const text = cleanText(match[2]);
    if (!text) continue;
    headings.push({ level, text, index: match.index || 0 });
  }
  headings.sort((a, b) => a.index - b.index);
  return headings;
};

const extractFigureRanges = (html) => {
  const figures = [];
  const figureRe = /<figure\b[^>]*>[\s\S]*?<\/figure>/gi;
  for (const match of html.matchAll(figureRe)) {
    const start = match.index || 0;
    const end = start + match[0].length;
    const captionMatch = match[0].match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    const caption = captionMatch ? cleanText(captionMatch[1]) : null;
    figures.push({ start, end, caption: caption || null });
  }
  return figures;
};

const trimToLength = (text, maxLen) => {
  if (!text) return null;
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 3).trim()}...`;
};

const findPrevBlock = (html, pos) => {
  const slice = html.slice(0, pos);
  const blockRe = /<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  let last = null;
  while ((match = blockRe.exec(slice)) !== null) {
    last = match;
  }
  return last ? cleanText(last[2]) : null;
};

const findNextBlock = (html, pos) => {
  const slice = html.slice(pos);
  const blockRe = /<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  const match = blockRe.exec(slice);
  return match ? cleanText(match[2]) : null;
};

const normalizeImagePath = (relHtml, src) => {
  const posixRel = relHtml.split(path.sep).join('/');
  const baseDir = path.posix.dirname(posixRel);
  return path.posix.normalize(path.posix.join(baseDir, src));
};

const extractImages = (html, relHtml, figureRanges) => {
  const images = [];
  const imgRe = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imgRe)) {
    const tag = match[0];
    const pos = match.index || 0;
    const srcMatch = tag.match(/src=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    const normalized = normalizeImagePath(relHtml, srcMatch[1]);
    if (!normalized.startsWith('_images/')) continue;

    const altMatch = tag.match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? cleanText(altMatch[1]) : null;

    let caption = null;
    for (const fig of figureRanges) {
      if (pos >= fig.start && pos <= fig.end) {
        caption = fig.caption;
        break;
      }
    }

    images.push({ pos, image: normalized, alt: alt || null, caption: caption || null });
  }
  return images;
};

const attachContext = (images, html) => {
  images.forEach((image) => {
    const before = findPrevBlock(html, image.pos);
    const after = findNextBlock(html, image.pos + 1);
    image.contextBefore = trimToLength(before, CONTEXT_LIMIT);
    image.contextAfter = trimToLength(after, CONTEXT_LIMIT);
  });
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

const assignHeadings = (images, headings) => {
  const stack = [];
  let headingIndex = 0;
  for (const image of images) {
    while (headingIndex < headings.length && headings[headingIndex].index < image.pos) {
      const heading = headings[headingIndex];
      stack[heading.level - 1] = heading.text;
      for (let i = heading.level; i < stack.length; i++) {
        stack[i] = null;
      }
      headingIndex += 1;
    }
    image.headingPath = stack.filter(Boolean).join(' / ');
    image.headings = stack.filter(Boolean);
    image.section = stack[0] || null;
  }
};

const tokenize = (text) =>
  text
    .toLowerCase()
    .split(/[\s、。,.!?:"'()\\/\[\]-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

const pathTokens = (value) =>
  value
    .replace(/\.html$/i, '')
    .split(/[\\/]/)
    .flatMap((part) => part.split(/[_-]+/))
    .map((token) => token.trim())
    .filter(Boolean);

const buildKeywords = ({ caption, headingPath, pageTitle, contextBefore, contextAfter, alt, file, image }) => {
  const sources = [
    caption,
    headingPath,
    pageTitle,
    contextBefore,
    contextAfter,
    alt,
    ...pathTokens(file || ''),
    ...pathTokens(image || '')
  ]
    .filter(Boolean)
    .join(' ');

  const tokens = tokenize(sources);
  const keywords = [];
  const seen = new Set();
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    if (token.length <= 2) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
    if (keywords.length >= MAX_KEYWORDS) break;
  }
  return keywords;
};

const main = async () => {
  const htmlFiles = await collectHtmlFiles(ROOT);
  const lines = [];

  for (const file of htmlFiles) {
    const relPath = path.relative(ROOT, file);
    const relPosix = relPath.split(path.sep).join('/');
    const html = await fs.readFile(file, 'utf8');

    const pageTitle = extractTitle(html) || relPosix;
    const articleHtml = extractArticle(html);
    const headings = extractHeadings(articleHtml);
    const figureRanges = extractFigureRanges(articleHtml);
    const images = extractImages(articleHtml, relPosix, figureRanges).sort((a, b) => a.pos - b.pos);

    if (!images.length) continue;

    assignHeadings(images, headings);
    attachContext(images, articleHtml);

    images.forEach((image, idx) => {
      const keywords = buildKeywords({
        caption: image.caption,
        headingPath: image.headingPath,
        pageTitle,
        contextBefore: image.contextBefore,
        contextAfter: image.contextAfter,
        alt: image.alt,
        file: relPosix,
        image: image.image
      });
      const record = {
        id: `blender-manual-v500-en::${relPosix}::${path.posix.basename(image.image)}::${idx + 1}`,
        source: 'Blender Manual',
        version: '5.0.0',
        language: 'en',
        file: relPosix,
        pageTitle,
        section: image.section || pageTitle,
        headingPath: image.headingPath || '',
        headings: image.headings || [],
        image: image.image,
        caption: image.caption,
        alt: image.alt,
        contextBefore: image.contextBefore,
        contextAfter: image.contextAfter,
        keywords
      };
      lines.push(JSON.stringify(record));
    });
  }

  await fs.writeFile(OUTPUT, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${lines.length} image records to ${OUTPUT}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
