
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const { Pool } = pg;

// Load env
const loadEnv = async () => {
  try {
    const raw = await fs.readFile('.env.local', 'utf8');
    raw.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2 && !line.trim().startsWith('#')) {
        const key = parts[0].trim().replace(/^export\s+/, '');
        const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    });
  } catch (e) { console.log("No .env.local found."); }
};

const PHASE1_USER_ID = '00000000-0000-0000-0000-000000000001';

const INITIAL_COURSES = [
    {
        id: 'web-basics',
        title: { en: 'Web Basics', jp: 'Web開発の基礎' },
        description: { en: 'From HTML, CSS, and React basics to modern UI build workflows.', jp: 'HTML, CSS, Reactの基礎からモダンなUI構築まで。' },
        category: 'Programming',
        thumbnail: 'https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&q=80&w=800',
        color: 'bg-cyan-500'
    },
    {
        id: 'gen-ai-camp',
        title: { en: 'Gen AI Camp', jp: '生成AI & Python' },
        description: { en: 'Learn how LLMs work and build AI apps with Python.', jp: 'LLMの仕組みとPythonによるAIアプリケーション開発。' },
        category: 'AI',
        thumbnail: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&q=80&w=800',
        color: 'bg-yellow-500'
    },
    {
        id: 'vibe-coding',
        title: { en: 'Vibe Coding', jp: '没入型コード体験' },
        description: { en: 'Story-driven learning through Git and OSS.', jp: 'GitとOSSの世界を冒険する、新感覚のストーリー学習。' },
        category: 'Coding',
        thumbnail: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800',
        color: 'bg-purple-500'
    },
    {
        id: 'blender-3d',
        title: { en: 'Blender 3D', jp: '3Dモデリング' },
        description: { en: 'Basics of 3D creation and spatial design with Blender.', jp: 'Blenderを使った3DCG制作と空間デザインの基礎。' },
        category: 'Design',
        thumbnail: 'https://images.unsplash.com/photo-1617791160536-598cf32026fb?auto=format&fit=crop&q=80&w=800',
        color: 'bg-orange-500'
    },
    {
        id: 'art-atelier',
        title: { en: 'Art Atelier', jp: '美術史 & 哲学' },
        description: { en: 'Explore the history and theory of visual arts.', jp: '視覚芸術の歴史と理論。クリエイティブの源泉を探る。' },
        category: 'Art',
        thumbnail: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&q=80&w=800',
        color: 'bg-stone-500'
    },
    {
        id: 'global-communication',
        title: { en: 'Global Communication', jp: '実践英語 & 異文化理解' },
        description: { en: 'Practical English for engineers, from docs to technical discussions.', jp: 'エンジニアのための実践的英語力。ドキュメント読解から技術的な議論まで。' },
        category: 'English',
        thumbnail: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=800',
        color: 'bg-teal-500'
    },
    {
        id: 'scratch-game',
        title: { en: 'Scratch game', jp: 'ブロックプログラミングRPG' },
        description: { en: 'Learn programming by building battle scripts with Scratch-style blocks.', jp: 'Scratchブロックでバトルの作戦を組み、遊びながらプログラミングを学ぶ。' },
        category: 'Game',
        thumbnail: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=800',
        color: 'bg-green-500'
    },
    {
        id: 'unity-ai',
        title: { en: 'Unity AI Game Dev', jp: 'AI x Unity ゲーム開発' },
        description: { en: 'Develop games using Unity and AI. Learn the role of an architect.', jp: 'AIと共にUnityでゲームを作る。コードを書くのではなく、設計する力を養う。' },
        category: 'Unity',
        thumbnail: 'https://images.unsplash.com/photo-1596727147705-54a9d0a514d7?auto=format&fit=crop&q=80&w=800',
        color: 'bg-blue-500'
    }
];

async function seed() {
    await loadEnv();
    const phase1DatabaseUrl = process.env.DATABASE_URL_PHASE1;
    if (!phase1DatabaseUrl) {
        console.error("DATABASE_URL_PHASE1 missing");
        process.exit(1);
    }

    const pool = new Pool({ connectionString: phase1DatabaseUrl });
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        
        // Ensure user exists
        await client.query(
            'insert into auth.users (id) values ($1) on conflict do nothing',
            [PHASE1_USER_ID]
        );

        for (const course of INITIAL_COURSES) {
            console.log(`Seeding ${course.id}...`);
            
            // Upsert into curricula
            // Note: DB schema expects title/description as TEXT, but we have JSON.
            // server.js handles JSON stringify on read?
            // Actually server.js `api/v2/curricula` returns raw rows.
            // But `LearningHub` expects localized text?
            // The `curricula` table in `local_postgres_phase1.sql` says `title text`, `description text`.
            // But `learning_portals` table has `title jsonb`.
            
            // We are migrating to `curricula` table which is the new standard.
            // I will store the JSON string in the text column for now, or just the English title?
            // Wait, `server.js` `normalizeCourseInput` handles `title` as string.
            // Let's store JSON string in the text column so frontend can parse if it expects JSON, 
            // OR we store simple string.
            // The existing `curricula` table has `title text`.
            // Let's check `CourseList.tsx` again. It expects `title` as string.
            
            // To support both, I will store JSON string in the text column.
            // The API `/api/v2/curricula` returns it as is.
            // `CourseList.tsx` might display "[object Object]" if it expects string.
            
            // Strategy: Store English title in `title` column. Store full localized object in `content_json` of the version.
            // But `CourseList` uses `title` from `curricula`.
            // I will use English title for now to keep it simple and compatible with `CourseList`.
            
            const titleStr = course.title.en; // Simple string
            const descStr = course.description.en;

            // Insert Curriculum
            // We use UUID for ID in `curricula` table?
            // Schema: `id uuid primary key default gen_random_uuid()`.
            // But `INITIAL_COURSES` have string IDs like 'web-basics'.
            // UUID is required. I must generate UUIDs or use a consistent UUID mapping.
            // I will let Postgres generate UUIDs, but check by title if exists to avoid duplicates.
            
            // Check if exists
            const existing = await client.query('SELECT id FROM curricula WHERE title = $1', [titleStr]);
            let curriculumId;
            
            if (existing.rowCount > 0) {
                curriculumId = existing.rows[0].id;
                console.log(`  -> Exists (${curriculumId})`);
            } else {
                const res = await client.query(
                    `INSERT INTO curricula (user_id, title, description, category, thumbnail, color)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id`,
                    [PHASE1_USER_ID, titleStr, descStr, course.category, course.thumbnail, course.color]
                );
                curriculumId = res.rows[0].id;
                console.log(`  -> Created (${curriculumId})`);
            }

            // Create initial version (Approved)
            const versionRes = await client.query(
                `INSERT INTO curriculum_versions (curriculum_id, version, status, content_json)
                 VALUES ($1, 1, 'approved', $2)
                 ON CONFLICT (curriculum_id, version) DO NOTHING
                 RETURNING id`,
                [curriculumId, JSON.stringify({
                    title: course.title, // Store localized title in content
                    description: course.description,
                    modules: [] // Empty modules for now
                })]
            );
            
            if (versionRes.rowCount > 0) {
                const versionId = versionRes.rows[0].id;
                await client.query('UPDATE curricula SET current_version_id = $1 WHERE id = $2', [versionId, curriculumId]);
            }
        }

        await client.query('COMMIT');
        console.log("Seeding complete.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Seeding failed:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
