import { LocalizedText } from '../../../../types';

export interface Question {
  id: number;
  text: LocalizedText;
  category: "openness" | "conscientiousness" | "extraversion" | "agreeableness" | "neuroticism";
}

export const BIG_FIVE_QUESTIONS: Question[] = [
  {
    id: 1,
    text: { en: "I enjoy coming up with new ideas.", jp: "新しいアイデアを考えるのが好きだ", fr: "J'aime imaginer de nouvelles idées." },
    category: "openness"
  },
  {
    id: 2,
    text: { en: "I pay close attention to details.", jp: "細部にまで注意を払う", fr: "Je fais attention aux détails." },
    category: "conscientiousness"
  },
  {
    id: 3,
    text: { en: "I enjoy social situations like parties.", jp: "パーティーなどの社交的な場が楽しい", fr: "J'apprécie les situations sociales comme les fêtes." },
    category: "extraversion"
  },
  {
    id: 4,
    text: { en: "I empathize with others' feelings easily.", jp: "他人の感情に共感しやすい", fr: "J'empathise facilement avec les émotions des autres." },
    category: "agreeableness"
  },
  {
    id: 5,
    text: { en: "I tend to feel stressed by small things.", jp: "些細なことでストレスを感じやすい", fr: "Je suis facilement stressé(e) par de petites choses." },
    category: "neuroticism"
  },
];

export const RATING_OPTIONS = [
  { value: 1, label: { en: "Not at all", jp: "全くない", fr: "Pas du tout" }, size: "w-6 h-6", color: "bg-slate-200" },
  { value: 2, label: { en: "Not much", jp: "あまりない", fr: "Plutôt non" }, size: "w-8 h-8", color: "bg-slate-300" },
  { value: 3, label: { en: "Neutral", jp: "どちらでもない", fr: "Neutre" }, size: "w-10 h-10", color: "bg-indigo-300" },
  { value: 4, label: { en: "Somewhat", jp: "少しある", fr: "Plutôt oui" }, size: "w-12 h-12", color: "bg-indigo-400" },
  { value: 5, label: { en: "Very much", jp: "非常にある", fr: "Tout à fait" }, size: "w-14 h-14", color: "bg-indigo-600" },
];

export { ASSESSMENT_PROFILE_STORAGE_KEY as STORAGE_KEY } from '../../../../constants/assessment';
