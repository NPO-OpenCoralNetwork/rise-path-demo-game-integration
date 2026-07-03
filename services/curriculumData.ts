import { PersonalizedLesson, LessonTemplate, Course, DailyVocabulary, GrammarQuiz } from '../types';

export const CORE_TEMPLATES: LessonTemplate[] = [
  { id: 't1', category: 'core', text: "I’m interested in exploring how [A] relates to [B].", example: "I’m interested in exploring how AI relates to education." },
  { id: 't2', category: 'core', text: "From a cultural perspective, [X] is often seen as [Y].", example: "From a cultural perspective, silence is often seen as respect." },
  { id: 't3', category: 'core', text: "What I mean is [Statement].", example: "What I mean is we need more time." },
];

export const BRIDGING_TEMPLATES: LessonTemplate[] = [
  { id: 'b1', category: 'bridging', text: "... at the same time ...", example: "It's expensive, but at the same time, it's high quality." },
  { id: 'b2', category: 'bridging', text: "This leads to...", example: "This leads to a better user experience." },
];

export const SOFTENING_TEMPLATES: LessonTemplate[] = [
  { id: 's1', category: 'softening', text: "It seems that...", example: "It seems that there is a bug." },
  { id: 's2', category: 'softening', text: "I might suggest...", example: "I might suggest a different approach." },
];

export const TODAY_LESSON: PersonalizedLesson = {
  id: "L001",
  title: "Week 1: Connecting Ideas",
  goal: "Talk about your current interest clearly in 3-5 sentences using a core template.",
  tags: ["core", "output"],
  templates: [CORE_TEMPLATES[0], CORE_TEMPLATES[1], SOFTENING_TEMPLATES[0]],
  tasks: [
    { type: "output_3sentences", prompt: "Write 3-5 sentences about a topic you are currently exploring. Use at least one template and one linking word." }
  ],
  rubric: {
    clarity: "Message is understandable without extra context.",
    linking: "Uses at least one linking word correctly (however, therefore, etc.).",
    tone: "Uses safe/soft language (not too absolute)."
  }
};

export const DAILY_VOCAB: DailyVocabulary = {
  word: "Serendipity",
  partOfSpeech: "Noun",
  definition: "The occurrence of events by chance in a happy or beneficial way.",
  pronunciation: "/ˌser.ənˈdɪp.ə.ti/",
  exampleSentence: "We found the restaurant by pure serendipity, and it was the best meal of the trip."
};

export const DAILY_GRAMMAR: GrammarQuiz = {
  id: "g1",
  question: "I _____ to the conference if I finish this report on time.",
  options: ["will go", "would go", "went"],
  correctAnswer: 0,
  explanation: "This is the First Conditional. We use 'will' for real possibilities in the future."
};

export const COURSES_DATA: Course[] = [
  {
    id: '1',
    title: { en: 'Survival English for Travel', jp: '旅行のためのサバイバル英語' },
    description: { en: 'Essential phrases for airports, hotels, and restaurants.', jp: '空港、ホテル、レストランで必須のフレーズ集。' },
    category: 'Beginner A1',
    progress: 80,
    totalLessons: 15,
    completedLessons: 12,
    thumbnail: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&q=80&w=800',
    color: 'bg-green-500'
  },
  {
    id: '2',
    title: { en: 'Daily Conversation Mastery', jp: '日常会話マスター' },
    description: { en: 'Small talk, hobbies, and making friends.', jp: '日常の雑談、趣味、友人作りについて。' },
    category: 'Elementary A2',
    progress: 45,
    totalLessons: 20,
    completedLessons: 9,
    thumbnail: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&q=80&w=800',
    color: 'bg-blue-500'
  },
  {
    id: '3',
    title: { en: 'Business Communication', jp: 'ビジネスコミュニケーション' },
    description: { en: 'Emails, presentations, and professional etiquette.', jp: 'メール、プレゼンテーション、プロフェッショナルなマナー。' },
    category: 'Intermediate B1',
    progress: 10,
    totalLessons: 25,
    completedLessons: 2,
    thumbnail: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&q=80&w=800',
    color: 'bg-indigo-500'
  },
  {
    id: '4',
    title: { en: 'Advanced Grammar Deep Dive', jp: '上級英文法ディープダイブ' },
    description: { en: 'Master complex tenses and subjunctive mood.', jp: '複雑な時制や仮定法をマスターする。' },
    category: 'Upper Int B2',
    progress: 0,
    totalLessons: 30,
    completedLessons: 0,
    thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&q=80&w=800',
    color: 'bg-purple-500'
  },
  {
    id: '5',
    title: { en: 'American Slang & Idioms', jp: 'アメリカンスラングと慣用句' },
    description: { en: 'Speak like a native with popular expressions.', jp: 'ネイティブのような自然な表現を学ぶ。' },
    category: 'Culture',
    progress: 0,
    totalLessons: 10,
    completedLessons: 0,
    thumbnail: 'https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?auto=format&fit=crop&q=80&w=800',
    color: 'bg-pink-500'
  },
  {
    id: '6',
    title: { en: 'TOEIC Exam Preparation', jp: 'TOEIC試験対策' },
    description: { en: 'Practice tests and strategies for high scores.', jp: '高得点のための模擬試験と戦略。' },
    category: 'Test Prep',
    progress: 0,
    totalLessons: 40,
    completedLessons: 0,
    thumbnail: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&q=80&w=800',
    color: 'bg-orange-500'
  }
];

export const getCourseById = (id: string): Course | undefined => {
  return COURSES_DATA.find(c => c.id === id);
};

// --- Per-course lesson data ---

const COURSE_LESSONS: Record<string, PersonalizedLesson> = {
  '1': {
    id: 'L-travel-1',
    title: 'At the Airport',
    goal: 'Practice essential phrases for navigating an international airport.',
    tags: ['travel', 'output'],
    templates: [
      { id: 'tr1', category: 'core', text: "Excuse me, could you tell me where [place] is?", example: "Excuse me, could you tell me where Gate 12 is?" },
      { id: 'tr2', category: 'softening', text: "I'm sorry, I think there might be...", example: "I'm sorry, I think there might be a mistake with my seat." },
      { id: 'tr3', category: 'bridging', text: "After that, I need to...", example: "After that, I need to go through customs." },
    ],
    tasks: [{ type: 'output_3sentences', prompt: 'Write 3-5 sentences describing your experience going through an airport. Use at least one template.' }],
    rubric: { clarity: 'Message is understandable for airport staff.', linking: 'Uses sequence words (first, then, after that).', tone: 'Polite and clear.' }
  },
  '2': {
    id: 'L-daily-1',
    title: 'Making Small Talk',
    goal: 'Start and maintain casual conversations about hobbies and interests.',
    tags: ['conversation', 'output'],
    templates: [
      { id: 'dc1', category: 'core', text: "I've been really into [hobby] lately.", example: "I've been really into cooking lately." },
      { id: 'dc2', category: 'bridging', text: "That reminds me of...", example: "That reminds me of a trip I took last year." },
      { id: 'dc3', category: 'softening', text: "I'm not sure, but I think...", example: "I'm not sure, but I think it opens at 10." },
    ],
    tasks: [{ type: 'output_3sentences', prompt: 'Write a short conversation where you tell someone about your weekend hobby. Use natural transitions.' }],
    rubric: { clarity: 'Easy to follow the topic flow.', linking: 'Natural transitions between ideas.', tone: 'Friendly and casual.' }
  },
  '3': {
    id: 'L-biz-1',
    title: 'Professional Email Writing',
    goal: 'Write a clear, professional email requesting a meeting.',
    tags: ['business', 'output'],
    templates: [
      { id: 'bz1', category: 'core', text: "I am writing to inquire about [topic].", example: "I am writing to inquire about the project timeline." },
      { id: 'bz2', category: 'softening', text: "Would it be possible to...", example: "Would it be possible to schedule a call this week?" },
      { id: 'bz3', category: 'bridging', text: "In addition to that...", example: "In addition to that, I'd like to discuss the budget." },
    ],
    tasks: [{ type: 'output_3sentences', prompt: 'Write a short professional email (3-5 sentences) requesting a meeting with a client. Be polite but direct.' }],
    rubric: { clarity: 'Purpose of the email is immediately clear.', linking: 'Logical flow from greeting to request.', tone: 'Professional without being stiff.' }
  },
  '4': {
    id: 'L-grammar-1',
    title: 'Conditional Sentences',
    goal: 'Master the difference between first, second, and third conditionals.',
    tags: ['grammar', 'output'],
    templates: [
      { id: 'gr1', category: 'core', text: "If [condition], [result].", example: "If I had more time, I would learn Japanese." },
      { id: 'gr2', category: 'core', text: "Unless [exception], [consequence].", example: "Unless it rains, we'll go hiking." },
      { id: 'gr3', category: 'bridging', text: "On the other hand...", example: "On the other hand, some people prefer online classes." },
    ],
    tasks: [{ type: 'output_3sentences', prompt: 'Write 3-5 sentences using different conditional types. Include at least one "If I had..." and one "If I...".' }],
    rubric: { clarity: 'Conditionals are grammatically correct.', linking: 'Smooth transitions between examples.', tone: 'Natural, not textbook-like.' }
  },
  '5': {
    id: 'L-slang-1',
    title: 'Common American Idioms',
    goal: 'Use popular American expressions naturally in context.',
    tags: ['culture', 'output'],
    templates: [
      { id: 'sl1', category: 'core', text: "To be honest, I'm kind of [feeling].", example: "To be honest, I'm kind of on the fence about it." },
      { id: 'sl2', category: 'core', text: "It's no big deal, but...", example: "It's no big deal, but I think we missed the bus." },
      { id: 'sl3', category: 'bridging', text: "Long story short...", example: "Long story short, we ended up at a different restaurant." },
    ],
    tasks: [{ type: 'output_3sentences', prompt: 'Write a casual story (3-5 sentences) using at least two American expressions naturally.' }],
    rubric: { clarity: 'Story makes sense to a native speaker.', linking: 'Expressions flow naturally.', tone: 'Casual and authentic.' }
  },
  '6': {
    id: 'L-toeic-1',
    title: 'TOEIC Part 5 Practice',
    goal: 'Complete sentences by choosing the correct word form.',
    tags: ['test-prep', 'output'],
    templates: [
      { id: 'to1', category: 'core', text: "The report was [adverb] completed by the team.", example: "The report was efficiently completed by the team." },
      { id: 'to2', category: 'core', text: "[Subject] is responsible for [gerund].", example: "The manager is responsible for overseeing the project." },
      { id: 'to3', category: 'bridging', text: "Due to [reason], we have decided to...", example: "Due to budget constraints, we have decided to postpone." },
    ],
    tasks: [{ type: 'output_3sentences', prompt: 'Write 3-5 formal sentences that could appear in a TOEIC reading section. Focus on correct word forms.' }],
    rubric: { clarity: 'Sentences use correct grammar.', linking: 'Formal connectors used properly.', tone: 'Business-appropriate register.' }
  },
};

export const getLessonForCourse = (courseId: string): PersonalizedLesson => {
  return COURSE_LESSONS[courseId] || TODAY_LESSON;
};