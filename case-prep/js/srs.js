// Spaced-repetition scheduler (SM-2 variant, day-granular, Anki-style learning).
//
// New / learning cards:
//   Again -> back in this session after a few cards
//   Hard  -> back at the end of this session
//   Good  -> 1 day
//   Easy  -> 4 days
// Review cards (interval I days, ease E):
//   Again -> lapse: ease -0.20, back to learning, back in this session
//   Hard  -> max(I+1, I*1.2), ease -0.15
//   Good  -> max(I+2, I*E)
//   Easy  -> max(I+3, I*E*1.3), ease +0.15
// Ease never drops below 1.3. Intervals cap at 365 days.

export const MATURE_DAYS = 21;
export const MIN_EASE = 1.3;
export const MAX_IVL = 365;

export function dayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayStr(new Date(y, m - 1, d + n));
}

export const newState = () => ({ s: 'new', ivl: 0, ease: 2.5, reps: 0, lapses: 0, due: null });

// Returns { state, requeue } where requeue is 'soon', 'end' or null.
export function schedule(prev, rating, today) {
  const st = { ...newState(), ...(prev || {}) };
  const E = st.ease;
  const I = st.ivl;
  st.reps += 1;

  if (rating === 1) {
    if (st.s === 'review') {
      st.lapses += 1;
      st.ease = Math.max(MIN_EASE, E - 0.2);
    }
    st.s = 'learn';
    st.ivl = 0;
    st.due = today;
    return { state: st, requeue: 'soon' };
  }

  let ivl;
  if (st.s !== 'review') {
    if (rating === 2) {
      st.s = 'learn';
      st.due = today;
      return { state: st, requeue: 'end' };
    }
    ivl = rating === 3 ? 1 : 4;
    if (rating === 4) st.ease = E + 0.15;
  } else if (rating === 2) {
    ivl = Math.max(I + 1, Math.round(I * 1.2));
    st.ease = Math.max(MIN_EASE, E - 0.15);
  } else if (rating === 3) {
    ivl = Math.max(I + 2, Math.round(I * E));
  } else {
    ivl = Math.max(I + 3, Math.round(I * E * 1.3));
    st.ease = E + 0.15;
  }
  st.ivl = Math.min(ivl, MAX_IVL);
  st.s = 'review';
  st.due = addDays(today, st.ivl);
  return { state: st, requeue: null };
}

// Short labels for the rating buttons, e.g. "now", "later", "3d", "2mo".
export function previewLabel(prev, rating, today) {
  const { state, requeue } = schedule(prev, rating, today);
  if (requeue === 'soon') return 'now';
  if (requeue === 'end') return 'later';
  const d = state.ivl;
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

export function stage(st) {
  if (!st || st.s === 'new') return 'new';
  return st.ivl >= MATURE_DAYS ? 'mature' : 'learning';
}

export const isDue = (st, today) => !!st && st.s !== 'new' && !!st.due && st.due <= today;
