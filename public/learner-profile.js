export const AGE_LABELS = { '6-8': '6–8 岁', '9-12': '9–12 岁', '13-17': '13–17 岁', adult: '成人' };
export const LEVEL_LABELS = { starter: '刚开始学', beginner: '会走棋，练战术', improving: '能算几步，想提高' };
export const GOAL_LABELS = { safety: '先保护好帅将', tactics: '看懂棋子配合', explain: '能说出走棋理由' };
export const PACE_LABELS = { gentle: '慢一点，一次想一点', standard: '讲清原因，再看变化', challenge: '多比较，自己推演' };
export const DEFAULT_PROFILE = Object.freeze({ ageBand: '9-12', level: 'starter', goal: 'tactics', pace: 'gentle' });
export const PROFILE_KEY = 'qili-learner-profile-v1';

export function sanitizeLearnerProfile(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(Object.entries({ ageBand: AGE_LABELS, level: LEVEL_LABELS, goal: GOAL_LABELS, pace: PACE_LABELS }).map(([key, choices]) => [key, typeof value[key] === 'string' && Object.hasOwn(choices, value[key]) ? value[key] : DEFAULT_PROFILE[key]]));
}

export function loadLearnerProfile(storage) {
  try { return sanitizeLearnerProfile(JSON.parse((storage || globalThis.localStorage).getItem(PROFILE_KEY))); }
  catch { return { ...DEFAULT_PROFILE }; }
}

export function saveLearnerProfile(storage, raw) {
  const profile = sanitizeLearnerProfile(raw);
  try { (storage || globalThis.localStorage).setItem(PROFILE_KEY, JSON.stringify(profile)); return true; }
  catch { return false; }
}
