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

function clampDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  // Reject rollovers like Feb 30 → Mar 2.
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt
}

function findDateIn(text) {
  if (!text) return null
  // ISO / dotted: 2026-07-01, 2026/7/1, 2026.07.01
  let m = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/)
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
