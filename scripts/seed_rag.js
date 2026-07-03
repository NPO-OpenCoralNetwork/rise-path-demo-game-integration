#!/usr/bin/env node
/**
 * RAG Seed Script — Phase 13-B
 * 
 * Inserts doc/ markdown files into materials + material_chunks
 * for RAG search functionality.
 * 
 * Usage: node scripts/seed_rag.js
 */
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_PHASE1,
});

const USER_ID = process.env.PHASE1_USER_ID || '00000000-0000-0000-0000-000000000001';

// Files to ingest (path relative to project root, domain, title)
const SEED_FILES = [
  { file: 'doc/chapter_00_ai_game_dev_philosophy.md', domain: 'unity', title: 'AI Game Dev Philosophy' },
  { file: 'doc/chapter_01_unity_basics.md', domain: 'unity', title: 'Unity Basics' },
  { file: 'doc/chapter_02_monobehaviour_csharp.md', domain: 'unity', title: 'MonoBehaviour & C#' },
  { file: 'doc/chapter_03_ai_unity_coding.md', domain: 'unity', title: 'AI x Unity Coding' },
  { file: 'doc/chapter_04_prefab_design.md', domain: 'unity', title: 'Prefab Design' },
  { file: 'doc/chapter_05_ui_state_management.md', domain: 'unity', title: 'UI & State Management' },
  { file: 'doc/chapter_06_render_pipeline.md', domain: 'unity', title: 'Render Pipeline' },
  { file: 'doc/chapter_07_performance_basics.md', domain: 'unity', title: 'Performance Basics' },
  { file: 'doc/chapter_08_scene_load_strategy.md', domain: 'unity', title: 'Scene Load Strategy' },
  { file: 'doc/chapter_09_unity_web_api.md', domain: 'unity', title: 'Unity Web API' },
  { file: 'doc/chapter_10_team_dev_review.md', domain: 'unity', title: 'Team Dev & Review' },
  { file: 'doc/chapter_11_final_project.md', domain: 'unity', title: 'Final Project' },
  { file: 'doc/chapter_12_deployment.md', domain: 'unity', title: 'Deployment' },
  { file: 'doc/multi_format_curriculum_design.md', domain: 'general', title: 'Multi-Format Curriculum Design' },
  { file: 'doc/usage_guide.md', domain: 'general', title: 'Rise Path Usage Guide' },
];

function chunkText(text, chunkSize = 800, overlap = 150) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastPara = slice.lastIndexOf('\n\n');
      const lastNl = slice.lastIndexOf('\n');
      const bp = lastPara > chunkSize * 0.4 ? lastPara
        : lastNl > chunkSize * 0.4 ? lastNl : -1;
      if (bp > 0) end = start + bp + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

async function seedFile({ file, domain, title }) {
  const filePath = path.resolve(PROJECT_ROOT, file);
  
  try {
    await fs.access(filePath);
  } catch {
    console.log(`  ⚠ Skip (not found): ${file}`);
    return 0;
  }

  const text = await fs.readFile(filePath, 'utf8');
  const chunks = chunkText(text);

  // Check if already seeded
  const existing = await pool.query(
    "SELECT id FROM materials WHERE title = $1 AND user_id = CAST($2 AS uuid)",
    [title, USER_ID]
  );
  
  if (existing.rowCount > 0) {
    console.log(`  ✓ Already exists: ${title} (${existing.rows[0].id})`);
    return 0;
  }

  // Insert material
  const matResult = await pool.query(
    `INSERT INTO materials (user_id, title, status, domain)
     VALUES (CAST($1 AS uuid), $2, 'ready', $3)
     RETURNING id`,
    [USER_ID, title, domain]
  );
  const materialId = matResult.rows[0].id;

  // Insert chunks (without embedding for now — keyword search works)
  for (let i = 0; i < chunks.length; i++) {
    await pool.query(
      `INSERT INTO material_chunks (material_id, user_id, title, content, domain, chunk_index, status)
       VALUES ($1, CAST($2 AS uuid), $3, $4, $5, $6, 'ready')`,
      [materialId, USER_ID, title, chunks[i], domain, i]
    );
  }

  console.log(`  ✓ ${title}: ${chunks.length} chunks → material_chunks`);
  return chunks.length;
}

async function main() {
  console.log('=== RAG Seed Script (Phase 13-B) ===\n');
  
  let totalChunks = 0;
  for (const entry of SEED_FILES) {
    totalChunks += await seedFile(entry);
  }

  console.log(`\n=== Done: ${totalChunks} chunks inserted ===`);
  await pool.end();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
