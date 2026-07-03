export type LocalizedText = { en: string; jp: string };

export interface Parameter {
  label: LocalizedText;
  value: LocalizedText;
}

export interface LessonStep {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  imageType: 'static' | 'compare' | 'overlay' | 'dos_donts';
  imageUrl: string;
  secondaryImageUrl?: string;
  beforeImageUrl?: string;
  badExample?: { image: string; text: LocalizedText };
  goodExample?: { image: string; text: LocalizedText };
  hotkeys: string[];
  parameters?: Parameter[];
  troubleshooting?: {
    title: LocalizedText;
    text: LocalizedText;
  };
  tip?: LocalizedText;
}

export interface StageData {
  id: number;
  title: LocalizedText;
  subtitle: LocalizedText;
  level: LocalizedText;
  description: LocalizedText;
  steps: LessonStep[];
}

export const BLENDER_COURSE_DATA: Record<number, StageData> = {
  1: {
    id: 1,
    title: { en: 'First Steps into 3D', jp: '3D制作の第一歩' },
    subtitle: { en: 'Chapter 1: Mastering the Viewport & Transforms', jp: '第1章：ビューポートと変形操作' },
    level: { en: 'Beginner', jp: '初心者' },
    description: {
      en: 'Welcome to your first steps in 3D. In this lesson, you will master viewport navigation and object transforms to control Blender with confidence.',
      jp: '3D制作の第一歩へようこそ。このレッスンでは、Blenderを自在に操るための基礎、視点操作とオブジェクト変形をマスターします。'
    },
    steps: [
      {
        id: 's1-1',
        title: { en: 'Master the Viewport', jp: 'ビューポートを極める' },
        description: {
          en: 'Navigation is the foundation of everything. Use the middle mouse button to explore the scene from every angle.',
          jp: '3D空間を自由に動き回ることが全ての基本です。中マウスボタンを使って、世界をあらゆる角度から観察してみましょう。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1633412802994-5c058f151b66?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Middle Mouse (Rotate)', 'Shift + Middle Mouse (Pan)', 'Scroll (Zoom)'],
        troubleshooting: {
          title: { en: 'Lost your view?', jp: '視点がどこかへ飛んでしまったら？' },
          text: {
            en: "Select an object and press Numpad '.' to frame it.",
            jp: "オブジェクトを選択してテンキーの '.' (ピリオド) を押すと、そのオブジェクトに視点をリセットできます。"
          }
        }
      },
      {
        id: 's1-2',
        title: { en: 'Selection Basics', jp: '選択の基本' },
        description: {
          en: 'Practice selecting precisely. In Blender 4.0, left-click is the default. Learn how to multi-select and deselect.',
          jp: '操作したいものを正確に選ぶ練習です。Blender 4.0では左クリック選択が標準です。複数のものを選んだり、全てを選択解除する操作を覚えましょう。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Left Click (Select)', 'A (Select All)', 'Alt + A (Deselect All)'],
        tip: {
          en: 'The object with the orange outline is the active object.',
          jp: 'オレンジ色の枠線がついているものが『アクティブ』なオブジェクトです。'
        }
      },
      {
        id: 's1-3',
        title: { en: 'The Transformation Trinity', jp: '変形の三種の神器' },
        description: {
          en: 'Move (Grab), Rotate, and Scale are the core tools. Use shortcuts to transform objects intuitively.',
          jp: '移動(Grab)、回転(Rotate)、拡大縮小(Scale)は3D制作の三種の神器です。ショートカットキーを使って、直感的にオブジェクトの形や位置を変えてみましょう。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['G (Grab/Move)', 'R (Rotate)', 'S (Scale)'],
        parameters: [
          { label: { en: 'Constraint X', jp: 'X軸固定' }, value: { en: 'G -> X', jp: 'G -> X' } },
          { label: { en: 'Constraint Y', jp: 'Y軸固定' }, value: { en: 'G -> Y', jp: 'G -> Y' } },
          { label: { en: 'Constraint Z', jp: 'Z軸固定' }, value: { en: 'G -> Z', jp: 'G -> Z' } },
          { label: { en: 'Cancel', jp: 'キャンセル' }, value: { en: 'Right Click / Esc', jp: '右クリック / Esc' } }
        ]
      },
      {
        id: 's1-4',
        title: { en: 'Adding New Worlds', jp: '新しい世界を追加' },
        description: {
          en: 'Create shapes from nothing. Use the Mesh menu to add cubes, spheres, or the famous monkey (Suzanne).',
          jp: '何もないところから形を生み出します。MeshメニューからCubeやSphere、あるいは有名なMonkey(Suzanne)を追加してみましょう。'
        },
        imageType: 'overlay',
        imageUrl: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=1200',
        secondaryImageUrl: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Shift + A (Add Menu)'],
        tip: {
          en: 'New objects are created at the 3D Cursor location.',
          jp: "新しいオブジェクトは常に『3D Cursor』がある場所に生成されます。"
        }
      },
      {
        id: 's1-5',
        title: { en: 'Shading & Visualization', jp: '表示モードの切り替え' },
        description: {
          en: 'Switch views as needed: solid for editing, wireframe to see structure, and rendered for a near-final look.',
          jp: '見た目の切り替えです。作業しやすいソリッド表示と、内部構造が見えるワイヤーフレーム表示、そして完成イメージに近いレンダー表示を使い分けます。'
        },
        imageType: 'compare',
        beforeImageUrl: 'https://images.unsplash.com/photo-1595475207225-428b62bda831?auto=format&fit=crop&q=80&w=1200',
        imageUrl: 'https://images.unsplash.com/photo-1633412803524-d96562450871?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Z (Shading Pie Menu)', 'Shift + Z (Toggle Wireframe)']
      },
      {
        id: 's1-6',
        title: { en: 'Enter the Edit Mode', jp: '編集モードに入る' },
        description: {
          en: 'Now reshape the mesh itself. In Edit Mode you can edit vertices, edges, and faces individually.',
          jp: 'オブジェクトそのものの形を作り変える段階へ進みます。オブジェクトモードから編集モードへ切り替えると、点・辺・面を個別に操作できるようになります。'
        },
        imageType: 'dos_donts',
        imageUrl: '',
        badExample: {
          image: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?auto=format&fit=crop&q=80&w=800&sat=-100',
          text: {
            en: 'Forcing shape changes in Object Mode often causes issues later.',
            jp: 'オブジェクトモードで形を無理やり歪ませると、後の工程でトラブルの元になります。'
          }
        },
        goodExample: {
          image: 'https://images.unsplash.com/photo-1618331835717-801e976710b2?auto=format&fit=crop&q=80&w=800',
          text: {
            en: 'Do detailed shape edits in Edit Mode. This is the pro workflow.',
            jp: '詳細な形状変化は必ず編集モードで行いましょう。これがプロのワークフローです。'
          }
        },
        hotkeys: ['Tab (Switch Mode)']
      }
    ]
  },
  2: {
    id: 2,
    title: { en: 'Modeling Essentials', jp: 'モデリングの基礎' },
    subtitle: { en: 'Chapter 2: Creating the Desk', jp: '第2章：机を作る' },
    level: { en: 'Beginner', jp: '初心者' },
    description: {
      en: 'Unlock the power of Edit Mode. Use basic mesh operations to model a simple desk and learn beveling for realism.',
      jp: '編集モードの力を解き放ちましょう。基本的なメッシュ操作を駆使して、シンプルな机をモデリングします。ベベル（面取り）によるリアリティの追求も学びます。'
    },
    steps: [
      {
        id: 's2-1',
        title: { en: 'Scaling the Table Top', jp: '天板をスケール' },
        description: {
          en: 'Transform the default cube into a tabletop. Use S plus an axis (X/Y/Z) to get the right proportions.',
          jp: 'デフォルトのキューブを机の天板に変身させます。Sキー（スケール）に軸（X/Y/Z）を指定することで、思い通りの比率に変形できます。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1615870216519-2f9fa575fa5c?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['S + Z (Scale Height)', 'S + Y (Scale Width)'],
        tip: { en: 'Keep it thin and wide.', jp: '薄く、広くするのがポイントです。' }
      },
      {
        id: 's2-2',
        title: { en: 'Creating Legs', jp: '脚を作る' },
        description: {
          en: 'Add a new cube and stretch it into a leg. Use Numpad 7 (top view) to place it precisely.',
          jp: '新しいキューブを追加し、足の形に細長くします。天板の四隅に配置する際は、テンキー7（トップビュー）を使うと位置合わせが簡単です。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1533090368676-1fd25485db88?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Shift + A > Cube', 'G (Move)', 'Numpad 7 (Top View)']
      },
      {
        id: 's2-3',
        title: { en: 'Duplicate with Precision', jp: '精密に複製' },
        description: {
          en: 'You only need to build one leg. Duplicate with Shift + D, then lock the axis with X or Y for precise placement.',
          jp: '1本の足を何度も作る必要はありません。「Shift + D」で複製し、XやYを押して軸を固定すれば、正確な位置にコピーできます。'
        },
        imageType: 'overlay',
        imageUrl: 'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?auto=format&fit=crop&q=80&w=1200',
        secondaryImageUrl: 'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?auto=format&fit=crop&q=80&w=1200&blur=20',
        hotkeys: ['Shift + D (Duplicate)', 'X / Y (Lock Axis)'],
        tip: {
          en: 'When adjusting leg length, wireframe view (Shift + Z) makes it easier to select bottom vertices.',
          jp: '足の長さを変えるときは、ワイヤーフレーム表示(Shift+Z)にすると底面の頂点だけを選びやすくなります。'
        }
      },
      {
        id: 's2-4',
        title: { en: 'The Magic of Bevel', jp: 'ベベルの魔法' },
        description: {
          en: 'The key to realism is the edges. Real objects are not perfectly sharp. Use Bevel (Ctrl + B) to round corners.',
          jp: 'CGっぽさを消す鍵は「角」にあります。現実の物体に完全に鋭利な角はありません。ベベル（Ctrl+B）を使って、角を少しだけ丸めましょう。'
        },
        imageType: 'compare',
        beforeImageUrl: 'https://images.unsplash.com/photo-1533090368676-1fd25485db88?auto=format&fit=crop&q=80&w=1200',
        imageUrl: 'https://images.unsplash.com/photo-1595475207225-428b62bda831?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Ctrl + A > Scale (Apply Scale First!)', 'Ctrl + B (Bevel)'],
        troubleshooting: {
          title: { en: 'Bevel looks distorted?', jp: 'ベベルが歪む？' },
          text: {
            en: 'If you scaled in Object Mode, apply scale with Ctrl + A -> Scale before beveling.',
            jp: 'オブジェクトモードでスケールを変更した後にベベルをかけると歪みます。必ず「Ctrl+A -> Scale」でスケールを適用してから行いましょう。'
          }
        }
      }
    ]
  },
  3: {
    id: 3,
    title: { en: 'Advanced Modeling', jp: '上級モデリング' },
    subtitle: { en: 'Chapter 3: The Chair & Scene Setup', jp: '第3章：椅子とシーン構成' },
    level: { en: 'Intermediate', jp: '中級' },
    description: {
      en: 'Create a chair and build the scene. Learn parenting and collection organization for efficient management.',
      jp: '机に合う椅子を作成し、シーン全体を構成します。オブジェクトの親子関係やコレクション整理など、効率的な管理方法も習得します。'
    },
    steps: [
      {
        id: 's3-1',
        title: { en: 'Seat & Backrest', jp: '座面と背もたれ' },
        description: {
          en: 'Create the seat. Duplicate it and rotate 90° to make the backrest.',
          jp: '椅子の座面を作ります。机の天板と同じ要領ですが、今度は背もたれも必要です。座面を複製し、90度回転させて背もたれにしましょう。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Shift + D (Duplicate)', 'R + X + 90 (Rotate 90deg on X)']
      },
      {
        id: 's3-2',
        title: { en: 'Edit Mode Precision', jp: '編集モードで精密配置' },
        description: {
          en: 'Snap chair legs to the underside. Use snapping to align like a magnet.',
          jp: '椅子の足は、座面の下にぴったりくっつけたいですよね。編集モードで面を選択し、「Snapping（スナップ）」機能を使うと、磁石のように吸着させることができます。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Shift + Tab (Toggle Snap)', 'Ctrl (Hold to Snap temporarily)'],
        tip: {
          en: 'Switch snap targets between Vertex and Face as needed.',
          jp: 'スナップ先を「Vertex（頂点）」や「Face（面）」に切り替えて使い分けましょう。'
        }
      },
      {
        id: 's3-3',
        title: { en: 'Organizing with Collections', jp: 'コレクションで整理' },
        description: {
          en: 'As objects grow, group them into collections like “Desk,” “Chair,” and “Floor.”',
          jp: 'オブジェクトが増えてきました。「机」「椅子」「床」など、部品ごとにコレクション（フォルダのようなもの）にまとめましょう。'
        },
        imageType: 'dos_donts',
        imageUrl: '',
        badExample: {
          image: 'https://images.unsplash.com/photo-1580196920985-3391d98782a5?auto=format&fit=crop&q=80&w=800',
          text: {
            en: 'The outliner is filled with "Cube.001", "Cube.002"... hard to tell what is what.',
            jp: 'アウトライナーが "Cube.001", "Cube.002"... で埋め尽くされている状態。どれがどれか分かりません。'
          }
        },
        goodExample: {
          image: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?auto=format&fit=crop&q=80&w=800',
          text: {
            en: 'Use M to create a new collection and rename it. Toggle visibility in one place.',
            jp: 'Mキーで新しいコレクションを作成し、名前を付けます。ビューポートの表示/非表示も一括で管理できます。'
          }
        },
        hotkeys: ['M (Move to Collection)', 'F2 (Rename)']
      },
      {
        id: 's3-4',
        title: { en: 'Setting the Stage', jp: '舞台を整える' },
        description: {
          en: 'Add a plane and arrange the furniture. Check camera view (Numpad 0) to compose the shot.',
          jp: '床（Plane）を追加し、家具を配置します。カメラの視点（テンキー0）から見て、魅力的な構図になるように調整しましょう。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Shift + A > Plane', 'Numpad 0 (Camera View)']
      }
    ]
  },
  4: {
    id: 4,
    title: { en: 'Bringing it to Life', jp: '仕上げ' },
    subtitle: { en: 'Chapter 4: Materials, Lights & Render', jp: '第4章：マテリアル・ライト・レンダー' },
    level: { en: 'Intermediate', jp: '中級' },
    description: {
      en: 'Final touches. Set wood and metal materials, light the scene, and render your best shot.',
      jp: '最後の仕上げです。木材や金属の質感を設定し、ライティングで雰囲気を演出。そして最高の一枚を書き出します。'
    },
    steps: [
      {
        id: 's4-1',
        title: { en: 'Material Basics', jp: 'マテリアルの基本' },
        description: {
          en: 'Switch to Material Preview and create a new material from the properties panel. Changing Base Color transforms the look.',
          jp: '「マテリアルプレビュー」モードに切り替え、プロパティパネルから新規マテリアルを作成します。Base Colorを変えるだけで世界が変わります。'
        },
        imageType: 'compare',
        beforeImageUrl: 'https://images.unsplash.com/photo-1595475207225-428b62bda831?auto=format&fit=crop&q=80&w=1200',
        imageUrl: 'https://images.unsplash.com/photo-1519643381401-22c77e60520e?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Z > Material Preview'],
        parameters: [
          { label: { en: 'Base Color', jp: 'ベースカラー' }, value: { en: 'Pick a color', jp: '色を選択' } },
          { label: { en: 'Roughness', jp: 'ラフネス' }, value: { en: '0.5 (Matte) - 0.0 (Glossy)', jp: '0.5（マット）〜0.0（光沢）' } },
          { label: { en: 'Metallic', jp: 'メタリック' }, value: { en: '0.0 (Plastic/Wood) - 1.0 (Metal)', jp: '0.0（プラスチック/木材）〜1.0（金属）' } }
        ]
      },
      {
        id: 's4-2',
        title: { en: 'Assigning Multiple Materials', jp: '複数マテリアルの割り当て' },
        description: {
          en: 'To make legs metal and the tabletop wood, select faces in Edit Mode and use Assign.',
          jp: '机の足は金属、天板は木材にしたい場合、編集モードで面を選択し、「Assign」ボタンで別のマテリアルを適用できます。'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1604578762246-41134e37f9cc?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['Tab (Edit Mode)', 'Material Panel > Assign']
      },
      {
        id: 's4-3',
        title: { en: 'Lighting the Scene', jp: 'ライティング' },
        description: {
          en: 'Without lights, renders are dark. Add a Point or Area light and adjust power and position to shape the scene.',
          jp: 'ライトがないとレンダリングは真っ暗です。Point LightやArea Lightを追加し、パワーと位置を調整して、家具の立体感を際立たせましょう。'
        },
        imageType: 'overlay',
        imageUrl: 'https://images.unsplash.com/photo-1513506003013-194a5d68d878?auto=format&fit=crop&q=80&w=1200',
        secondaryImageUrl: 'https://images.unsplash.com/photo-1513506003013-194a5d68d878?auto=format&fit=crop&q=80&w=1200&brightness=150',
        hotkeys: ['Shift + A > Light'],
        tip: {
          en: 'Think three-point lighting (key, fill, back) for a professional look.',
          jp: '「3点照明（キーライト、フィルライト、バックライト）」を意識するとプロっぽい仕上がりになります。'
        }
      },
      {
        id: 's4-4',
        title: { en: 'Render & Export', jp: 'レンダーと書き出し' },
        description: {
          en: 'Press F12 to render. When finished, save from Image > Save As. Congrats on your first piece!',
          jp: 'F12キーを押してレンダリング！計算が終わったら、Imageメニューから「Save As」で画像として保存しましょう。おめでとうございます、最初の作品の完成です！'
        },
        imageType: 'static',
        imageUrl: 'https://images.unsplash.com/photo-1622547748225-3fc4abd2d00b?auto=format&fit=crop&q=80&w=1200',
        hotkeys: ['F12 (Render Image)', 'Alt + S (Save Image)'],
        troubleshooting: {
          title: { en: 'Image too dark/bright', jp: '画像が暗すぎる/明るすぎる' },
          text: {
            en: 'Adjust the light power or Render Properties > Color Management > Exposure.',
            jp: 'ライトの「Power（ワット数）」を調整するか、Render Propertiesの「Color Management > Exposure」で調整してください。'
          }
        }
      }
    ]
  }
};
