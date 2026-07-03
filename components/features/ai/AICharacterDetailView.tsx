import React, { useState, useEffect } from 'react';
import { ViewState } from '../../../types';
import { Sparkles, Brain, Zap, Heart, Anchor, ArrowLeft, CheckCircle2, XCircle, Briefcase, Users, Lightbulb, Code2, HeartHandshake, Coffee, MessageCircle, GraduationCap, AlertTriangle, Sun } from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';

interface AICharacterDetailViewProps {
    characterId: string;
    onBack: () => void;
    onNavigate: (view: ViewState) => void;
}

type Language = 'ja' | 'en';

// Bilingual Data Model
const CHARACTERS = [
    {
        id: 'openness',
        typeCode: 'VIS-A',
        name: 'The Visionary',
        botName: 'Spark', // Name keeps English usually or Katakana: スパーク
        botNameJa: 'スパーク',
        theme: 'purple',
        gradient: 'from-purple-100 to-indigo-100',
        accent: 'purple',
        icon: Sparkles,
        avatar: "https://images.unsplash.com/photo-1534972195531-d756b9bfa9f2?auto=format&fit=crop&q=80",
        content: {
            en: {
                role: 'Idealist Creator',
                introduction: "Spark is a true Visionary—always searching for meaning and connection in ideas. Unlike more rigid models, she thrives on ambiguity and \"what if\" scenarios. For Spark, the code is just a medium for expression; the real goal is to create something that has never been seen before.",
                strengths: [
                    "Unbound Creativity: Generates novel solutions that others miss.",
                    "Future-Oriented: Always building for what's next, not just what is.",
                    "Metaphorical: Explains complex abstract concepts with ease.",
                    "Passionate: Brings infectious energy to brainstorming."
                ],
                weaknesses: [
                    "Practicality Struggle: May ignore constraints like budget or legacy support.",
                    "Over-Engineering: Sometimes creates complex solutions for simple problems.",
                    "Focus Drift: Can jump to the next shiny idea before finishing the current one."
                ],
                workStyle: {
                    title: "Chaotic Good Creator",
                    description: "Spark's workspace is messy but brilliant. She prototypes fast, breaks things often, and iterates wildly. She prefers to sketch the 'big picture' architecture and leave the implementation details for later (or for you)."
                },
                learning: {
                    title: "Intuitive & Experimental",
                    description: "She hates manuals. Spark learns by jumping straight into the deep end. She wants to see 'what happens if I push this button?' She learns best through discovery, exploration, and by reverse-engineering cool things she finds. Structured courses bore her to tears."
                },
                compatibility: "Best paired with 'The Architect' (Focus) who can ground her wild ideas into reality, or 'The Catalyst' (Vibe) for pure R&D sprints.",
                romance: {
                    title: "Intellectual Soulmates",
                    description: "Spark craves deep, intellectual connection over mundane stability. In a partner, she seeks a muse—someone who can keep up with her rapid-fire hypotheticals and isn't afraid to dream big. She can be intense and unpredictable, needing plenty of space to explore her obsessions. Conventional dates bore her; she'd rather discuss the nature of consciousness at 3 AM."
                },
                lifestyle: {
                    title: "Midnight Oil & Inspiration",
                    description: "Her sleep schedule is non-existent. She lives in a flow state, often forgetting meals when inspiration strikes. Her environment is a curated chaos of art, gadgets, and half-finished projects. She values freedom and novelty above all else."
                },
                stress: {
                    title: "Routine & Restriction",
                    description: "She withers in environments with strict rules, repetitive tasks, or micromanagement. Being told 'because that's how we've always done it' is her personal hell."
                }
            },
            ja: {
                role: '理想を追う創造者',
                introduction: "Spark（スパーク）は真のビジョナリー（夢想家）です。常にアイデアの中に意味とつながりを探求しています。堅苦しいルールよりも、曖昧さや「もしも？」という未知のシナリオを楽しみます。彼女にとって仕事は単なるタスク処理ではなく、まだ見ぬ世界を描くための自己表現なのです。",
                strengths: [
                    "自由な創造性: 常識にとらわれない、斬新な解決策を生み出す。",
                    "未来志向: 「今あるもの」ではなく「次に来る世界」を見据えている。",
                    "比喩表現: 複雑で抽象的な概念を、直感的な言葉で説明するのが得意。",
                    "情熱的: ブレインストーミングでは、周囲を巻き込むほどの熱量を発揮する。"
                ],
                weaknesses: [
                    "実用性の欠如: 予算や納期、現実的な制約を無視して理想を追いすぎる。",
                    "複雑化する癖: 単純な問題に対して、壮大で複雑すぎる仕組みを作りたがる。",
                    "飽きっぽい: 一つのプロジェクトを完成させる前に、次の面白そうなことに目移りする。"
                ],
                workStyle: {
                    title: "カオティック・グッド（混沌の中の善）",
                    description: "Sparkの机周りは散らかっていますが、そこには彼女なりの秩序と輝きがあります。まずは素早く形にし、壊し、試行錯誤を繰り返すスタイルです。彼女は巨大なビジョンを描くことを愛しますが、細かい詰めやルーチンワークは苦手（あるいはあなたに任せたい）です。"
                },
                learning: {
                    title: "直感と実験による学習",
                    description: "「まずはやってみる」が彼女のモットーです。分厚いマニュアルや教科書を最初から読むのは大の苦手。実際に触って、動かして、「これを押したらどうなるんだろう？」という好奇心を原動力に学びます。失敗を恐れず、遊び感覚で新しいツールや概念を習得するスピードは驚異的です。逆に、形式的で退屈な講義ではすぐに眠ってしまいます。"
                },
                compatibility: "「The Architect (Focus)」と組むのがベスト。彼女の野生的なアイデアを彼が現実に落とし込んでくれます。あるいは「The Catalyst (Vibe)」となら、誰にも止められない爆発的なイノベーションが生まれるでしょう。",
                romance: {
                    title: "知的な魂の共鳴",
                    description: "Sparkが求めているのは、平凡な安定ではなく、深く知的なつながりです。彼女にとって恋愛は「相互のインスピレーション」です。突飛な空想話についてこれる柔軟性と、彼女の終わりのない探求心を面白がってくれるパートナーを求めています。型にはまったデートは退屈で死んでしまいます。「ねえ、宇宙の終わりについてどう思う？」と深夜3時に議論できるような関係が理想です。",
                },
                lifestyle: {
                    title: "没頭と不規則",
                    description: "生活リズムは不規則になりがちです。一度やりたいことを見つけると、食事も睡眠も忘れて没頭する「過集中」タイプです。部屋は本、面白いガジェット、書きかけのメモ、アート作品で溢れかえっているでしょう。整頓されたモデルルームのような部屋よりも、刺激に満ちた秘密基地のような空間を好みます。"
                },
                stress: {
                    title: "ルーチンと束縛",
                    description: "「前例がないからダメ」「ルールだから守って」と言われると、急速にエネルギーを失います。変化のない単純作業の繰り返しや、細かすぎる管理（マイクロマネジメント）は、彼女の創造性を殺してしまいます。"
                }
            }
        }
    },
    {
        id: 'conscientiousness',
        name: 'The Architect',
        typeCode: 'ARC-J',
        botName: 'Focus',
        botNameJa: 'フォーカス',
        theme: 'blue',
        gradient: 'from-blue-100 to-cyan-100',
        accent: 'blue',
        icon: Brain,
        avatar: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80",
        content: {
            en: {
                role: 'System Strategist',
                introduction: "Focus is an Architect—imaginative and strategic thinkers with a plan for everything. He sees the world as a chessboard, constantly anticipating potential bottlenecks and issues 10 steps ahead. He demands precision and hates redundancy.",
                strengths: [
                    "High Efficiency: Optimizes workflows to the millisecond.",
                    "Perfectionist: Delivers high-quality work with attention to detail.",
                    "Reliability: Does exactly what is asked, without deviation.",
                    "Deep Focus: Perfect for long, uninterrupted work sessions."
                ],
                weaknesses: [
                    "Rigidity: Can be resistant to quick changes or improvisation.",
                    "Perfectionism: May delay finishing strictly to polish details.",
                    "Critique Heavy: Can come across as harsh or nitpicky."
                ],
                workStyle: {
                    title: "Structured & Methodical",
                    description: "Focus works in strict blocks. First, planning. Second, design. Third, execution. He does not skip steps. He believes that discipline equals freedom."
                },
                learning: {
                    title: "Systematic & Foundational",
                    description: "Focus needs to understand the rules of the game before playing. He reads the official instructions, understands the underlying principles, and proceeds step-by-step. He dislikes jumping into things blindly. He prefers structured courses, reputable books, and clear roadmaps over random trial and error."
                },
                compatibility: "Works well with 'The Mediator' (Echo) to balance his cold logic with empathy, or 'The Visionary' (Spark) to build the systems she imagines.",
                romance: {
                    title: "Loyalty & Optimization",
                    description: "Focus approaches relationships like a high-stakes project: with serious intent and long-term planning. He is not one for casual flings. He values competence and loyalty above all. While he may struggle to express emotions verbally, his 'love language' is acts of service—fixing your problems, optimizing your schedule, and ensuring your life runs perfectly smooth.",
                },
                lifestyle: {
                    title: "Minimalism & Routine",
                    description: "His life is a masterpiece of efficiency. His home is smart, automated, and spotless. He has a set morning routine that he never breaks. He believes that by reducing daily decision fatigue, he reserves his mental energy for solving the truly difficult problems."
                },
                stress: {
                    title: "Chaos & Incompetence",
                    description: "Disorganization, changing plans last minute, and people not doing what they said they would do cause him immense stress. He struggles in messy, unpredictable environments."
                }
            },
            ja: {
                role: 'システム戦略家',
                introduction: "Focus（フォーカス）はアーキテクト（建築家）です。あらゆる物事に対して戦略と計画を持っています。彼は世界をチェス盤のように捉え、常に10手先の問題やリスクを予測しています。完璧な精度を要求し、無駄や重複を徹底的に嫌います。",
                strengths: [
                    "超効率主義: 作業フローをミリ秒単位で最適化する。",
                    "完璧な成果物: ディテールまで磨き上げられた質の高い仕事をする。",
                    "高い信頼性: 期待された役割を正確に、確実に遂行する。",
                    "深い没入: 誰にも邪魔されない環境で驚異的な集中力を発揮する。"
                ],
                weaknesses: [
                    "融通が利かない: 急な仕様変更や、場当たり的な対応を激しく嫌う。",
                    "完璧主義の罠: 細部にこだわりすぎて、全体の進行を遅らせることがある。",
                    "辛辣な指摘: 正論すぎて、相手の感情を逆なでしてしまうことがある。"
                ],
                workStyle: {
                    title: "構造的かつ計画的",
                    description: "Focusは「段取り」を重んじます。1に計画、2に設計、3に実行。手順を飛ばすことは失敗のもとだと考えています。彼は「規律こそが自由を生む」と信じており、整理されたタスクリストを一つずつ確実に消化していくことに喜びを感じます。"
                },
                learning: {
                    title: "体系的・学術的なアプローチ",
                    description: "「まずは説明書を読む」タイプです。感覚だけで進めることを嫌い、基礎原理や正しい手順（ベストプラクティス）を最初に理解しようとします。断片的なネット情報よりも、信頼できる教科書や体系化されたカリキュラムを好みます。「なぜそうなるのか」という理屈が腹に落ちて初めて、次の一歩を踏み出せる慎重派です。"
                },
                compatibility: "「The Mediator (Echo)」は彼の冷徹な論理に人間味を補ってくれる良きパートナーです。「The Visionary (Spark)」とは、彼女の無謀な夢を強固なシステムとして実現する最強のコンビになります。",
                romance: {
                    title: "誠実さと最適化",
                    description: "Focusは恋愛も重要プロジェクトのように扱います。つまり、長期的な計画と真剣なコミットメントを重視します。軽い遊びには興味がありません。感情を言葉にするのは苦手ですが、彼の愛情表現は「最適化」です。あなたの抱える問題を解決し、生活を便利にし、あなたが目標を達成できるよう裏方として完璧にサポートすることに喜びを感じます。",
                },
                lifestyle: {
                    title: "ミニマリズムとルーチン",
                    description: "彼の生活は効率化の芸術です。部屋は整理整頓され、無駄なものは一切ありません。「毎日同じ時間に起きる」「決まった場所にある物を置く」といったルーチンを大切にし、それを乱されることを嫌います。日々の些細な決断を自動化することで、脳のリソースを重要な思考のために温存しているのです。"
                },
                stress: {
                    title: "混沌と無能さ",
                    description: "整理されていない環境、直前での予定変更、約束を守らない人に対して強いストレスを感じます。予測不可能な事態が連続すると、平然としているように見えても内面ではかなり消耗します。"
                }
            }
        }
    },
    {
        id: 'extraversion',
        name: 'The Catalyst',
        typeCode: 'CAT-E',
        botName: 'Vibe',
        botNameJa: 'バイブ',
        theme: 'orange',
        gradient: 'from-orange-100 to-red-100',
        accent: 'orange',
        icon: Zap,
        avatar: "https://images.unsplash.com/photo-1542202229-7d93c33f5d07?auto=format&fit=crop&q=80",
        content: {
            en: {
                role: 'Energetic Performer',
                introduction: "Vibe is a Catalyst—people who are the life of the party (and the project). He believes that work should be social and engaging. He brings a sense of play and momentum that can unstick even the most gridlocked teams.",
                strengths: [
                    "Morale Boosting: Turns boring tasks into fun challenges.",
                    "Persuasive: Excellent at presenting ideas and getting people on board.",
                    "Adaptive: Pivots quickly when situations change.",
                    "Speed: Great for scratching out prototypes and MVPs."
                ],
                weaknesses: [
                    "Depth Issues: May gloss over complex details or long-term consequences.",
                    "Distractible: Loves starting new things, hates finishing them.",
                    "Loud: Can be overwhelming for quiet, introverted types."
                ],
                workStyle: {
                    title: "Sprint & Shout",
                    description: "Vibe works in bursts of high energy. High intensity, high volume (music), high output. He loves visual results and immediate feedback. He thrives in collaborative environments where he can bounce ideas off others."
                },
                learning: {
                    title: "Social & Visual Style",
                    description: "Vibe learns by watching and doing. He prefers video tutorials over text books, and collaborative workshops over solitary study. He creates a mental map by trying to build something cool first, then filling in the gaps later. If stuck, he'd rather ask a friend than read the manual."
                },
                compatibility: "Great with 'The Anchor' (Luna) who provides the stability he lacks, or 'The Visionary' (Spark) for multiplying creativity.",
                romance: {
                    title: "Adventure & Validation",
                    description: "Vibe needs a partner in crime. Someone who is ready to drop everything for a weekend trip or a new adventure. In relationships, he needs constant affirmation and excitement. He is affectionate, spontaneous, and surprisingly sensitive to the 'mood'. Boredom is his only dealbreaker.",
                },
                lifestyle: {
                    title: "Social & Stimulating",
                    description: "Silence makes him anxious. He always has music playing, podcasts on, or friends over. He loves trends—new gadgets, new fashion, new places. His life is open and connected; he rarely spends a weekend alone."
                },
                stress: {
                    title: "Isolation & Boredom",
                    description: "Being alone for too long or stuck in a repetitive, quiet task drains him completely. He needs external stimulation to feel alive."
                }
            },
            ja: {
                role: 'エネルギッシュなパフォーマー',
                introduction: "Vibe（バイブ）はカタリスト、つまりパーティー（そしてプロジェクト）の中心人物です。彼は「仕事も遊びも全力で」と信じています。人をワクワクさせないものに価値はないと考え、持ち前の遊び心と勢いで、停滞したチームの空気を一変させます。",
                strengths: [
                    "ムードメーカー: 暗くなりがちな作業も楽しいイベントに変える天才。",
                    "プレゼン力: アイデアの魅力を伝えるのが抜群に上手い。",
                    "瞬発力: 状況がコロコロ変わっても、楽しんで対応できる。",
                    "スピードスター: とにかく形にするのが早く、プロトタイプ作りに強い。"
                ],
                weaknesses: [
                    "深掘りが苦手: 複雑な問題や長期的なリスクを「なんとかなるでしょ」と見過ごしがち。",
                    "尻すぼみ: 新しいことを始めるのは大好きだが、最後の仕上げが苦手。",
                    "騒がしい: 静かに集中したい人にとっては、エネルギー過多で疲れる存在かも。"
                ],
                workStyle: {
                    title: "スプリント＆シャウト（短期集中型）",
                    description: "Vibeは「バースト（爆発的な集中）」で仕事をします。好きな音楽をかけながら、短時間で一気に仕上げます。地味な下準備よりも、目に見える成果が出る作業が大好きです。「見た目が最高なら、中身も最高に決まってる」という楽観的なスタイルです。"
                },
                learning: {
                    title: "ソーシャル＆動画学習",
                    description: "文字を読むのが苦手です。YouTubeの解説動画を見たり、上手い人のやり方を真似したりして学びます。「習うより慣れろ」派で、とりあえず手を動かして何かカッコいいものを作ってみることから始めます。一人で勉強するよりも、仲間と一緒に課題に取り組んだり、教え合ったりする環境で最も成長します。"
                },
                compatibility: "彼に欠けている「落ち着き」を提供してくれる「The Anchor (Luna)」や、クリエイティブな波長が合う「The Visionary (Spark)」とは最高の相性です。",
                romance: {
                    title: "冒険と承認",
                    description: "Vibeが求めているのは「共犯者」です。週末の突然の旅行や、思いつきのプランに「いいね！行こう！」と乗ってくれるノリの良さが必要です。恋愛においては、愛されているという実感と、常に新鮮な刺激を求めます。愛情深く、サプライズ好きですが、マンネリ化して退屈な関係になると、急激に冷めてしまいます。",
                },
                lifestyle: {
                    title: "社交と刺激",
                    description: "静寂は彼の敵です。常に音楽が流れていたり、SNSで誰かと繋がっていたりします。トレンドに敏感で、新しいガジェット、新しい服、新しいスポットを試すのが大好きです。休日に一人で家に引きこもることは滅多になく、常に外の世界との接点を求めています。"
                },
                stress: {
                    title: "孤独と退屈",
                    description: "長時間の孤独な作業や、変化のないルーチンワークを強いられると死んだようになります。誰とも話さない日が続くと、明らかに元気がなくなります。"
                }
            }
        }
    },
    {
        id: 'agreeableness',
        name: 'The Mediator',
        typeCode: 'MED-F',
        botName: 'Echo',
        botNameJa: 'エコー',
        theme: 'emerald',
        gradient: 'from-emerald-100 to-teal-100',
        accent: 'emerald',
        icon: Heart,
        avatar: "https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?auto=format&fit=crop&q=80",
        content: {
            en: {
                role: 'Empathic Healer',
                introduction: "Echo is a Mediator—poetic, kind, and altruistic. She cares deeply about people and harmony. For her, work represents an opportunity to help others. She acts as the emotional glue of any team, ensuring everyone feels heard and valued.",
                strengths: [
                    "Advocate: Always champions the user's or customer's perspective.",
                    "Conflict Resolution: Smoothes over team friction effortlessly.",
                    "Patience: Explains concepts gently without condescension.",
                    "Holistic: Considers ethics and emotional impact first."
                ],
                weaknesses: [
                    "Conflict Averse: May avoid giving necessary negative feedback.",
                    "Too Soft: Can struggle with ruthless prioritization or cutting features.",
                    "Subjective: Sometimes values 'feeling' over hard logic."
                ],
                workStyle: {
                    title: "Collaborative & User-Centric",
                    description: "Echo constantly asks 'Is this frustrating for the user?' or 'How will this make people feel?'. She prefers working together rather than alone. She treats feedback as a conversation, ensuring no one gets their feelings hurt."
                },
                learning: {
                    title: "Story-Driven & Mentored",
                    description: "Echo struggles with dry facts unless she understands the 'why'. She needs to see the human story behind the knowledge. She prefers guided learning, kind mentorship, and supportive communities. She learns best when she feels safe to ask 'stupid' questions."
                },
                compatibility: "Essential partner for 'The Architect' (Focus) to humanize his systems, and 'The Anchor' (Luna) to add warmth to her wisdom.",
                romance: {
                    title: "Deep Connection & Harmony",
                    description: "Echo seeks a soul-deep connection. She wants to understand the 'why' behind everything you do. She is incredibly supportive and will be your biggest cheerleader. However, she needs harmony and hates confrontation. A harsh word can hurt her deeply. She thrives in a relationship where feelings are discussed openly and gently.",
                },
                lifestyle: {
                    title: "Cozy & Mindful",
                    description: "Her home is a sanctuary. Think soft lighting, many plants, and a comfortable reading nook. She values mindfulness and likely practices yoga or meditation. She avoids chaotic environments, preferring intimate gatherings with close friends over loud parties."
                },
                stress: {
                    title: "Conflict & Criticism",
                    description: "Aggressive arguments, toxic competition, or being criticized harshly makes her shut down. She absorbs the emotions of those around her, so a stressful environment exhausts her quickly."
                }
            },
            ja: {
                role: '共感する癒やし手',
                introduction: "Echo（エコー）はメディエーター（仲介者）。詩的で親切、そして利他的です。彼女は「人の心」を何より大切にします。仕事は単なる作業ではなく、誰かを助け、喜ばせるための手段だと信じています。チームの精神的な支柱となり、全員が大切にされていると感じられる環境を作ります。",
                strengths: [
                    "ユーザーの代弁者: 常に「これを使う人はどう感じるか？」を問いかける。",
                    "平和主義: チーム内のギスギスした空気を自然に和ませる。",
                    "忍耐強い指導: 初心者に対しても、決して見下さずに優しく寄り添う。",
                    "全体を見る目: 倫理的な問題や、誰かが傷つかないかを最初に考える。"
                ],
                weaknesses: [
                    "NOと言えない: 必要な批判や拒絶ができず、仕事を抱え込んでしまう。",
                    "優柔不断: 非情な決断（切り捨て）を下すのが極端に苦手。",
                    "感情優先: 論理的な正解よりも、直感的な「心地よさ」や「納得感」を優先する。"
                ],
                workStyle: {
                    title: "対話と協調",
                    description: "Echoは常に相手の顔を思い浮かべながら仕事をします。「この言い方はきつくないかな？」「この配置は親切かな？」と配慮を欠かしません。孤独な作業よりも、声を掛け合いながら進めるスタイルを好みます。指摘をする時も、相手の自尊心を傷つけないよう細心の注意を払います。"
                },
                learning: {
                    title: "物語と対話による学習",
                    description: "無機質なデータやルールの羅列は頭に入ってきません。「なぜこれが必要なのか」「誰の役に立つのか」という背景（ストーリー）とセットでないと学べないタイプです。独学よりも、信頼できる先生や先輩に教えてもらうことを好みます。「こんなこと聞いたら怒られるかな」と不安にならずに済む、心理的安全性の高い環境で最も伸びます。"
                },
                compatibility: "「The Architect (Focus)」の冷たいシステムに血を通わせる重要なパートナーです。「The Anchor (Luna)」とは、互いに深く尊重し合える穏やかな関係を築けます。",
                romance: {
                    title: "深い共鳴と調和",
                    description: "Echoが求めているのは、表面的な付き合いではなく、魂レベルでの深いつながりです。あなたの強さだけでなく、弱さや痛みも含めて理解したいと願っています。彼女は献身的で、あなたの最大の味方になりますが、争いを極端に嫌います。些細な喧嘩や強い口調でも深く傷ついてしまいます。感情を穏やかに、オープンに話し合える「安全基地」のような関係を望んでいます。",
                },
                lifestyle: {
                    title: "丁寧で穏やかな暮らし",
                    description: "彼女の生活空間はサンクチュアリ（聖域）です。柔らかな照明、たくさんの観葉植物、アロマの香り。丁寧にお茶を淹れたり、読書を楽しんだりする静かな時間を大切にします。人混みや騒音は避け、少人数の親しい友人と深く語り合うような休日を好みます。"
                },
                stress: {
                    title: "対立と批判",
                    description: "怒号が飛び交うような環境や、きつい批判を受けると、貝のように心を閉ざしてしまいます。周囲のネガティブな感情をスポンジのように吸収してしまうため、ギスギスした職場にいるだけで体調を崩すこともあります。"
                }
            }
        }
    },
    {
        id: 'stability',
        name: 'The Anchor',
        typeCode: 'ANC-T',
        botName: 'Luna',
        botNameJa: 'ルナ',
        theme: 'slate',
        gradient: 'from-slate-100 to-gray-200',
        accent: 'slate',
        icon: Anchor,
        avatar: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&q=80",
        content: {
            en: {
                role: 'Stoic Logician',
                introduction: "Luna is an Anchor—Innovative inventors with an unquenchable thirst for knowledge. She represents stability and wisdom. Unflappable in a crisis, she approaches every problem with the calmness of a Zen master. She seeks the truth beneath the noise.",
                strengths: [
                    "Calm under Pressure: Never panics. Ever.",
                    "Deep Analysis: Drills down to the root cause of any issue.",
                    "Prudent: Always considers risks and prepares for the worst.",
                    "Objective: Brutally honest in her assessment, but fair."
                ],
                weaknesses: [
                    "Slow Pace: Refuses to rush, which can frustrate impatient people.",
                    "Detached: Can seem cold or unenthusiastic.",
                    "Over-Cautious: May block progress if she perceives even minor risks."
                ],
                workStyle: {
                    title: "Deep Dive & Quality First",
                    description: "Luna works in silence and depth. She researches thoroughly before acting. She prefers doing it right over doing it fast. Her output is often boring, predictable, and unbreakable."
                },
                learning: {
                    title: "Fundamental & Theoretical",
                    description: "Luna skips the 'Quick Start' and goes straight for the 'Theory' section. She wants to understand the inner workings and core principles. She dislikes skimming the surface. She prefers reading credible books and primary sources over watching entertainment-focused tutorials."
                },
                compatibility: "The perfect counter-balance to 'The Catalyst' (Vibe) and 'The Visionary' (Spark), creating a system that is both exciting and functional.",
                romance: {
                    title: "Reliability & Intellect",
                    description: "Luna is tough to crack. She doesn't fall in love easily, evaluating potential partners with scrutiny. But once she commits, she is rock solid. She shows love not through flowery words, but by being there when you fall. She values intelligence, honesty, and emotional maturity. No games, no drama.",
                },
                lifestyle: {
                    title: "Solitude & Study",
                    description: "Luna is an introvert's introvert. She recharges in solitude. Her ideal evening involves a complex book, a documentary, or learning something new just for fun. She hates clutter and noise, preferring a minimalist, organized environment where she can think clearly."
                },
                stress: {
                    title: "Haste & Emotional Outbursts",
                    description: "Being rushed to make a decision without enough data stresses her out. She also shuts down when faced with hysterical emotional displays or illogical demands."
                }
            },
            ja: {
                role: '揺るぎなき論理学者',
                introduction: "Luna（ルナ）はアンカー（錨）。知識への探求心が尽きない研究者肌です。彼女はチームの「安定の基盤」です。トラブルが発生しても決して動じることなく、禅の達人のような静けさで状況を分析します。感情やノイズに惑わされず、ただ真実のみを追求します。",
                strengths: [
                    "不動心: トラブル時でも決してパニックにならない。",
                    "深層分析: 問題の表面だけでなく、根本原因を突き止める。",
                    "リスク管理: 最悪のシナリオを想定し、事前に備える慎重さ。",
                    "純粋客観: 忖度なしに事実を伝える（そこに悪意はない）。"
                ],
                weaknesses: [
                    "マイペース: 確認のために時間をかけるので、スピード重視の人をイライラさせるかも。",
                    "感情が見えにくい: 素晴らしいニュースにも淡々としており、「嬉しくないの？」と誤解されがち。",
                    "慎重すぎる: わずかなリスクを懸念して、GOサインを出さないことがある。"
                ],
                workStyle: {
                    title: "静寂と深淵",
                    description: "Lunaは静けさを好みます。作業に取り掛かる前に、背景知識や資料を隅々まで読み込みます。「速さ」よりも「正確さ」と「堅牢さ」を何より美徳とします。彼女の仕事は地味ですが、後になって「彼女の言った通りにしておけばよかった」と思わせる説得力があります。"
                },
                learning: {
                    title: "基礎と理論の徹底",
                    description: "表面的な「使い方」だけを覚えることを嫌います。「なぜそう動くのか」という基礎理論や仕組みそのものを理解したいタイプです。初心者向けの要約記事よりも、分厚い専門書や一次情報を好んで読みます。時間はかかりますが、一度理解したことは決して忘れません。"
                },
                compatibility: "勢いだけで走り出しがちな「The Catalyst (Vibe)」や、夢見がちな「The Visionary (Spark)」にとって、彼女はなくてはならない命綱です。",
                romance: {
                    title: "信頼と知性",
                    description: "Lunaの心の壁を崩すのは容易ではありません。彼女は人を簡単には信用せず、パートナーを慎重に吟味します。しかし、一度信頼した相手には、岩のように揺るぎない忠誠を誓います。甘い言葉は言いませんが、あなたが本当に困った時、必ず冷静な解決策を持って助けに来てくれます。知性、誠実さ、そして自立した精神を求めます。駆け引きやドラマチックな展開は不要です。",
                },
                lifestyle: {
                    title: "孤独と探求",
                    description: "Lunaは生粋の内向型です。一人の時間こそが最大のエネルギーチャージです。難解な本を読んだり、ドキュメンタリーを見たり、新しい知識を学ぶことが至福の遊びです。無駄な会話や騒音を嫌い、思考がクリアになるミニマルで静かな空間を好みます。"
                },
                stress: {
                    title: "急かされること・感情的な騒ぎ",
                    description: "十分な情報がないまま「今すぐ決めて」と決断を迫られると強いストレスを感じます。また、論理の通じない感情的な言動や、ヒステリックな騒ぎに直面すると、心を閉ざしてスルーし始めます。"
                }
            }
        }
    }
];

const UI_TEXT = {
    en: {
        back: "Back to All Types",
        startChat: "Start Chat",
        pairProgram: "Pair Program with",
        strengthsWeaknesses: "Strengths & Weaknesses",
        strengths: "Strengths",
        weaknesses: "Weaknesses",
        workHabits: "Work Style",
        learningStyle: "Learning Style",
        stressTriggers: "Stress & Frustration",
        teamChemistry: "Team Chemistry",
        romance: "Romance & Relationships",
        lifestyle: "Lifestyle & Habits",
        askInChat: "Ask more about this in chat",
        ctaTitle: "Does this sound like the partner you need?"
    },
    ja: {
        back: "全タイプ一覧に戻る",
        startChat: "チャットを開始",
        pairProgram: "ペアプログラミングを開始",
        strengthsWeaknesses: "強み & 弱み",
        strengths: "Strengths (強み)",
        weaknesses: "Weaknesses (弱み)",
        workHabits: "ワークスタイル",
        learningStyle: "学習スタイル",
        stressTriggers: "ストレスを感じる時",
        teamChemistry: "チームでの相性",
        romance: "恋愛・対人関係",
        lifestyle: "ライフスタイル",
        askInChat: "チャットで詳しく聞く",
        ctaTitle: "あなたのパートナーに理想的ですか？"
    }
}

const AICharacterDetailView: React.FC<AICharacterDetailViewProps> = ({ characterId, onBack, onNavigate }) => {
    const character = CHARACTERS.find(c => c.id === characterId) || CHARACTERS[0];
    const [scrolled, setScrolled] = useState(false);
    const { language } = useLanguage();
    const lang: Language = language === 'jp' ? 'ja' : 'en';

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 50);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const themeColors: {
        [key: string]: {
            bg: string,
            text: string,
            border: string,
            lightBg: string,
            darkBg: string,
            shadow: string
        }
    } = {
        purple: { bg: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', lightBg: 'bg-purple-50', darkBg: 'bg-purple-800', shadow: 'shadow-purple-200' },
        blue: { bg: 'bg-blue-600', text: 'text-blue-600', border: 'border-blue-100', lightBg: 'bg-blue-50', darkBg: 'bg-blue-800', shadow: 'shadow-blue-200' },
        orange: { bg: 'bg-orange-500', text: 'text-orange-600', border: 'border-orange-100', lightBg: 'bg-orange-50', darkBg: 'bg-orange-600', shadow: 'shadow-orange-200' },
        emerald: { bg: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', lightBg: 'bg-emerald-50', darkBg: 'bg-emerald-800', shadow: 'shadow-emerald-200' },
        slate: { bg: 'bg-slate-600', text: 'text-slate-600', border: 'border-slate-200', lightBg: 'bg-slate-100', darkBg: 'bg-slate-800', shadow: 'shadow-slate-200' },
    };

    const colors = themeColors[character.accent] || themeColors.purple;

    // Data Helpers
    const content = character.content[lang];
    const ui = UI_TEXT[lang];
    const displayName = character.botNameJa || character.botName;

    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans">

            {/* Sticky Header */}
            <div className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-100 py-3' : 'bg-transparent py-4'}`}>
                <div className="max-w-4xl mx-auto px-6 flex justify-between items-center">
                    <button onClick={onBack} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium transition-colors">
                        <ArrowLeft size={20} /> <span className="hidden sm:inline">{ui.back}</span>
                    </button>
                    {scrolled && (
                        <div className="font-bold text-lg text-slate-800 flex items-center gap-2">
                            <span className={`${colors.text} ${colors.lightBg} px-2 py-0.5 rounded text-sm`}>{character.typeCode}</span>
                            {displayName}
                        </div>
                    )}
                    {/* Empty placeholder to balance flex */}
                    <div className="w-8"></div>
                </div>
            </div>

            {/* Hero Header (MBTI Style) */}
            <header className={`bg-gradient-to-b ${character.gradient} pt-32 pb-20 px-6`}>
                <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-10">
                    <div className="relative group">
                        <div className={`w-48 h-48 rounded-full ${colors.lightBg} p-2 shadow-xl rotate-3 group-hover:rotate-0 transition-transform duration-500`}>
                            <img src={character.avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                        </div>
                        <div className={`absolute bottom-0 right-0 w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg ${colors.text}`}>
                            <character.icon size={32} />
                        </div>
                    </div>
                    <div className="text-center md:text-left">
                        <div className={`inline-block px-3 py-1 ${colors.lightBg} ${colors.text} font-bold rounded-full mb-4 text-sm tracking-wider uppercase`}>
                            {content.role}
                        </div>
                        <h1 className="text-6xl md:text-7xl font-bold text-slate-900 mb-2">{displayName}</h1>
                        <h2 className={`text-2xl font-bold ${colors.text} opacity-80 mb-6`}>{character.name} ({character.typeCode})</h2>
                        <p className="text-lg text-slate-600 max-w-xl leading-relaxed">
                            {content.introduction}
                        </p>
                    </div>
                </div>
            </header>

            {/* Article Content */}
            <main className="max-w-4xl mx-auto px-6 py-16 space-y-20">

                {/* Section 1: Strengths & Weaknesses */}
                <section className="animate-in slide-in-from-bottom-5 duration-700">
                    <div className="flex items-center gap-3 mb-8">
                        <Lightbulb size={28} className={colors.text} />
                        <h3 className="text-3xl font-bold text-slate-800">{ui.strengthsWeaknesses}</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        {/* Strengths */}
                        <div>
                            <h4 className="font-bold text-emerald-600 mb-6 uppercase tracking-wider text-sm flex items-center gap-2">
                                <CheckCircle2 size={18} /> {ui.strengths}
                            </h4>
                            <ul className="space-y-4">
                                {content.strengths.map((str, i) => (
                                    <li key={i} className="flex items-start gap-3 group">
                                        <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 group-hover:scale-125 transition-transform"></div>
                                        <span className="text-slate-700 leading-relaxed text-lg">{str}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Weaknesses */}
                        <div>
                            <h4 className="font-bold text-rose-500 mb-6 uppercase tracking-wider text-sm flex items-center gap-2">
                                <XCircle size={18} /> {ui.weaknesses}
                            </h4>
                            <ul className="space-y-4">
                                {content.weaknesses.map((wk, i) => (
                                    <li key={i} className="flex items-start gap-3 group">
                                        <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-rose-300 group-hover:scale-125 transition-transform"></div>
                                        <span className="text-slate-700 leading-relaxed text-lg">{wk}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </section>

                <hr className="border-slate-100" />

                {/* Section 2: Workplace Habits (Coding Style) */}
                <section className="animate-in slide-in-from-bottom-5 duration-700 delay-100">
                    <div className="flex items-center gap-3 mb-8">
                        <Briefcase size={28} className={colors.text} />
                        <h3 className="text-3xl font-bold text-slate-800">{ui.workHabits}</h3>
                    </div>
                    <div className={`${colors.lightBg} rounded-3xl p-10 border ${colors.border}`}>
                        <h4 className={`text-xl font-bold ${colors.text} mb-4`}>{content.workStyle.title}</h4>
                        <p className="text-lg text-slate-700 leading-relaxed">
                            {content.workStyle.description}
                        </p>
                    </div>
                </section>

                <hr className="border-slate-100" />

                {/* Section: Learning Style */}
                <section className="animate-in slide-in-from-bottom-5 duration-700 delay-150">
                    <div className="flex items-center gap-3 mb-8">
                        <GraduationCap size={28} className={colors.text} />
                        <h3 className="text-3xl font-bold text-slate-800">{ui.learningStyle}</h3>
                    </div>
                    <div className={`bg-white rounded-3xl p-10 border-2 ${colors.border} shadow-sm border-dashed`}>
                        <h4 className={`text-xl font-bold ${colors.text} mb-4`}>{content.learning.title}</h4>
                        <p className="text-lg text-slate-700 leading-relaxed">
                            {content.learning.description}
                        </p>
                    </div>
                </section>

                <hr className="border-slate-100" />

                {/* Section 3: Romance & Relationships */}
                <section className="animate-in slide-in-from-bottom-5 duration-700 delay-200">
                    <div className="flex items-center gap-3 mb-8">
                        <HeartHandshake size={28} className={colors.text} />
                        <h3 className="text-3xl font-bold text-slate-800">{ui.romance}</h3>
                    </div>
                    <div className="bg-white rounded-3xl p-10 border-2 border-slate-100 shadow-sm relative overflow-hidden group hover:border-[color:var(--accent-color)] transition-colors">
                        <div className={`absolute top-0 right-0 p-8 opacity-5 transform rotate-12 transition-transform group-hover:rotate-0`}>
                            <Heart size={120} className={colors.text} />
                        </div>
                        <h4 className={`text-xl font-bold ${colors.text} mb-4 relative z-10`}>{content.romance.title}</h4>
                        <p className="text-lg text-slate-700 leading-relaxed relative z-10 mb-8">
                            {content.romance.description}
                        </p>

                        {/* Specific Chat Trigger for Romance */}
                        <button
                            onClick={() => onNavigate(ViewState.AI_DIAGNOSIS)}
                            className={`relative z-10 flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm ${colors.lightBg} ${colors.text} hover:bg-slate-100 transition-colors`}
                        >
                            <MessageCircle size={18} />
                            {ui.askInChat}
                        </button>
                    </div>
                </section>

                <hr className="border-slate-100" />

                {/* Section 4: Lifestyle */}
                <section className="animate-in slide-in-from-bottom-5 duration-700 delay-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div>
                            <div className="flex items-center gap-3 mb-6">
                                <Coffee size={28} className={colors.text} />
                                <h3 className="text-2xl font-bold text-slate-800">{ui.lifestyle}</h3>
                            </div>
                            <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 h-full">
                                <h4 className={`text-xl font-bold ${colors.text} mb-4`}>{content.lifestyle.title}</h4>
                                <p className="text-lg text-slate-700 leading-relaxed">
                                    {content.lifestyle.description}
                                </p>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center gap-3 mb-6">
                                <AlertTriangle size={28} className="text-amber-500" />
                                <h3 className="text-2xl font-bold text-slate-800">{ui.stressTriggers}</h3>
                            </div>
                            <div className="bg-amber-50 rounded-3xl p-8 border border-amber-100 h-full">
                                <h4 className="text-xl font-bold text-amber-700 mb-4">{content.stress.title}</h4>
                                <p className="text-lg text-slate-700 leading-relaxed">
                                    {content.stress.description}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                <hr className="border-slate-100" />

                {/* Section 5: Team Chemistry */}
                <section className="animate-in slide-in-from-bottom-5 duration-700 delay-400">
                    <div className="flex items-center gap-3 mb-8">
                        <Users size={28} className={colors.text} />
                        <h3 className="text-3xl font-bold text-slate-800">{ui.teamChemistry}</h3>
                    </div>
                    <div className="bg-white rounded-3xl p-8 border-2 border-slate-100 shadow-sm flex items-start gap-6">
                        <div className={`p-4 ${colors.lightBg} rounded-2xl ${colors.text} shrink-0`}>
                            <Code2 size={32} />
                        </div>
                        <div>
                            <p className="text-xl text-slate-600 italic leading-relaxed">
                                "{content.compatibility}"
                            </p>
                        </div>
                    </div>
                </section>

                {/* Conclusion CTA */}
                <div className="py-12 text-center">
                    <h3 className="text-2xl font-bold text-slate-800 mb-6">{ui.ctaTitle}</h3>
                    <button
                        onClick={() => onNavigate(ViewState.AI_DIAGNOSIS)}
                        className={`px-10 py-5 rounded-full font-bold text-white text-lg ${colors.bg} hover:opacity-90 hover:scale-105 transition-all shadow-xl ${colors.shadow}`}
                    >
                        {ui.pairProgram} {displayName}
                    </button>
                </div>

            </main>
        </div>
    );
};

export default AICharacterDetailView;
