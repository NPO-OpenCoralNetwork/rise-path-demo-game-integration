import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static guards for the legacy lesson readers (GeneratedDocView / VibeDocView) until they are
// replaced by the new LessonReader. They keep the Mermaid XSS path closed and the debug noise out.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CODE_DIRS = ['components', 'context', 'hooks', 'services', 'shared', 'server', 'mcp-server', 'scripts', 'tools', 'content', 'data'];
const CODE_EXT = /\.(?:[cm]?js|tsx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

const listCodeFiles = (dir) => {
  const out = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (CODE_EXT.test(entry.name)) out.push(full);
    }
  };
  if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
  return out;
};

const READERS = [
  'components/features/ai/GeneratedDocView.tsx',
  'components/features/programming/VibeDocView.tsx',
];

describe('legacy reader hardening', () => {
  it('no source file configures Mermaid with securityLevel "loose"', () => {
    const rootFiles = fs.readdirSync(ROOT).filter((name) => CODE_EXT.test(name)).map((name) => path.join(ROOT, name));
    const files = [...rootFiles, ...CODE_DIRS.flatMap(listCodeFiles)];
    assert.ok(files.length > 100, 'expected to scan the code tree');
    const offenders = files
      .filter((file) => /securityLevel['"]?\s*:\s*['"]loose['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    assert.deepEqual(offenders, []);
  });

  for (const rel of READERS) {
    it(`${path.basename(rel)} renders Mermaid in strict mode and sanitizes the SVG`, () => {
      const src = read(rel);
      assert.match(src, /securityLevel:\s*'strict'/);
      assert.match(src, /DOMPurify\.sanitize\(/);
      // Every injected SVG goes through the sanitizer before reaching dangerouslySetInnerHTML.
      assert.match(src, /setSvgContent\(sanitizeMermaidSvg\(svg\)\)/);
      assert.doesNotMatch(src, /setSvgContent\(svg\)/);
      assert.doesNotMatch(src, /setSvgContent\(`</, 'error states must not inject HTML strings');
    });

    it(`${path.basename(rel)} renders numbered lists as a real <ol>`, () => {
      const src = read(rel);
      assert.match(src, /<ol className="[^"]*list-decimal/);
      assert.doesNotMatch(src, /<ul className=\{`[^`]*list-decimal/);
    });

    it(`${path.basename(rel)} has no console.log debugging`, () => {
      assert.doesNotMatch(read(rel), /console\.log\(/);
    });
  }

  it('VibeDocView takes the language from LanguageContext and the chapter badge from data', () => {
    const src = read('components/features/programming/VibeDocView.tsx');
    assert.match(src, /const \{ language, setLanguage \} = useLanguage\(\)/);
    assert.doesNotMatch(src, />\s*Chapter 1\s*</);
    assert.match(src, /case 'table':/);
  });

  it('readers only offer the Slides tab after the deck responds as a PDF or image', () => {
    assert.match(read('components/features/programming/VibeDocView.tsx'), /method: 'HEAD'/);
    const generated = read('components/features/ai/GeneratedDocView.tsx');
    assert.match(generated, /method: 'HEAD'/);
    assert.match(generated, /const hasSlides = slideDeckAvailable &&/);
    assert.doesNotMatch(generated, /Failed to load PDF/);
  });

  it('learner-facing course screens do not show model names or a model picker', () => {
    const courseView = read('components/features/ai/GeneratedCourseView.tsx');
    assert.doesNotMatch(courseView, /Gemini \d/);
    const generator = read('components/features/ai/CourseGeneratorView.tsx');
    assert.doesNotMatch(generator, /modelType|Current Engine/);
    assert.match(generator, /classifyAiError/);
  });

  it('wrappers and the curriculum adapter do not log course payloads', () => {
    for (const rel of [
      'components/wrappers/GeneratedLessonViewWrapper.tsx',
      'components/wrappers/GeneratedCourseViewWrapper.tsx',
      'services/curriculumAdapter.ts',
    ]) {
      assert.doesNotMatch(read(rel), /console\.log\(/, rel);
    }
  });
});
