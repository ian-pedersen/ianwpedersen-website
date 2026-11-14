// Browser storage for review progress and in-page edits. Everything lives under one
// localStorage key so a JSON export/import is a full backup.

const KEY = 'casePrep.v1';
const LOG_DAYS = 400;

export const blank = () => ({
  v: 1,
  srs: {}, // cardId -> scheduler state
  log: [], // [timestampMs, cardId, rating, wasNew(0/1), intervalBefore]
  days: {}, // 'YYYY-MM-DD' -> ratings that day (drives the streak)
  flags: {}, // cardId -> true
  local: { decks: {}, cards: {}, overrides: {}, deleted: {} },
  settings: { newPerDay: 20 },
});

export let data = blank();
export let storageOk = true;

function merge(base, incoming) {
  const out = { ...base, ...incoming };
  out.local = { ...base.local, ...(incoming.local || {}) };
  out.settings = { ...base.settings, ...(incoming.settings || {}) };
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    data = raw ? merge(blank(), JSON.parse(raw)) : blank();
  } catch (e) {
    storageOk = false;
    data = blank();
  }
  return data;
}

export function save() {
  try {
    const cutoff = Date.now() - LOG_DAYS * 864e5;
    if (data.log.length && data.log[0][0] < cutoff) data.log = data.log.filter((e) => e[0] >= cutoff);
    localStorage.setItem(KEY, JSON.stringify(data));
    storageOk = true;
  } catch (e) {
    storageOk = false;
  }
  return storageOk;
}

export function exportJSON() {
  return JSON.stringify({ app: 'case-prep', exportedAt: new Date().toISOString(), ...data }, null, 1);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.srs || !parsed.local) {
    throw new Error('This file is not a Case Prep backup.');
  }
  delete parsed.app;
  delete parsed.exportedAt;
  data = merge(blank(), parsed);
  save();
  return data;
}
