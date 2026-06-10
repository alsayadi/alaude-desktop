// Natural-language reminder parsing (v0.8 cycle 20).
//
// "remind me every friday at 5pm to pay the bills" → a pre-filled
// routine. Nobody invents automations from a blank cron box (ChatGPT
// Tasks proved chat-based creation; Google proved templates) — so the
// composer itself understands reminder phrasing in EN / 中文 / العربية.
//
// Pure + dependency-free so scripts/test-modules.mjs exercises the
// exact code the renderer runs.
//
// Contract:
//   parseReminder(text) → { cron, task, label } | null
//     - null when the text is not a confident reminder request
//       (no trigger word, or no parsable schedule) — the message then
//       goes to the model like any other.
//     - task: the text minus trigger/schedule phrases (best effort,
//       falls back to the full text)
//     - label: human-readable schedule ('every Friday 17:00') for toasts

const WEEKDAYS_EN = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 }
const WEEKDAYS_ZH = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }
const WEEKDAYS_AR = { 'الأحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'اثنين': 1, 'الثلاثاء': 2, 'ثلاثاء': 2,
  'الأربعاء': 3, 'أربعاء': 3, 'الخميس': 4, 'خميس': 4, 'الجمعة': 5, 'جمعة': 5, 'السبت': 6, 'سبت': 6 }

function normDigits(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
}

// → { h, m, src } | null. Understands "at 5pm", "17:30", "5:30 pm",
// 下午5点 / 早上9点半 / 晚上8点, الساعة 5 مساءً.
function findTime(text) {
  let m = text.match(/(上午|早上|中午|下午|晚上)\s*(\d{1,2})[点點时時:：]((\d{1,2})分?|半)?/)
  if (m) {
    let h = parseInt(m[2], 10)
    const min = m[3] === '半' ? 30 : (m[4] ? parseInt(m[4], 10) : 0)
    if (/下午|晚上/.test(m[1]) && h < 12) h += 12
    if (m[1] === '中午' && h !== 12) h = 12
    return { h, m: min, src: m[0] }
  }
  m = text.match(/الساعة\s+(\d{1,2})(?::(\d{2}))?\s*(صباح|مساء|ظهر|عصر|ليل)?[اًء]?/)
  if (m) {
    let h = parseInt(m[1], 10)
    if (/مساء|عصر|ليل/.test(m[3] || '') && h < 12) h += 12
    return { h, m: m[2] ? parseInt(m[2], 10) : 0, src: m[0] }
  }
  m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i) || text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
  if (m) {
    let h = parseInt(m[1], 10)
    const min = m[2] ? parseInt(m[2], 10) : 0
    const ap = (m[3] || '').toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h > 23 || min > 59) return null
    return { h, m: min, src: m[0] }
  }
  m = text.match(/\b(\d{1,2})\s*(am|pm)\b/i)
  if (m) {
    let h = parseInt(m[1], 10)
    if (m[2].toLowerCase() === 'pm' && h < 12) h += 12
    if (m[2].toLowerCase() === 'am' && h === 12) h = 0
    return { h, m: 0, src: m[0] }
  }
  return null
}

// → { kind, dow?, dom?, src } | null
function findRecurrence(text) {
  const low = text.toLowerCase()
  let m
  // English weekdays: "every friday", "on fridays"
  m = low.match(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)s?\b/)
  if (m) return { kind: 'weekly', dow: WEEKDAYS_EN[m[1]], src: m[0] }
  if (/\bevery (day|night|morning|evening|afternoon)\b|\bdaily\b/.test(low)) {
    const part = (low.match(/\bevery (morning|evening|afternoon|night)\b/) || [])[1]
    return { kind: 'daily', defH: part === 'evening' || part === 'night' ? 19 : part === 'afternoon' ? 15 : 9, src: (low.match(/\bevery (day|night|morning|evening|afternoon)\b|\bdaily\b/) || [''])[0] }
  }
  m = low.match(/\bevery month(?:\s+on)?(?:\s+the)?\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (m) return { kind: 'monthly', dom: parseInt(m[1], 10), src: m[0] }
  // Chinese
  m = text.match(/每(?:个)?(?:星期|周|週)([一二三四五六日天])/)
  if (m) return { kind: 'weekly', dow: WEEKDAYS_ZH[m[1]], src: m[0] }
  if (/每天|每日|每(?:个)?早上|每晚/.test(text)) {
    return { kind: 'daily', defH: /每晚/.test(text) ? 19 : 9, src: (text.match(/每天|每日|每(?:个)?早上|每晚/) || [''])[0] }
  }
  m = text.match(/每(?:个)?月(\d{1,2})[号號日]/)
  if (m) return { kind: 'monthly', dom: parseInt(m[1], 10), src: m[0] }
  // Arabic
  for (const [name, dow] of Object.entries(WEEKDAYS_AR)) {
    if (text.includes('كل ' + name) || text.includes('كل يوم ' + name)) {
      return { kind: 'weekly', dow, src: 'كل ' + name }
    }
  }
  if (/كل يوم|يومي[اً]|يوميًّا|كل صباح|كل مساء/.test(text)) {
    return { kind: 'daily', defH: /مساء/.test(text) ? 19 : 9, src: (text.match(/كل يوم|يومي[اً]|يوميًّا|كل صباح|كل مساء/) || [''])[0] }
  }
  m = text.match(/كل شهر(?:\s+يوم)?\s+(\d{1,2})/)
  if (m) return { kind: 'monthly', dom: parseInt(m[1], 10), src: m[0] }
  return null
}

const TRIGGER = /^(?:please\s+)?(?:remind me|提醒我|ذكّرني|ذكرني|ذكريني|ذكّريني)/i

export function parseReminder(rawText) {
  const text = normDigits(String(rawText || '').trim())
  if (!text || text.length > 400) return null
  const trig = text.match(TRIGGER)
  if (!trig) return null
  const rec = findRecurrence(text)
  if (!rec) return null // "remind me to call mom" with no schedule → let the model handle it
  if (rec.kind === 'weekly' && (rec.dow == null || rec.dow < 0 || rec.dow > 6)) return null
  if (rec.kind === 'monthly' && (!rec.dom || rec.dom < 1 || rec.dom > 31)) return null
  const time = findTime(text)
  const h = time ? time.h : (rec.defH || 9)
  const min = time ? time.m : 0
  let cron, label
  if (rec.kind === 'daily') { cron = `${min} ${h} * * *`; label = `daily ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
  else if (rec.kind === 'weekly') { cron = `${min} ${h} * * ${rec.dow}`; label = `weekly(${rec.dow}) ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
  else { cron = `${min} ${h} ${rec.dom} * *`; label = `monthly(${rec.dom}) ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
  // Task = text minus trigger + schedule phrases; tidy leading joiners.
  let task = text.replace(trig[0], '').replace(rec.src, '')
  if (time) task = task.replace(time.src, '')
  task = task.replace(/^\s*(to|that|عن|أن|بأن|去|要)\s+/i, '').replace(/\s{2,}/g, ' ').trim()
  if (!task) task = text
  return { cron, task, label }
}
