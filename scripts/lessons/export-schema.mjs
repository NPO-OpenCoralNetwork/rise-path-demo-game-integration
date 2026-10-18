#!/usr/bin/env node
/**
 * Writes the JSON Schema files generated from shared/lesson/schema.js:
 *   content/schema/lesson.schema.json      full lesson schema (editors, MCP resource)
 *   content/schema/lesson.llm.schema.json  LLM structured-output profile (no recursion,
 *                                          additionalProperties:false, unsupported keywords removed)
 *   content/schema/course.schema.json      course schema
 *
 * Usage:
 *   npm run lessons:schema            # write the files
 *   npm run lessons:schema -- --check # exit 1 if a committed file is out of date
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lessonJsonSchema, courseJsonSchema } from '../../shared/lesson/jsonSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
export const SCHEMA_DIR = path.join(ROOT, 'content/schema');

/** @returns {Record<string, string>} file name → serialized schema */
export function schemaFiles() {
  /** @param {unknown} json */
  const serialize = (json) => `${JSON.stringify(json, null, 2)}\n`;
  return {
    'lesson.schema.json': serialize(lessonJsonSchema({ profile: 'full' })),
    'lesson.llm.schema.json': serialize(lessonJsonSchema({ profile: 'llm' })),
    'course.schema.json': serialize(courseJsonSchema()),
  };
}

async function main() {
  const check = process.argv.includes('--check');
  await fs.mkdir(SCHEMA_DIR, { recursive: true });
  let stale = 0;
  for (const [name, content] of Object.entries(schemaFiles())) {
    const file = path.join(SCHEMA_DIR, name);
    const rel = path.relative(ROOT, file);
    const current = await fs.readFile(file, 'utf8').catch(() => null);
    if (check) {
      if (current !== content) {
        stale += 1;
        console.error(`✗ ${rel} is out of date (run npm run lessons:schema)`);
      } else {
        console.log(`✓ ${rel}`);
      }
      continue;
    }
    if (current === content) {
      console.log(`= ${rel} (unchanged)`);
    } else {
      await fs.writeFile(file, content);
      console.log(`✓ ${rel} (${Math.round(content.length / 102.4) / 10} kB)`);
    }
  }
  process.exitCode = stale > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
