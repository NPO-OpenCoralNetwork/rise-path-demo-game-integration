
import { Question } from './types';

export const BIG_FIVE_QUESTIONS: Question[] = [
  { id: 1, text: "新しいアイデアを考えるのが好きだ", category: "openness" },
  { id: 2, text: "細部にまで注意を払う", category: "conscientiousness" },
  { id: 3, text: "パーティーなどの社交的な場が楽しい", category: "extraversion" },
  { id: 4, text: "他人の感情に共感しやすい", category: "agreeableness" },
  { id: 5, text: "些細なことでストレスを感じやすい", category: "neuroticism" },
  { id: 6, text: "抽象的な概念を理解するのが得意だ", category: "openness" },
  { id: 7, text: "物事を整理整頓するのが好きだ", category: "conscientiousness" },
  { id: 8, text: "初対面の人ともすぐに打ち解けられる", category: "extraversion" },
  { id: 9, text: "誰にでも親切に接することを心がけている", category: "agreeableness" },
  { id: 10, text: "感情の起伏が激しい方だ", category: "neuroticism" },
  { id: 11, text: "芸術や美的なものに深く感動する", category: "openness" },
  { id: 12, text: "計画を立ててから行動する", category: "conscientiousness" },
  { id: 13, text: "注目の的になるのが好きだ", category: "extraversion" },
  { id: 14, text: "争いごとは極力避けたい", category: "agreeableness" },
  { id: 15, text: "自分に自信が持てないことが多い", category: "neuroticism" },
  { id: 16, text: "知的好奇心が旺盛だ", category: "openness" },
  { id: 17, text: "責任感が強く、最後までやり遂げる", category: "conscientiousness" },
  { id: 18, text: "一人の時間よりも誰かといる方が好きだ", category: "extraversion" },
  { id: 19, text: "相手を信頼しやすい", category: "agreeableness" },
  { id: 20, text: "不安を感じるとパニックになりやすい", category: "neuroticism" },
];

export const RATING_OPTIONS = [
  { value: 1, label: "全くない", size: "w-6 h-6", color: "bg-slate-200" },
  { value: 2, label: "あまりない", size: "w-8 h-8", color: "bg-slate-300" },
  { value: 3, label: "どちらでもない", size: "w-10 h-10", color: "bg-indigo-300" },
  { value: 4, label: "少しある", size: "w-12 h-12", color: "bg-indigo-400" },
  { value: 5, label: "非常にある", size: "w-14 h-14", color: "bg-indigo-600" },
];

export const STORAGE_KEY = 'personalized.profile.v1';
