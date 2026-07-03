import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Image as ImageIcon, Loader2 } from 'lucide-react';
import { ChecklistBlock } from '../../../types';
import { retrieveBlenderImages } from '../../../services/blenderImageRagService';
import { useLanguage } from '../../../context/LanguageContext';
import ChecklistPage from './multi-format/blocks/ChecklistPage';

type LocalizedText = {
  en: string;
  jp: string;
};

type ChecklistTaskSpec = {
  id: string;
  label: LocalizedText;
  details: LocalizedText;
  query: string;
  fallback: LocalizedText;
  allowedPaths: string[];
  linkUrl?: string;
  staticImageUrl?: string;
  staticImageCaption?: LocalizedText;
  disableImageSearch?: boolean;
};

const BASE_TASKS: ChecklistTaskSpec[] = [
  {
    id: 't1',
    label: {
      en: 'Download from the official Blender site',
      jp: 'Blender公式サイトからダウンロード'
    },
    details: {
      en: 'Grab the stable release from the official site. Check requirements if needed.',
      jp: '安定版を公式サイトから入手します。必要なら要件も確認してください。'
    },
    query: 'download blender',
    fallback: {
      en: 'Blender download page',
      jp: 'Blender ダウンロードページ'
    },
    allowedPaths: ['getting_started/installing'],
    linkUrl: 'https://www.blender.org/download/',
    staticImageUrl: '/data/curricula/blender/_static/blender-download-page.png',
    staticImageCaption: {
      en: 'Blender download page',
      jp: 'Blender ダウンロードページ'
    }
  },
  {
    id: 't2',
    label: {
      en: 'Run the installer',
      jp: 'インストールを実行'
    },
    details: {
      en: 'Windows: choose x64/arm64. Installer adds Start Menu shortcuts; ZIP runs after extraction. macOS: choose Intel/Apple Silicon, open the .dmg and drag Blender.app to Applications. First launch may need approval.',
      jp: 'Windows: x64/arm64を選択。Installer版は開始メニュー登録と関連付けあり。Zip版は解凍して実行(管理者不要)。macOS: Intel/Apple Siliconを選択し、.dmgを開いて Blender.app をApplicationsへドラッグ。初回起動は承認が必要。'
    },
    query: 'install windows blender',
    fallback: {
      en: 'Blender install wizard',
      jp: 'Blender インストーラー'
    },
    allowedPaths: ['getting_started/installing/windows', 'getting_started/installing/macos'],
    staticImageUrl: '/data/curricula/blender/_images/about_contribute_install_windows_installer.png',
    staticImageCaption: {
      en: 'Installer example',
      jp: 'インストーラー例'
    }
  },
  {
    id: 't3',
    label: {
      en: 'Get a quick layout overview',
      jp: '画面構成をざっと把握'
    },
    details: {
      en: 'Top menu/header, center 3D viewport, right Outliner/Properties, and bottom timeline. Drag borders to split/merge areas; switch layouts via Workspaces.',
      jp: '上部メニュー/ヘッダー、中央3Dビューポート、右のアウトライナー/プロパティ、下のタイムラインが基本。境界をドラッグで分割・結合、ワークスペースでレイアウト切替。'
    },
    query: 'blender interface overview',
    fallback: {
      en: 'Blender interface overview',
      jp: 'Blender インターフェース概要'
    },
    allowedPaths: ['interface/'],
    staticImageUrl: '/data/curricula/blender/_images/interface_window-system_introduction_default-screen.png',
    staticImageCaption: {
      en: 'Default layout',
      jp: '初期レイアウト'
    }
  },
  {
    id: 't4',
    label: {
      en: 'Adjust language settings',
      jp: '言語設定を日本語に変更'
    },
    details: {
      en: 'Edit > Preferences > Interface > Language. Enable Translate options (Interface/Tooltips/New Data) as needed.',
      jp: 'Edit > Preferences > Interface > Language を日本語に。TranslateのInterface/Tooltips/New Dataを必要に応じてオン。'
    },
    query: 'blender preferences interface',
    fallback: {
      en: 'Blender language settings',
      jp: 'Blender 言語設定'
    },
    allowedPaths: ['editors/preferences/interface', 'editors/preferences'],
    staticImageUrl: '/data/curricula/blender/_static/blender-language-ui.png',
    staticImageCaption: {
      en: 'Language settings',
      jp: '言語設定'
    }
  }
];

const buildImageUrl = (imagePath: string) => {
  const cleaned = imagePath.replace(/^_images\//, '');
  return `/data/curricula/blender/_images/${cleaned}`;
};

const isAllowedPath = (filePath: string, allowed: string[]) =>
  allowed.some((segment) => filePath.includes(segment));

const BlenderChecklistGeneratorView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { language } = useLanguage();
  const [block, setBlock] = useState<ChecklistBlock | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = {
    en: {
      headerKicker: 'Image Checklist Demo',
      headerTitle: 'Checklist Generator (Blender)',
      headerDescription: 'Test page that searches the image index and injects candidates into the checklist UI. Images require `/data/curricula/blender/_images`.',
      back: 'Back',
      generating: 'Generating...',
      generate: 'Generate',
      blockTitle: 'Get ready for your Blender adventure',
      error: 'Failed to generate images. Check that the index can be loaded.',
      empty: 'Click Generate to create a checklist.'
    },
    jp: {
      headerKicker: '画像チェックリストデモ',
      headerTitle: 'チェックリスト生成 (Blender)',
      headerDescription: '画像インデックスから候補を検索し、チェックリストUIに差し込むテストページです。画像表示には `/data/curricula/blender/_images` が必要です。',
      back: '戻る',
      generating: '生成中...',
      generate: '生成',
      blockTitle: 'Blenderの冒険を始める準備',
      error: '画像生成に失敗しました。インデックスが読み込めるか確認してください。',
      empty: '生成ボタンを押してチェックリストを作成してください。'
    }
  } as const;
  const t = copy[language];

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const used = new Set<string>();
      const tasks = [];

      for (const task of BASE_TASKS) {
        if (task.staticImageUrl) {
          tasks.push({
            id: task.id,
            label: task.label[language],
            details: task.details[language],
            imageUrl: task.staticImageUrl,
            imageCaption: task.staticImageCaption?.[language] || '',
            linkUrl: task.linkUrl
          });
          continue;
        }
        if (task.disableImageSearch) {
          tasks.push({
            id: task.id,
            label: task.label[language],
            details: task.details[language],
            imageKeyword: task.fallback[language],
            linkUrl: task.linkUrl
          });
          continue;
        }
        const candidates = await retrieveBlenderImages(task.query, 25);
        const picked = candidates.find(
          (candidate) =>
            !used.has(candidate.image) && isAllowedPath(candidate.file, task.allowedPaths)
        );
        if (picked) {
          used.add(picked.image);
          tasks.push({
            id: task.id,
            label: task.label[language],
            details: task.details[language],
            imageUrl: buildImageUrl(picked.image),
            imageCaption: picked.caption || picked.alt || '',
            linkUrl: task.linkUrl
          });
        } else {
          tasks.push({
            id: task.id,
            label: task.label[language],
            details: task.details[language],
            imageKeyword: task.fallback[language],
            linkUrl: task.linkUrl
          });
        }
      }

      setBlock({
        id: 'blender-install-checklist',
        type: 'checklist',
        title: t.blockTitle,
        tasks
      });
    } catch (err) {
      console.error(err);
      setError(t.error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-[0.2em]">
              <ImageIcon size={16} /> {t.headerKicker}
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 mt-3">
              {t.headerTitle}
            </h1>
            <p className="text-slate-500 mt-2 max-w-2xl">
              {t.headerDescription}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 text-slate-600 font-semibold hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t.back}
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-60"
            >
              {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {isGenerating ? t.generating : t.generate}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="mt-10">
          {block ? (
            <ChecklistPage block={block} />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
              {t.empty}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlenderChecklistGeneratorView;
