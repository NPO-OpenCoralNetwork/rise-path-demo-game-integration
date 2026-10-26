/**
 * Every learner-facing message of the review page and the dashboard card (Phase 6), in English
 * and Japanese (です・ます). The scheduler's name is never shown (doc/brushup-2026/PLAN.ja.md).
 * Rule: 「もう一度」 / "again" appear only as the Again button's label (`again`); a retry or
 * flip-back line says 「また」「読み込み直す」 / "once more", "Reload", so the button's word never
 * means two things on one screen (server/tests/phase6Front.test.js checks it).
 */
type ReviewCopy = {
  eyebrow: string;
  title: string;
  description: string;
  counter: (k: number, total: number) => string;
  front: string;
  back: string;
  from: string;
  answerLive: (text: string) => string;
  tryFirst: string;
  flipBack: string;
  ask: string;
  again: string;
  againHelp: string;
  good: string;
  goodHelp: string;
  busy: string;
  recorded: string;
  help: { offline: string; auth: string; loading: string; later: string };
  alreadyToday: string;
  notYet: string;
  gone: string;
  gradeFailed: (button: string) => string;
  rateLimited: string;
  switched: string;
  /** The session ended because nobody is signed in any more (a logout, an expiry, another tab's logout). */
  signedOut: string;
  doneTitle: string;
  carried: (k: number) => string;
  next: (date: string) => string;
  noneToday: string;
  emptyTitle: string;
  emptyBody: string;
  noAccountTitle: string;
  noAccountBody: string;
  unsupported: string;
  loadFailed: string;
  reload: string;
  offlineLoad: string;
  loading: string;
  toDashboard: string;
  card: {
    title: string;
    dueTitle: (n: number, minutes: number) => string;
    dueBody: string;
    start: string;
    doneTitle: string;
    noneTodayTitle: string;
    emptyTitle: string;
    noAccountBody: string;
    loadingBody: string;
    unavailableBody: string;
    unsupportedBody: string;
  };
};

const copy = {
  en: {
    eyebrow: 'Review',
    title: "Today's review",
    description: "Cards from your lessons come back just before you'd forget them: up to 10 a day, the ones you are closest to forgetting first.",
    counter: (k, total) => `Card ${k} of ${total} today`,
    front: 'Question',
    back: 'Answer',
    from: 'From: ',
    answerLive: (text) => `Answer: ${text}`,
    tryFirst: 'Try to remember first, then tap the card to see the answer.',
    flipBack: 'Tap the card to see the question.',
    ask: 'Did you remember it?',
    again: 'Again',
    againHelp: 'Comes back soon.',
    good: 'Got it',
    goodHelp: 'Comes back after a longer gap.',
    busy: 'Saving…',
    recorded: 'Recorded. Next card.',
    help: {
      offline: "You can record your answer once you're back online.",
      auth: 'Please sign in to record your answer.',
      loading: 'You can record your answer once loading has finished.',
      later: "You can't record your answer right now.",
    },
    alreadyToday: 'This card was already recorded today.',
    notYet: "This card isn't due yet.",
    gone: "This card isn't in your review right now.",
    gradeFailed: (button) => `We couldn't save "${button}". Press the same button once more.`,
    rateLimited: 'Too many in a row. Wait a moment, then press the same button once more.',
    switched: 'Another account signed in, so this review stopped here.',
    signedOut: 'You were signed out, so this review stopped here.',
    doneTitle: "That's today's review done. Nice work.",
    carried: (k) => `The other ${k} ${k === 1 ? 'card moves' : 'cards move'} to the coming days.`,
    next: (date) => `Your next review is on ${date}.`,
    noneToday: 'Nothing to review today.',
    emptyTitle: 'No review cards yet.',
    emptyBody: "When you finish a lesson that has review cards, they show up here just before you'd forget them (the next day at the earliest).",
    noAccountTitle: 'Sign in to use reviews',
    noAccountBody: "Sign in with a Rise Path account and the review cards of the lessons you finish come back just before you'd forget them. The review cards inside each lesson are always there.",
    unsupported: "Reviews aren't available right now. Please come back later.",
    loadFailed: "Reviews can't be loaded right now.",
    reload: 'Reload',
    offlineLoad: "Today's review loads once you're back online.",
    loading: 'Loading…',
    toDashboard: 'Back to the dashboard',
    card: {
      title: "Today's review",
      dueTitle: (n, minutes) => `Today's review: ${n} ${n === 1 ? 'card' : 'cards'} (about ${minutes} min)`,
      dueBody: 'The cards you are closest to forgetting come first.',
      start: 'Start review',
      doneTitle: "Today's review is done",
      noneTodayTitle: 'Nothing to review today',
      emptyTitle: 'No review cards yet',
      noAccountBody: "Sign in with a Rise Path account and the review cards of the lessons you finish come back just before you'd forget them.",
      loadingBody: 'Loading…',
      unavailableBody: "Reviews can't be loaded right now.",
      unsupportedBody: "Reviews aren't available right now.",
    },
  } satisfies ReviewCopy,
  jp: {
    eyebrow: '復習',
    title: '今日の復習',
    description: 'レッスンで出てきたカードが、忘れかけたころにまた出ます。1 日 10 枚まで、忘れかけているものからです。',
    counter: (k, total) => `今日の ${k} / ${total} 枚目`,
    front: '問い',
    back: '答え',
    from: 'レッスン: ',
    answerLive: (text) => `答え：${text}`,
    tryFirst: 'まず思い出してから、カードを押して答えを見ましょう。',
    flipBack: 'カードをまた押すと、問いに戻ります。',
    ask: '思い出せましたか？',
    again: 'もう一度',
    againHelp: '近いうちに、また出ます。',
    good: '覚えた',
    goodHelp: '間をあけて、また出ます。',
    busy: '記録しています…',
    recorded: '記録しました。次のカードです。',
    help: {
      offline: 'インターネットにつながると、記録できます。',
      auth: 'ログインし直すと、答えを記録できます。',
      loading: '読み込みが終わると、答えを記録できます。',
      later: 'いまは答えを記録できません。',
    },
    alreadyToday: 'このカードは、今日はもう記録されています。',
    notYet: 'このカードは、まだ復習の日ではありません。',
    gone: 'このカードは、いまは復習にありません。',
    gradeFailed: (button) => `「${button}」を記録できませんでした。同じボタンを、また押してください。`,
    rateLimited: '続けて押されたため、記録を止めています。少し待ってから、また押してください。',
    switched: '別のアカウントでログインしたため、この復習はここで止めました。',
    signedOut: 'ログインが切れたため、この復習はここで止めました。',
    doneTitle: '今日の復習は終わりです。おつかれさまでした。',
    carried: (k) => `残りの ${k} 枚は、明日からの復習に回します。`,
    // The date ends with 「（木）」: no space before です.
    next: (date) => `次の復習は ${date}です。`,
    noneToday: '今日の復習はありません。',
    emptyTitle: 'まだ復習カードはありません。',
    emptyBody: '復習カードのあるレッスンを終えると、そのカードが、忘れかけたころにここに並びます（早くて次の日です）。',
    noAccountTitle: '復習は、ログインすると使えます',
    noAccountBody: 'Rise Path のアカウントでログインすると、終えたレッスンの復習カードが、忘れかけたころに出てきます。レッスンの中の復習カードは、いつでも使えます。',
    unsupported: '復習は、いまは使えません。しばらくしてから、また開いてください。',
    loadFailed: 'いまは復習を読み込めません。',
    reload: '読み込み直す',
    offlineLoad: 'インターネットにつながると、今日の復習を読み込めます。',
    loading: '読み込んでいます…',
    toDashboard: 'ダッシュボードへ',
    card: {
      title: '今日の復習',
      dueTitle: (n, minutes) => `今日の復習 ${n} 枚（約 ${minutes} 分）`,
      dueBody: '忘れかけているカードから出します。',
      start: '復習する',
      doneTitle: '今日の復習は終わりました',
      noneTodayTitle: '今日の復習はありません',
      emptyTitle: 'まだ復習カードはありません',
      noAccountBody: 'Rise Path のアカウントでログインすると、終えたレッスンの復習カードが、忘れかけたころに出てきます。',
      loadingBody: '読み込んでいます…',
      unavailableBody: 'いまは復習を読み込めません。',
      unsupportedBody: '復習は、いまは使えません。',
    },
  } satisfies ReviewCopy,
};

/** Read with useLanguage().language: reviewCopy[language]. */
export const reviewCopy: { en: ReviewCopy; jp: ReviewCopy } = copy;
