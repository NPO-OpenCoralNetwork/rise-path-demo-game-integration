-- ARCHIVE / REFERENCE ONLY — do not apply directly.
-- Canonical migrations: server/migrations/ (Issue #16)
-- Portal seed lives in: server/migrations/008_seed_learning_portals.sql
--
-- Local PostgreSQL schema for AI-generated curricula (legacy).

CREATE TABLE IF NOT EXISTS curricula (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text,
  duration text,
  total_lessons integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'AI Generated',
  thumbnail text,
  color text,
  model_used text,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS curricula_created_at_idx
  ON curricula (created_at DESC);

CREATE TABLE IF NOT EXISTS learning_portals (
  id text PRIMARY KEY,
  title jsonb NOT NULL,
  subtitle jsonb NOT NULL,
  description jsonb NOT NULL,
  view_state text NOT NULL,
  icon_key text NOT NULL,
  color_class text NOT NULL,
  bg_class text NOT NULL,
  border_class text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_portals_sort_idx
  ON learning_portals (sort_order, created_at DESC);

INSERT INTO learning_portals
  (id, title, subtitle, description, view_state, icon_key, color_class, bg_class, border_class, image_url, sort_order, is_active, updated_at)
VALUES
  (
    'web',
    '{"en":"Web Basics","jp":"Web Basics"}'::jsonb,
    '{"en":"Web Development Fundamentals","jp":"Web開発の基礎"}'::jsonb,
    '{"en":"From HTML, CSS, and React basics to modern UI build workflows.","jp":"HTML, CSS, Reactの基礎からモダンなUI構築まで。"}'::jsonb,
    'programming_web',
    'globe',
    'text-cyan-500',
    'bg-cyan-50',
    'border-cyan-100',
    'https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&q=80&w=800',
    10,
    true,
    now()
  ),
  (
    'ai',
    '{"en":"Gen AI Camp","jp":"Gen AI Camp"}'::jsonb,
    '{"en":"Generative AI & Python","jp":"生成AI & Python"}'::jsonb,
    '{"en":"Learn how LLMs work and build AI apps with Python.","jp":"LLMの仕組みとPythonによるAIアプリケーション開発。"}'::jsonb,
    'programming_ai',
    'cpu',
    'text-yellow-500',
    'bg-yellow-50',
    'border-yellow-100',
    'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&q=80&w=800',
    20,
    true,
    now()
  ),
  (
    'vibe',
    '{"en":"Vibe Coding","jp":"Vibe Coding"}'::jsonb,
    '{"en":"Immersive Coding Experience","jp":"没入型コード体験"}'::jsonb,
    '{"en":"Story-driven learning through Git and OSS.","jp":"GitとOSSの世界を冒険する、新感覚のストーリー学習。"}'::jsonb,
    'programming_vibe',
    'sparkles',
    'text-purple-500',
    'bg-purple-50',
    'border-purple-100',
    'https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&q=80&w=800',
    30,
    true,
    now()
  ),
  (
    'scratch-game',
    '{"en":"Scratch game","jp":"Scratch game"}'::jsonb,
    '{"en":"Block Coding RPG","jp":"ブロックプログラミングRPG"}'::jsonb,
    '{"en":"Learn programming by building battle scripts with Scratch-style blocks.","jp":"Scratchブロックでバトルの作戦を組み、遊びながらプログラミングを学ぶ。"}'::jsonb,
    'P_SCHOOL',
    'gamepad',
    'text-green-600',
    'bg-green-50',
    'border-green-100',
    'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=800',
    40,
    true,
    now()
  ),
  (
    'unity',
    '{"en":"Unity AI Game Dev","jp":"Unity AI Game Dev"}'::jsonb,
    '{"en":"AI x Unity Game Dev","jp":"AI x Unity ゲーム開発"}'::jsonb,
    '{"en":"Develop games using Unity and AI. Learn the role of an architect.","jp":"AIと共にUnityでゲームを作る。コードを書くのではなく、設計する力を養う。"}'::jsonb,
    'UNITY_AI_GAME_DEV',
    'gamepad',
    'text-blue-600',
    'bg-blue-50',
    'border-blue-100',
    'https://images.unsplash.com/photo-1596727147705-54a9d0a514d7?auto=format&fit=crop&q=80&w=800',
    50,
    true,
    now()
  ),
  (
    '3d',
    '{"en":"Blender 3D","jp":"Blender 3D"}'::jsonb,
    '{"en":"3D Modeling","jp":"3Dモデリング"}'::jsonb,
    '{"en":"Basics of 3D creation and spatial design with Blender.","jp":"Blenderを使った3DCG制作と空間デザインの基礎。"}'::jsonb,
    'BLENDER',
    'box',
    'text-orange-500',
    'bg-orange-50',
    'border-orange-100',
    'https://images.unsplash.com/photo-1617791160536-598cf32026fb?auto=format&fit=crop&q=80&w=800',
    60,
    true,
    now()
  ),
  (
    'teacher-bot-live',
    '{"en":"Teacher Bot Live","jp":"Teacher Bot Live"}'::jsonb,
    '{"en":"Blender Sidecar","jp":"Blender サイドカー"}'::jsonb,
    '{"en":"Sync the current Blender step on a big screen.","jp":"Blenderの現在ステップを大画面で同期表示。"}'::jsonb,
    'TEACHER_BOT_LIVE',
    'terminal',
    'text-emerald-500',
    'bg-emerald-50',
    'border-emerald-100',
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=800',
    70,
    true,
    now()
  ),
  (
    'art',
    '{"en":"Art Atelier","jp":"Art Atelier"}'::jsonb,
    '{"en":"Art History & Philosophy","jp":"美術史 & 哲学"}'::jsonb,
    '{"en":"Explore the history and theory of visual arts.","jp":"視覚芸術の歴史と理論。クリエイティブの源泉を探る。"}'::jsonb,
    'ART_MUSEUM',
    'palette',
    'text-stone-600',
    'bg-stone-100',
    'border-stone-200',
    'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&q=80&w=800',
    80,
    true,
    now()
  ),
  (
    'english',
    '{"en":"Global Communication","jp":"Global Communication"}'::jsonb,
    '{"en":"Practical English & Cross-cultural","jp":"実践英語 & 異文化理解"}'::jsonb,
    '{"en":"Practical English for engineers, from docs to technical discussions.","jp":"エンジニアのための実践的英語力。ドキュメント読解から技術的な議論まで。"}'::jsonb,
    'COURSES',
    'book',
    'text-teal-500',
    'bg-teal-50',
    'border-teal-100',
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&q=80&w=800',
    90,
    true,
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  description = EXCLUDED.description,
  view_state = EXCLUDED.view_state,
  icon_key = EXCLUDED.icon_key,
  color_class = EXCLUDED.color_class,
  bg_class = EXCLUDED.bg_class,
  border_class = EXCLUDED.border_class,
  image_url = EXCLUDED.image_url,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();
