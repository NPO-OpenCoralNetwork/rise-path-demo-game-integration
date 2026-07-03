import { QuizData } from '../../../types';

export const VIBE_CHAPTER_1_QUIZ: QuizData = {
  id: 'quiz-ch1',
  title: { en: 'Chapter 1 Knowledge Check', jp: 'Chapter 1 理解度チェック' },
  questions: [
    {
      id: 'q1',
      text: { 
        en: 'When comparing a web application to a "Restaurant," which role corresponds to the "Backend"?', 
        jp: 'Webアプリケーションを「レストラン」に例えた場合、「バックエンド」に該当する役割はどれですか？' 
      },
      options: [
        { id: 'a', text: { en: 'The "Dining Hall" where customers eat', jp: 'お客さんが食事をする「客席ホール」' } },
        { id: 'b', text: { en: 'The "Kitchen" where orders are received and food is prepared', jp: '注文を受け取り料理を作る「厨房」' } },
        { id: 'c', text: { en: 'The "Giant Refrigerator" where ingredients are stored', jp: '食材を保管している「巨大な冷蔵庫」' } },
        { id: 'd', text: { en: 'The store sign and "Exterior Design"', jp: 'お店の看板や「外観デザイン」' } }
      ],
      correctAnswer: 'b',
      explanation: { 
        en: 'The backend is the "Kitchen." It receives orders (requests) from the frontend (dining hall), takes ingredients from the database (refrigerator), processes them, and serves them.', 
        jp: 'バックエンドは「厨房」です。フロントエンド（ホール）からの注文（リクエスト）を受け取り、データベース（冷蔵庫）から食材を取り出し、加工して提供します。' 
      }
    },
    {
      id: 'q2',
      text: { 
        en: 'In which scenario should you ask AI to "Change the API response"?', 
        jp: 'AIに対して「APIのレスポンスを変更して」と依頼すべき場面はどれですか？' 
      },
      options: [
        { id: 'a', text: { en: 'Changing a button color from red to blue', jp: 'ボタンの色を赤から青に変えたいとき' } },
        { id: 'b', text: { en: 'Making screen animations smoother', jp: '画面のアニメーションをもっと滑らかにしたいとき' } },
        { id: 'c', text: { en: 'Allowing the app to fetch "Age" as part of user info', jp: 'ユーザー情報として「年齢」も取得できるようにしたいとき' } },
        { id: 'd', text: { en: 'Increasing the font size', jp: 'フォントサイズを大きくしたいとき' } }
      ],
      correctAnswer: 'c',
      explanation: { 
        en: 'Changes involving "what data is fetched" are the domain of the API (backend). Visuals (color, animations, font) are the domain of the UI (frontend).', 
        jp: '「データの取得内容」に関わる変更はAPI（バックエンド）の領域です。見た目（色、アニメーション、フォント）はUI（フロントエンド）の領域です。' 
      }
    },
    {
      id: 'q3',
      text: { 
        en: 'Why is Git often called a "Time Machine" in AI development?', 
        jp: 'AI開発において、Gitが「タイムマシン」と呼ばれる理由として最も適切なものはどれですか？' 
      },
      options: [
        { id: 'a', text: { en: 'Because AI predicts and writes future code', jp: 'AIが未来のコードを予測して書いてくれるから' } },
        { id: 'b', text: { en: 'Because it automatically measures time spent developing', jp: '開発にかかった時間を自動的に計測してくれるから' } },
        { id: 'c', text: { en: 'Because you can return to a past "working state" whenever you fail', jp: '失敗した時に、いつでも過去の「動いていた状態」に戻せるから' } },
        { id: 'd', text: { en: 'Because you can instantly search for code from developers worldwide', jp: '世界中の開発者のコードを瞬時に検索できるから' } }
      ],
      correctAnswer: 'c',
      explanation: { 
        en: 'Git is a tool for creating "Save Points." Even if AI breaks your code, as long as you have committed, you can return to a past state with a single command.', 
        jp: 'Gitは「セーブポイント」を作成するツールです。AIがコードを破壊してしまっても、コミットさえしていれば、コマンド一つで過去の状態に戻す（Revert）ことができます。' 
      }
    },
    {
      id: 'q4',
      text: { 
        en: 'What is the correct meaning of "Deployment"?', 
        jp: '「デプロイ (Deploy)」という言葉の意味として正しいものはどれですか？' 
      },
      options: [
        { id: 'a', text: { en: 'Starting to write a program', jp: 'プログラムを書き始めること' } },
        { id: 'b', text: { en: 'Placing an app built locally onto a server to make it available worldwide', jp: 'ローカルで作ったアプリを、サーバーに配置して世界中で使える状態にすること' } },
        { id: 'c', text: { en: 'Having AI find bugs in the code', jp: 'AIにコードのバグを見つけてもらうこと' } },
        { id: 'd', text: { en: 'Deleting all contents of a database', jp: 'データベースの中身を全て削除すること' } }
      ],
      correctAnswer: 'b',
      explanation: { 
        en: 'Deployment refers to the sequence of processes to transfer code from the development environment (local) to the production environment (server) and make it live.', 
        jp: 'デプロイとは、開発環境（ローカル）にあるコードを本番環境（サーバー）に転送し、実際に稼働させる一連のプロセスを指します。' 
      }
    },
    {
      id: 'q5',
      text: { 
        en: 'Which approach yields the highest accuracy when prompting AI?', 
        jp: 'AIへの指示出し（プロンプト）で、最も精度が高くなるアプローチはどれですか？' 
      },
      options: [
        { id: 'a', text: { en: 'Asking it to "just build a good app" and leaving it to AI', jp: '「いい感じのアプリを作って」と一任する' } },
        { id: 'b', text: { en: 'Being aware of "Is this Frontend or Backend?" and assigning responsibilities separately', jp: '「これはフロントの話？バックエンドの話？」と意識して、責務を分けて依頼する' } },
        { id: 'c', text: { en: 'Sending all functional requirements at once in a long message', jp: '一度に全ての機能要件をまとめて長文で送る' } },
        { id: 'd', text: { en: 'Explaining using only words a primary schooler would understand', jp: '専門用語を使わず、小学生でもわかる言葉だけで説明する' } }
      ],
      correctAnswer: 'b',
      explanation: { 
        en: 'AI is not great at switching context. By organizing the traffic—"This is for UI," "This is for the DB"—human intervention dramatically improves AI output accuracy.', 
        jp: 'AIは文脈の切り替えが苦手です。「今はUIの話」「今はDBの話」と、人間が交通整理をしてあげることで、AIの出力精度は劇的に向上します。' 
      }
    }
  ]
};