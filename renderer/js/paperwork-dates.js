// Paperwork Desk deadline extraction (v0.8 cycle 13).
//
// The 📄 card ends with a **Deadline** section; this turns whatever date
// the model wrote there into a concrete reminder time. Pure +
// dependency-free so scripts/test-modules.mjs exercises the exact code
// the renderer runs (same pattern as history-budget.js).
//
// Contract:
//   extractDeadlineDate(text) → { date: Date, iso: 'YYYY-MM-DD' } | null
//     - prefers a date found near the localized Deadline heading
//       (EN **Deadline** / ZH **截止日期** / AR **الموعد النهائي**),
//       falls back to the first date anywhere in the text
//     - understands ISO (2026-07-01), slashed D/M/Y vs M/D/Y (decided by
//       which slot exceeds 12), English month names both orders, and
//       Chinese 2026年7月1日
//   reminderDateFor(deadline, now) → Date
//     - 3 days before the deadline; clamped to tomorrow when that is
//       already past; tomorrow when there is no deadline at all

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits → ASCII, so
// dates written the way Arabic documents actually write them still parse.
export function normalizeDigits(text) {
  return String(text || '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
}

// Tabular Islamic-calendar → Gregorian conversion (±1 day of the official
// Umm al-Qura calendar — fine for a reminder set 3 days early). Standard
// Julian-day arithmetic.
export function hijriToGregorian(hy, hm, hd) {
  const jd = Math.floor((11 * hy + 3) / 30) + 354 * hy + 30 * hm - Math.floor((hm - 1) / 2) + hd + 1948440 - 385
  let l = jd + 68569
  const n = Math.floor((4 * l) / 146097)
  l = l - Math.floor((146097 * n + 3) / 4)
  const i = Math.floor((4000 * (l + 1)) / 1461001)
  l = l - Math.floor((1461 * i) / 4) + 31
  const j = Math.floor((80 * l) / 2447)
  const d = l - Math.floor((2447 * j) / 80)
  l = Math.floor(j / 11)
  const m = j + 2 - 12 * l
  const y = 100 * (n - 49) + i + l
  return clampDate(y, m, d)
}

function clampDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  // Reject rollovers like Feb 30 → Mar 2.
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt
}

function findDateIn(raw) {
  if (!raw) return null
  const text = normalizeDigits(raw)
  // Hijri, numeric forms. Years 1300-1499 are unambiguous (we only treat
  // 20xx as Gregorian), with or without the هـ/AH marker:
  //   15/12/1447 هـ  ·  ١٤٤٧/١٢/١٥  ·  1447-12-15
  let m = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](1[34]\d{2})\s*(?:هـ|ه\b|AH)?/)
  if (m) { const dt = hijriToGregorian(+m[3], +m[2], +m[1]); if (dt) return dt }
  m = text.match(/(1[34]\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:هـ|ه\b|AH)?/)
  if (m) { const dt = hijriToGregorian(+m[1], +m[2], +m[3]); if (dt) return dt }
  // ISO / dotted: 2026-07-01, 2026/7/1, 2026.07.01
  m = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) { const dt = clampDate(+m[1], +m[2], +m[3]); if (dt) return dt }
  // Chinese: 2026年7月1日
  m = text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/)
  if (m) { const dt = clampDate(+m[1], +m[2], +m[3]); if (dt) return dt }
  // English month name first: July 1, 2026 / Jul 1 2026
  m = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (mo) { const dt = clampDate(+m[3], mo, +m[2]); if (dt) return dt }
  }
  // Day first: 1 July 2026
  m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2})/)
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mo) { const dt = clampDate(+m[3], mo, +m[1]); if (dt) return dt }
  }
  // Slashed with trailing year: 15/7/2026 (D/M/Y) or 7/15/2026 (M/D/Y).
  // Whichever slot exceeds 12 is the day; ties default to D/M/Y (most of
  // the world, and this app's audience).
  m = text.match(/(\d{1,2})[/.](\d{1,2})[/.](20\d{2})/)
  if (m) {
    let a = +m[1], b = +m[2]
    const [day, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]
    const dt = clampDate(+m[3], mo, day)
    if (dt) return dt
  }
  return null
}

export function extractDeadlineDate(text) {
  if (!text || typeof text !== 'string') return null
  // Scope to the Deadline section first: from a localized heading to the
  // next bold heading (or 200 chars, whichever comes first).
  const head = text.match(/\*\*\s*(Deadline|截止日期|الموعد النهائي)\s*\*\*/i)
  let date = null
  if (head) {
    const after = text.slice(head.index, head.index + 240)
    date = findDateIn(after)
  }
  if (!date) date = findDateIn(text)
  if (!date) return null
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return { date, iso }
}

export function reminderDateFor(deadline, now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)
  if (!deadline) return tomorrow
  const remind = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate() - 3, 9, 0, 0)
  return remind > now ? remind : tomorrow
}
