/**
 * The study time pages' words (en, jp) and number formats: the cohort's page, the unit's page and
 * StudyTimeStatus. The reasons follow D13 (doc/brushup-2026/training-plan.ja.md): each reason the
 * server gives is shown to the learner. No rule value appears here (the server keeps them).
 */
import type { StudyReason } from '../../../services/trainingApi';
import type { RecordingView, RetryCause, StopCause } from './studyTimeCore';

/** The recording views shown by their kind alone (the others by their reason or cause). */
type PlainView = Exclude<RecordingView['kind'], 'not_counting' | 'retrying' | 'stopped'>;

export const studyCopy = {
  en: {
    studyTime: 'Study time',
    loading: 'Loading…',
    toClasses: 'All training classes',
    toUnits: 'All units',
    retry: 'Try again',
    signInAgain: 'Sign in again',
    recordHere: 'Record on this screen',
    failed: 'Your study time could not be loaded.',
    account: 'Sign in with a Rise Path account to see your study time.',
    signIn: 'Your sign-in could not be confirmed. Sign in again to see your study time.',
    deleted: 'This Rise Path account was deleted.',
    off: 'Job training is not offered here.',
    notFound: 'This class was not found.',
    notLearner: 'Only trainees have study time in a class.',
    notConfigured: 'Study time is not set up for this class yet.',
    notInSession: 'The class is not in session today. Study time is recorded only between its first and last day.',
    notListed: 'This unit is not on today\'s unit list.',
    today: 'Today',
    thisUnit: 'This unit',
    total: 'Total in this class',
    units: 'Units',
    study: 'Study',
    recent: 'Recent days',
    final: 'Final',
    notFinal: 'Not final yet',
    capReached: 'Set time reached',
    noDays: 'No study time yet.',
    hours: 'h',
    minutes: 'min',
    recording: {
      idle: 'Getting ready to record.',
      starting: 'Starting to record…',
      counting: 'Recording your study time.',
      paused: 'Not recording while this screen is hidden.',
      other_place: 'Another screen is recording your study time.',
    } satisfies Record<PlainView, string>,
    reasons: {
      starting: 'Recording has started.',
      gap: 'The connection was cut: that time is not counted.',
      idle: 'No activity for a while, so this time is not counted. Use the screen to continue.',
      focus: 'This screen is not selected, so this time is not counted.',
      other_tab: 'Another unit\'s screen is open at the same time, so this time is not counted here. Close or hide that screen to count it again.',
      cap_reached: 'This unit reached its set time. No more time counts for it.',
      not_in_session: 'The class is not in session, so this time is not counted.',
      unknown: 'This time is not counted right now.',
    } satisfies Record<StudyReason, string>,
    retrying: {
      network: 'No connection. Recording goes on once it is back.',
      unavailable: 'Recording is not available right now. It goes on in a moment.',
      rate_limited: 'Too many requests. Recording goes on in a moment.',
      failed: 'Recording failed. It is tried again.',
    } satisfies Record<RetryCause, string>,
    stopped: {
      time_not_configured: 'Study time is not set up for this class yet, so nothing is recorded.',
      not_in_session: 'The class is not in session, so nothing is recorded.',
      unit_unknown: 'This unit is not on today\'s unit list, so nothing is recorded.',
      not_a_learner: 'Only trainees have study time recorded.',
      not_found: 'This class was not found.',
      off: 'Job training is not offered here.',
      signin: 'Your sign-in could not be confirmed. Sign in again to go on recording.',
      deleted: 'This Rise Path account was deleted.',
      invalid: 'Recording stopped. Reload the page to go on.',
    } satisfies Record<StopCause, string>,
  },
  jp: {
    studyTime: '受講時間',
    loading: '読み込んでいます…',
    toClasses: '職業訓練の一覧へ',
    toUnits: '単元の一覧へ',
    retry: 'もう一度読み込む',
    signInAgain: 'ログインし直す',
    recordHere: 'この画面で記録する',
    failed: '受講時間を読み込めませんでした。',
    account: 'Rise Path のアカウントでログインすると、受講時間が表示されます。',
    signIn: 'ログインを確認できませんでした。ログインし直すと、受講時間が表示されます。',
    deleted: 'この Rise Path のアカウントは削除されています。',
    off: 'ここでは、職業訓練を提供していません。',
    notFound: 'この期が見つかりません。',
    notLearner: '受講時間があるのは、受講者だけです。',
    notConfigured: 'この期の受講時間は、まだ設定されていません。',
    notInSession: '今日は期間の外です。受講時間は、期の最初の日から最後の日まで記録します。',
    notListed: 'この単元は、今日の単元表にありません。',
    today: '今日',
    thisUnit: 'この単元',
    total: 'この期の合計',
    units: '単元',
    study: '学習する',
    recent: '最近の受講時間',
    final: '確定',
    notFinal: 'まだ確定していません',
    capReached: '設定時間に達しました',
    noDays: 'まだ受講時間はありません。',
    hours: '時間',
    minutes: '分',
    recording: {
      idle: '記録の準備をしています。',
      starting: '記録を始めています…',
      counting: '受講時間を記録しています。',
      paused: '画面が隠れているあいだは、記録しません。',
      other_place: '別の画面で受講時間を記録しています。',
    } satisfies Record<PlainView, string>,
    reasons: {
      starting: '記録を始めました。',
      gap: '通信が途切れたため、そのあいだは数えていません。',
      idle: 'しばらく操作がないため、数えていません。画面を操作すると、また数えます。',
      focus: 'この画面が選ばれていないため、数えていません。',
      other_tab: '別の単元の画面と時間が重なっているため、この画面の時間は数えていません。別の単元の画面を閉じるか隠すと、また数えます。',
      cap_reached: 'この単元は設定時間に達しました。これより先は数えません。',
      not_in_session: '期間の外なので、数えていません。',
      unknown: 'いまは数えていません。',
    } satisfies Record<StudyReason, string>,
    retrying: {
      network: '接続できません。つながったら、記録を続けます。',
      unavailable: 'いまは記録できません。少しあとで続けます。',
      rate_limited: '送る回数が多すぎました。少しあとで続けます。',
      failed: '記録できませんでした。続けて試します。',
    } satisfies Record<RetryCause, string>,
    stopped: {
      time_not_configured: 'この期の受講時間は、まだ設定されていないため、記録していません。',
      not_in_session: '期間の外なので、記録していません。',
      unit_unknown: 'この単元は今日の単元表にないため、記録していません。',
      not_a_learner: '受講時間を記録するのは、受講者だけです。',
      not_found: 'この期が見つかりません。',
      off: 'ここでは、職業訓練を提供していません。',
      signin: 'ログインを確認できませんでした。ログインし直すと、記録を続けます。',
      deleted: 'この Rise Path のアカウントは削除されています。',
      invalid: '記録を止めました。ページを読み込み直すと、続けます。',
    } satisfies Record<StopCause, string>,
  },
} as const;

export type StudyCopy = (typeof studyCopy)['jp'];

/** A duration as whole hours and minutes (seconds dropped): "1 時間 5 分", "1 h 5 min", "0 分". */
export function formatDuration(ms: number, language: 'en' | 'jp'): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const t = studyCopy[language];
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${t.minutes}`;
  return rest === 0 ? `${hours} ${t.hours}` : `${hours} ${t.hours} ${rest} ${t.minutes}`;
}

/** A Japan-time day (YYYY-MM-DD) as "11月2日" or "Nov 2". */
export function formatDay(day: string, language: 'en' | 'jp'): string {
  const [y, m, d] = day.split('-').map(Number);
  if (language === 'jp') return `${m}月${d}日`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
