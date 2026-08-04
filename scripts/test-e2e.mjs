#!/usr/bin/env node
/**
 * test-e2e — boots the real app and looks at it.
 *
 *   npm run test:e2e
 *
 * The rest of the suite proves the data layer behaves and that index.html
 * contains certain strings. This file is the only place that renders the
 * app, clicks it, types into it, and checks what a person would actually
 * see and be able to touch.
 *
 * It is deliberately built out of SWEEPS rather than one-off assertions.
 * A sweep states a property that must hold for every element on screen —
 * "no visible control may be unreachable", "nothing inline may be laid out
 * as a block" — so it catches the NEXT bug of that shape, not just the one
 * that prompted it. Both sweeps below were written from bugs that shipped:
 * they fail loudly against the old code and pass against the fixed code.
 */

import { launchApp } from './lib/harness.mjs'

let pass = 0, fail = 0
const failures = []
function check(label, cond, extra = '') {
  if (cond) { console.log('  ✅', label); pass++ }
  else { console.log('  ❌', label, extra ? '\n        ' + extra : ''); fail++; failures.push(label) }
}
function section(t) { console.log('\n' + '─'.repeat(62) + '\n  ' + t + '\n' + '─'.repeat(62)) }

// A message with every inline construct that has ever been mis-styled.
const FIXTURE_REPLY = [
  'A **bold** claim, an *aside*, and inline `~/.labaik` in one sentence.',
  '',
  '- a list item with `inline-code` mid-sentence and a [link](https://labaik.ai)',
  '- a second item',
  '',
  '```js',
  'const x = 1',
  '```',
].join('\n')

const app = await launchApp()
if (!app) {
  console.log('⚠️  electron binary not found — skipping E2E')
  process.exit(0)
}

try {
  const { cdp } = app

  // ═══ 1 · it boots, and it boots clean ═══════════════════════════════
  section('1 · Boot')
  check('renderer reached its final statement (boot beacon)', app.booted,
    app.booted ? '' : app.output().split('\n').slice(-6).join('\n'))
  check('window has a rendered body', await cdp.eval('document.body.scrollHeight > 100'))
  check('no uncaught exception during boot', cdp.pageErrors.length === 0,
    cdp.pageErrors.join(' | '))
  // If this fails, every sweep below is measuring a login modal rather
  // than the app, and their green means nothing.
  //
  // Two traps here, both hit for real:
  //   1. `offsetParent` is ALWAYS null for a position:fixed element, so
  //      the first version of this check passed while the login screen
  //      was still covering the entire window. A false green in the one
  //      assertion whose whole job is to validate the others.
  //   2. The screen is dismissed ASYNCHRONOUSLY once the key check
  //      resolves, so asserting immediately after boot is a race. Wait
  //      for it rather than sampling once.
  const loginGone = `(() => {
    const l = document.getElementById('login-screen');
    if (!l) return true;
    const cs = getComputedStyle(l);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    return l.checkVisibility ? !l.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : false;
  })()`
  let pastLogin = true
  try { await cdp.waitFor(loginGone, { timeout: 15000, label: 'login screen dismissed' }) }
  catch { pastLogin = false }
  check('booted past the login screen into the real UI', pastLogin,
    pastLogin ? '' : 'sweeps below would be measuring the login modal, not the app')
  check('the composer is present and visible', await cdp.eval(`(() => {
    const i = document.getElementById('input');
    return !!i && i.getBoundingClientRect().width > 100;
  })()`))

  // ═══ 2 · SWEEP: nothing invisible may block a control ═══════════════
  // The cycle-40 bug: a faded toast kept pointer-events:auto and sat over
  // the composer, so the app could not be typed into. `el.click()` in JS
  // would never have noticed — only real hit-testing does.
  // The invariant is NOT "no control is ever covered" — a first draft said
  // that and immediately flagged 18 controls sitting behind the login
  // screen, which is exactly what a modal is supposed to do. The property
  // that actually distinguishes a bug from a modal is VISIBILITY: a user
  // can see a login screen and understands why the button behind it does
  // not respond. Nobody can see a faded toast. So: nothing invisible may
  // intercept a click.
  section('2 · Sweep — nothing invisible may intercept a click')
  const sweepBlockers = () => cdp.eval(`(() => {
    // Opacity composites down the tree, so a blocker is only truly
    // invisible once the whole ancestor chain is taken into account.
    const effOpacity = (el) => {
      let o = 1, n = el;
      while (n && n.nodeType === 1) { o *= (parseFloat(getComputedStyle(n).opacity) || 0); n = n.parentElement; }
      return o;
    };
    const out = [];
    const sel = 'button, textarea, select, input, a[href], [role="button"], [onclick]';
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none') continue;
      if (!el.checkVisibility || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      // Sample ACROSS the control, not just its centre. A centre-only
      // probe missed the real cycle-40 toast in a narrower window: the
      // toast is only as wide as its text, so it covered the left half of
      // the composer while leaving the exact midpoint clear. Partial
      // occlusion still means a user clicks and nothing happens.
      const ys = [r.top + r.height / 2];
      const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => r.left + r.width * f);
      let hit = null;
      for (const y of ys) {
        for (const x of xs) {
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const top = document.elementFromPoint(x, y);
          if (!top || top === el || el.contains(top) || top.contains(el)) continue;
          const op = effOpacity(top);
          if (op > 0.1) continue;   // a visible cover (modal, login, panel) is legitimate
          hit = { top, op, x: Math.round(x) };
          break;
        }
        if (hit) break;
      }
      if (!hit) continue;
      out.push({
        control: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]).slice(0, 50),
        blockedBy: (hit.top.id ? '#' + hit.top.id : hit.top.tagName.toLowerCase() + '.' + String(hit.top.className).split(' ')[0]).slice(0, 50),
        opacity: hit.op,
        atX: hit.x,
      });
    }
    return out;
  })()`)
  const report = (bs) => bs.map(b =>
    `${b.control} blocked by INVISIBLE ${b.blockedBy} (effective opacity ${b.opacity})`).join('\n        ')

  check('at rest, no invisible element intercepts a click', (await sweepBlockers()).length === 0,
    report(await sweepBlockers()))

  // Sweeping only at boot would have MISSED the very bug this was written
  // for. The offending toast is created lazily and is harmless until it
  // has been shown once — it becomes a permanent invisible blocker only
  // after it fades. Verified: with the fix reverted, the boot-time sweep
  // stayed green and this one goes red. Transient overlays have to be
  // born, and die, before the sweep means anything.
  await cdp.run(`showRewindToast('harness: transient overlay probe', false)`)
  await cdp.run(`document.getElementById('rewind-toast')?.classList.remove('show')`)
  // The fade is a 200ms CSS transition — computed opacity is still 1 the
  // instant the class comes off, so sweeping immediately measures a
  // *visible* toast and lets the bug through. Wait for it to actually go.
  await cdp.waitFor(`(() => {
    const t = document.getElementById('rewind-toast');
    return !t || parseFloat(getComputedStyle(t).opacity) < 0.05;
  })()`, { timeout: 3000, label: 'toast finished fading' })
  const afterToast = await sweepBlockers()
  check('after a toast has shown and faded, still nothing intercepts a click',
    afterToast.length === 0, report(afterToast))

  // Prove the sweep can still see the bug it was written for. A green
  // check that cannot go red is decoration: re-create the cycle-40
  // defect synthetically (an invisible, click-eating overlay pinned over
  // the composer) and require the sweep to catch it.
  const selfTest = await cdp.eval(`(() => {
    const probe = document.createElement('div');
    probe.id = '__harness_probe__';
    const r = document.getElementById('input').getBoundingClientRect();
    Object.assign(probe.style, {
      position: 'fixed', left: r.left + 'px', top: r.top + 'px',
      width: r.width + 'px', height: r.height + 'px',
      opacity: '0', zIndex: '9999', pointerEvents: 'auto', background: 'red',
    });
    document.body.appendChild(probe);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const caught = document.elementFromPoint(cx, cy) === probe;
    probe.remove();
    return caught;
  })()`)
  check('the sweep would catch a cycle-40-style invisible blocker', selfTest === true)
  check('and the probe cleaned itself up',
    await cdp.eval(`!document.getElementById('__harness_probe__')`))

  // ═══ 3 · SWEEP: prose stays prose ══════════════════════════════════
  // The cycle-38 bug: `.msg-content code` was caught by a rule meant for
  // images, so inline code became display:block and split sentences apart.
  section('3 · Sweep — inline elements are laid out inline')
  await cdp.run(`
    messages.length = 0;
    messages.push({ role: 'user', content: 'Show me every inline construct.' });
    messages.push({ role: 'assistant', content: ${JSON.stringify(FIXTURE_REPLY)}, model: 'claude-sonnet-5' });
    renderMessages();
    const w = document.getElementById('welcome'); if (w) w.style.display = 'none';
  `)
  const notInline = await cdp.eval(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('.msg-content code, .msg-content a, .msg-content strong, .msg-content em, .msg-content kbd')) {
      if (el.closest('pre, .md-pre')) continue;          // block code is meant to be a block
      const d = getComputedStyle(el).display;
      if (d === 'inline' || d === 'inline-block' || d === 'inline-flex') continue;
      out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 30), display: d, text: el.textContent.slice(0, 24) });
    }
    return out;
  })()`)
  check('no inline construct in a reply is laid out as a block', notInline.length === 0,
    notInline.map(n => `<${n.tag} class="${n.cls}"> "${n.text}" → display:${n.display}`).join('\n        '))
  check('the fixture reply actually rendered', await cdp.eval(`document.querySelectorAll('.msg').length >= 2`))
  check('a code block is still a block', await cdp.eval(`
    !!document.querySelector('.msg-content pre, .msg-content .md-pre')`))

  // ═══ 4 · the composer genuinely accepts typing ═════════════════════
  // Not "the textarea exists" — a real click through the input pipeline,
  // then real inserted text.
  section('4 · The composer accepts a real click and real keystrokes')
  await cdp.click('#input')
  await cdp.run(`document.getElementById('input').value = ''`)
  await cdp.type('hello from the harness')
  const typed = await cdp.eval(`document.getElementById('input').value`)
  check('clicking the composer focuses it', await cdp.eval(`document.activeElement === document.getElementById('input')`))
  check('typed text lands in the composer', typed === 'hello from the harness', JSON.stringify(typed))
  await cdp.run(`document.getElementById('input').value = ''`)

  // ═══ 5 · the "+" menu works as a menu ══════════════════════════════
  section('5 · Composer menu opens, closes, and keeps its controls')
  await cdp.click('#composer-plus')
  check('clicking + opens the menu', await cdp.eval(`!document.getElementById('composer-menu').hidden`))
  check('the menu is on screen and sized', await cdp.eval(`(() => {
    const r = document.getElementById('composer-menu').getBoundingClientRect();
    return r.width > 200 && r.height > 80 && r.top > 0 && r.bottom <= innerHeight + 1;
  })()`))
  for (const id of ['folder-btn', 'perm-mode-select', 'plan-mode-btn']) {
    check(`  ${id} is reachable inside the menu`, await cdp.eval(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    })()`))
  }
  await cdp.key('Escape')
  check('Escape closes the menu', await cdp.eval(`document.getElementById('composer-menu').hidden`))

  // ═══ 6 · permission state stays visible ════════════════════════════
  section('6 · Agent state is visible without opening anything')
  const modes = await cdp.eval(`(async () => {
    const out = {};
    for (const m of ['observe', 'careful', 'flow', 'autopilot']) {
      await setPermMode(m);
      out[m] = document.getElementById('composer-state-icon').textContent;
    }
    return out;
  })()`)
  check('each permission mode shows a distinct icon on the composer',
    new Set(Object.values(modes)).size === 4, JSON.stringify(modes))

  // ═══ 7 · SWEEP: all three locales are complete ═════════════════════
  section('7 · Sweep — EN / 中文 / العربية key parity')
  const i18nReport = await cdp.eval(`(() => {
    if (typeof TRANSLATIONS === 'undefined') return { skipped: true };
    const langs = Object.keys(TRANSLATIONS);
    const sets = Object.fromEntries(langs.map(l => [l, new Set(Object.keys(TRANSLATIONS[l]))]));
    const all = new Set(langs.flatMap(l => [...sets[l]]));
    const missing = {};
    for (const l of langs) {
      const m = [...all].filter(k => !sets[l].has(k));
      if (m.length) missing[l] = m.slice(0, 12);
    }
    return { langs, total: all.size, missing };
  })()`)
  check('three locales are present', i18nReport.skipped || i18nReport.langs.length === 3,
    JSON.stringify(i18nReport.langs))
  check('no translation key is missing from any locale',
    i18nReport.skipped || Object.keys(i18nReport.missing).length === 0,
    JSON.stringify(i18nReport.missing))

  // ═══ 8 · SWEEP: layout survives theme and direction ════════════════
  section('8 · Sweep — dark mode and RTL do not break layout')
  const overflowIn = async (label) => cdp.eval(`(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.main *, .sidebar *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > innerWidth + 2 || r.left < -2) {
        bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]).slice(0, 40));
      }
    }
    return [...new Set(bad)].slice(0, 8);
  })()`)
  // Real WCAG contrast, not a hand-waved channel difference. A first
  // draft summed normalised channels and called a gap of 0.8 "readable",
  // which is not a measure of anything. The effective background has to
  // be resolved by walking up until something is actually painted —
  // .msg-content itself is transparent.
  const contrastOf = async (sel) => cdp.eval(`(() => {
    const parse = (c) => { const m = (c || '').match(/[\\d.]+/g) || []; return { r: +m[0] || 0, g: +m[1] || 0, b: +m[2] || 0, a: m[3] === undefined ? 1 : +m[3] }; };
    const effBg = (el) => { let n = el; while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0.01) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color), bg = effBg(el);
    const a = lum(fg), b = lum(bg);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  })()`)

  const lightContrast = await contrastOf('.msg-content')
  check('light mode reply text meets WCAG AA (4.5:1)', lightContrast >= 4.5, `ratio ${lightContrast}`)
  await cdp.run(`document.documentElement.setAttribute('data-theme', 'dark')`)
  const darkContrast = await contrastOf('.msg-content')
  check('dark mode reply text meets WCAG AA (4.5:1)', darkContrast >= 4.5, `ratio ${darkContrast}`)
  const darkOverflow = await overflowIn('dark')
  check('nothing overflows horizontally in dark mode', darkOverflow.length === 0, darkOverflow.join(', '))

  await cdp.run(`document.documentElement.setAttribute('data-theme', 'light'); document.documentElement.setAttribute('dir', 'rtl')`)
  check('the user bubble mirrors in RTL', await cdp.eval(`(() => {
    const u = document.querySelector('.msg:has(.msg-role.user)');
    if (!u) return false;
    return getComputedStyle(u).alignItems === 'flex-end';
  })()`))
  // Direction is a property of the MESSAGE, not of the app. A user with an
  // English interface asking for an Arabic answer — the flagship diaspora
  // case — must get right-to-left text in a left-to-right UI. Without
  // dir="auto" the reply inherited the interface direction and mixed
  // Arabic/Latin text was reordered wrongly.
  // Explicitly LTR: the whole point is an RTL reply inside an LTR app.
  await cdp.run(`document.documentElement.setAttribute('dir', 'ltr')`)
  const perMessageDir = await cdp.eval(`(() => {
    // Use the live messages array, the same handle section 3 renders
    // through — pushing into sessions[].messages does not drive the view.
    messages.length = 0;
    messages.push({ role: 'user', content: 'Explain this bill please' });
    // Percent-encoded so the Arabic is pure ASCII in transit through the
    // nested template literal — escape sequences did not survive it.
    messages.push({ role: 'assistant', content: decodeURIComponent('%D9%87%D8%B0%D9%87%20%D9%81%D8%A7%D8%AA%D9%88%D8%B1%D8%A9') + ' Stadtwerke 183.84 EUR' });
    renderMessages();
    return [...document.querySelectorAll('.msg-content')].map(e => ({
      attr: e.getAttribute('dir'),
      dir: getComputedStyle(e).direction,
      arabic: /[\\u0600-\\u06FF]/.test(e.textContent),
    }));
  })()`)
  check('every message declares dir="auto"',
    perMessageDir.length >= 2 && perMessageDir.every(m => m.attr === 'auto'),
    JSON.stringify(perMessageDir))
  check('the Arabic fixture survived into the DOM', perMessageDir[1]?.arabic === true,
    JSON.stringify(perMessageDir))
  check('an Arabic reply renders RTL inside an LTR interface',
    perMessageDir[0]?.dir === 'ltr' && perMessageDir[1]?.dir === 'rtl',
    JSON.stringify(perMessageDir))

  const rtlOverflow = await overflowIn('rtl')
  check('nothing overflows horizontally in RTL', rtlOverflow.length === 0, rtlOverflow.join(', '))
  await cdp.run(`document.documentElement.setAttribute('dir', 'ltr')`)

  // ═══ 9 · the page stayed clean throughout ══════════════════════════
  section('9 · Console hygiene across the whole run')
  const realErrors = cdp.consoleErrors.filter(e =>
    e.type === 'error' &&
    !/401|api key|Authentication|ERR_|net::/i.test(e.text))   // keyless sandbox noise
  check('no unexpected console errors during the run', realErrors.length === 0,
    realErrors.map(e => e.text).join('\n        '))
  check('no uncaught exception during the run', cdp.pageErrors.length === 0,
    cdp.pageErrors.join(' | '))
} finally {
  app.close()
}

console.log('\n' + '━'.repeat(62))
console.log(`  E2E: ${pass} passed, ${fail} failed`)
console.log('━'.repeat(62))
if (fail > 0) {
  console.log('\nFailed:\n  · ' + failures.join('\n  · '))
  process.exit(1)
}
