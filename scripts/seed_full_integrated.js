import pg from 'pg';
import fs from 'fs/promises';

const { Pool } = pg;

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

const FULL_COURSES = [
    // 1. Vibe Coding
    {
        id: 'vibe-coding',
        title: { en: 'Vibe Coding', jp: '没入型コード体験' },
        description: { en: 'Story-driven learning through Git and OSS.', jp: 'GitとOSSの世界を冒険する、新感覚のストーリー学習。' },
        category: 'Coding',
        thumbnail: 'https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800',
        color: 'bg-purple-500',
        modules: [
            { id: 'ch0', title: { en: 'Chapter 0: Sharing the Premise', jp: '第0章｜この時代の前提を共有する' }, desc: { en: 'Why "No-Code" development works now.', jp: 'なぜ「コードを書かない開発」が成立するのか。' }, duration: 30 },
            { id: 'ch1', title: { en: 'Chapter 1: Minimum Viable Knowledge', jp: '第1章｜人間が理解すべき最低ライン' }, desc: { en: 'Frontend, Backend, DB, and Git.', jp: 'フロントエンド / バックエンド / DBの関係。' }, duration: 45 },
            { id: 'ch2', title: { en: 'Chapter 2: Planning with AI', jp: '第2章｜AIと企画する力を身につける' }, desc: { en: 'Wall-boarding with ChatGPT.', jp: 'ChatGPTとの壁打ち設計術。' }, duration: 60 },
            { id: 'ch3', title: { en: 'Chapter 3: The Development Cockpit', jp: '第3章｜開発環境コックピット' }, desc: { en: 'Setting up VSCode and Cursor.', jp: 'VSCodeの導入とAIネイティブエディタCursorの活用法。' }, duration: 45 },
            { id: 'ch4', title: { en: 'Chapter 4: Generating Frontend', jp: '第4章｜フロントエンドをAIで生成する' }, desc: { en: 'Google AI Studio basics.', jp: 'Google AI Studioの基本操作。' }, duration: 90 },
            { id: 'ch5', title: { en: 'Chapter 5: GitHub Workflow', jp: '第5章｜GitHubワークフロー完全理解' }, desc: { en: 'Understanding Repositories and Commits.', jp: 'リポジトリとは何か。AI開発でGitが必須な理由。' }, duration: 60 },
            { id: 'ch6', title: { en: 'Chapter 6: Vibe Coding with CLI', jp: '第6章｜Gemini CLIによるバイブコーディング' }, desc: { en: 'Implementing logic with natural language.', jp: '自然言語でコードを実装する。' }, duration: 120 },
            { id: 'ch7', title: { en: 'Chapter 7: Data with Supabase', jp: '第7章｜Supabaseでデータを持たせる' }, desc: { en: 'Auth, DB, Storage.', jp: 'PostgreSQLの超基礎理解。' }, duration: 120 },
            { id: 'ch8', title: { en: 'Chapter 8: Deployment', jp: '第8章｜デプロイして“世界に出す”' }, desc: { en: 'Releasing to Vercel and Render.', jp: 'VercelとRenderでの公開手法。' }, duration: 45 },
            { id: 'ch9', title: { en: 'Chapter 9: Failure & Debugging', jp: '第9章｜失敗と修正を前提にした開発' }, desc: { en: 'How to deal with AI breaking things.', jp: 'AIが壊すポイントとエラーとの付き合い方。' }, duration: 60 },
            { id: 'ch10', title: { en: 'Chapter 10: Advanced Application', jp: '第10章｜応用：ゲーム・サービス開発へ' }, desc: { en: 'Applied Game/Service Development.', jp: 'リアルタイム処理の考え方。' }, duration: 90 },
            { id: 'ch11', title: { en: 'Chapter 11: Future Learning', jp: '第11章｜これからの学び方' }, desc: { en: 'What not to learn.', jp: 'プログラミングをどう学ぶか（学ばなくていい範囲）。' }, duration: 30 }
        ]
    },
    // 2. Blender 3D
    {
        id: 'blender-3d',
        title: { en: 'Blender 3D', jp: '3Dモデリング' },
        description: { en: 'Basics of 3D creation and spatial design with Blender.', jp: 'Blenderを使った3DCG制作と空間デザインの基礎。' },
        category: 'Design',
        thumbnail: 'https://images.unsplash.com/photo-1617791160536-598cf32026fb?auto=format&fit=crop&q=80&w=800',
        color: 'bg-orange-500',
        modules: [
            { id: 'b1', title: { en: 'First Steps in 3D', jp: '3Dの第一歩' }, desc: { en: 'Master viewport navigation.', jp: 'ビューポート操作、オブジェクト移動（G/R/S）。' }, duration: 60 },
            { id: 'b2', title: { en: 'Modeling Basics', jp: 'モデリングの基礎' }, desc: { en: 'Shape forms with extrude and inset.', jp: '編集モード、押し出し・インセット・ベベル。' }, duration: 120 },
            { id: 'b3', title: { en: 'Advanced Modeling', jp: '上級モデリング' }, desc: { en: 'Arrays, booleans, and sculpting.', jp: '配列モディファイアやブーリアン操作。' }, duration: 180 },
            { id: 'b4', title: { en: 'Finishing & Render', jp: '仕上げとレンダー' }, desc: { en: 'Polish materials and lighting.', jp: '質感設定とライティング。' }, duration: 120 }
        ]
    },
    // 3. Art Atelier
    {
        id: 'art-atelier',
        title: { en: 'Art Atelier', jp: '美術史 & 哲学' },
        description: { en: 'Explore the history and theory of visual arts.', jp: '視覚芸術の歴史と理論。クリエイティブの源泉を探る。' },
        category: 'Art',
        thumbnail: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&q=80&w=800',
        color: 'bg-stone-500',
        modules: [
            { id: 'a1', title: { en: 'The Foundations', jp: '礎（いしずえ）' }, desc: { en: 'Prehistory - Middle Ages', jp: '先史時代 - 中世' }, duration: 60 },
            { id: 'a2', title: { en: 'The Awakening', jp: '覚醒' }, desc: { en: 'Renaissance - Realism', jp: 'ルネサンス - 写実主義' }, duration: 60 },
            { id: 'a3', title: { en: 'The Breakdown', jp: '解体' }, desc: { en: 'Modern Art', jp: 'モダンアート' }, duration: 60 },
            { id: 'a4', title: { en: 'Now & Future', jp: '現在と未来' }, desc: { en: 'Contemporary - Tomorrow', jp: '現代 - 明日' }, duration: 60 }
        ]
    },
    // 4. Web Basics
    {
        id: 'web-basics',
        title: { en: 'Web Basics', jp: 'Web開発の基礎' },
        description: { en: 'From HTML, CSS, and React basics.', jp: 'HTML, CSS, Reactの基礎からモダンなUI構築まで。' },
        category: 'Programming',
        thumbnail: 'https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&q=80&w=800',
        color: 'bg-cyan-500',
        modules: [
            { id: 'w1', title: { en: 'HTML & CSS', jp: 'HTML & CSS' }, desc: { en: 'Structure and Style', jp: '構造とスタイル' }, duration: 60 },
            { id: 'w2', title: { en: 'JavaScript Basics', jp: 'JavaScript基礎' }, desc: { en: 'Interactivity and Logic', jp: 'インタラクティブ性とロジック' }, duration: 90 },
            { id: 'w3', title: { en: 'React Fundamentals', jp: 'Reactの基本' }, desc: { en: 'Components and State', jp: 'コンポーネントと状態管理' }, duration: 120 }
        ]
    },
    // 5. Gen AI Camp
    {
        id: 'gen-ai-camp',
        title: { en: 'Gen AI Camp', jp: '生成AI & Python' },
        description: { en: 'Learn how LLMs work.', jp: 'LLMの仕組みとPythonによるAIアプリケーション開発。' },
        category: 'AI',
        thumbnail: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&q=80&w=800',
        color: 'bg-yellow-500',
        modules: [
            { id: 'g1', title: { en: 'LLM Basics', jp: 'LLMの基礎' }, desc: { en: 'Transformers and Tokens', jp: 'Transformerとトークン' }, duration: 60 },
            { id: 'g2', title: { en: 'Prompt Engineering', jp: 'プロンプトエンジニアリング' }, desc: { en: 'Optimizing inputs', jp: '入力の最適化' }, duration: 60 },
            { id: 'g3', title: { en: 'Python API', jp: 'Python API' }, desc: { en: 'Building apps', jp: 'アプリ構築' }, duration: 120 }
        ]
    }
];

async function seedFull() {
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
        await client.query(
            'insert into auth.users (id) values ($1) on conflict do nothing',
            [PHASE1_USER_ID]
        );

        for (const course of FULL_COURSES) {
            console.log(`Seeding ${course.id}...`);
            
            const titleStr = course.title.en; 
            
            // Check existing by title or similar
            const existing = await client.query('SELECT id FROM curricula WHERE title = $1', [titleStr]);
            let curriculumId;
            
            if (existing.rowCount > 0) {
                curriculumId = existing.rows[0].id;
                // Update meta
                await client.query(
                    `UPDATE curricula 
                     SET description = $2, category = $3, thumbnail = $4, color = $5, total_lessons = $6 
                     WHERE id = $1`,
                    [curriculumId, course.description.en, course.category, course.thumbnail, course.color, course.modules.length]
                );
            } else {
                const res = await client.query(
                    `INSERT INTO curricula (user_id, title, description, category, thumbnail, color, total_lessons)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING id`,
                    [PHASE1_USER_ID, titleStr, course.description.en, course.category, course.thumbnail, course.color, course.modules.length]
                );
                curriculumId = res.rows[0].id;
            }

            // Construct Content JSON
            const content = {
                ui_template_id: 'vibe_coding',
                title: course.title,
                description: course.description,
                modules: course.modules.map((m, i) => ({
                    module_id: m.id || `m${i+1}`,
                    title: m.title.en, // Or localized object if supported by frontend
                    objective: m.desc.en,
                    estimated_hours: (m.duration / 60),
                    module_ui_hints: {
                        card_title: m.title.en, // Frontend uses this or title
                        card_text: m.desc.en,
                        tags: [course.category],
                        difficulty: 'intermediate'
                    },
                    lessons: [
                        {
                            lesson_id: `${m.id}-l1`,
                            summary: m.desc.en,
                            estimated_min: m.duration,
                            ui_hints: {
                                card_title: m.title.en,
                                card_text: m.desc.en,
                                cta: 'Start',
                                difficulty: 'easy',
                                time: `${m.duration} min`,
                                tags: []
                            },
                            doc_blocks: [
                                { type: 'text', content: m.desc.jp || m.desc.en }
                            ],
                            unlock_rule: 'immediate',
                            retry_policy: 'none'
                        }
                    ]
                }))
            };

            const versionRes = await client.query(
                `INSERT INTO curriculum_versions (curriculum_id, version, status, content_json)
                 VALUES ($1, 1, 'approved', $2)
                 ON CONFLICT (curriculum_id, version) 
                 DO UPDATE SET content_json = EXCLUDED.content_json
                 RETURNING id`,
                [curriculumId, JSON.stringify(content)]
            );
            
            const versionId = versionRes.rows[0].id;
            await client.query('UPDATE curricula SET current_version_id = $1 WHERE id = $2', [versionId, curriculumId]);
        }

        await client.query('COMMIT');
        console.log("Full Seeding complete.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Seeding failed:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

seedFull();
