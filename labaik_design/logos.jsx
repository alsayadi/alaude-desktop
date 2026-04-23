// Labaik — 04 Monogram refinement
// Deep green rounded square, cream "L" with a dot accent.
// This file defines ONE mark, used at multiple sizes and contexts.

const GREEN = '#0F3D2E';
const GREEN_SOFT = '#1C5641';
const CREAM = '#F4EFE3';
const CREAM_DEEP = '#EAE3D1';
const INK = '#14110F';

const WM_FONT = '"Söhne", "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace';

// ── The mark ─────────────────────────────────────────────────────────
// viewBox 0 0 100 100.
// Rounded square, 88x88 centered, corner radius 22 (≈25%).
// L: vertical stroke at x=36, from y=26 to y=74; horizontal stroke from x=36 to x=70 at y=74. Stroke width 9.
// Dot: small cream circle top-right at (72,30), r=7 — the "signal."
// This gives: structured monogram, a small hit of asymmetry (the dot),
// and reads as "L ·" — a breadcrumb / call sign.
function Mark({ size = 64, bg = GREEN, fg = CREAM, radius = 22, dotted = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="labaik">
      <rect x="6" y="6" width="88" height="88" rx={radius} fill={bg} />
      {/* L */}
      <path
        d="M36 26 V74 H70"
        fill="none"
        stroke={fg}
        strokeWidth="9"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {/* dot */}
      {dotted && <circle cx="74" cy="30" r="6.5" fill={fg} />}
    </svg>
  );
}

// ── Wordmark ─────────────────────────────────────────────────────────
function Wordmark({ color = GREEN, size = 44, weight = 500, tracking = -0.045 }) {
  return (
    <span style={{
      fontFamily: WM_FONT,
      fontWeight: weight,
      fontSize: size,
      letterSpacing: `${tracking}em`,
      color,
      lineHeight: 1,
      display: 'inline-block',
    }}>labaik</span>
  );
}

// Shell
function Shell({ bg = CREAM, fg = GREEN, id, children, caption, padding = '40px 32px' }) {
  const bd = fg === GREEN ? 'rgba(15,61,46,0.12)' : 'rgba(244,239,227,0.14)';
  const meta = fg === GREEN ? 'rgba(15,61,46,0.55)' : 'rgba(244,239,227,0.55)';
  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: fg, display: 'flex', flexDirection: 'column', fontFamily: WM_FONT }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding }}>
        {children}
      </div>
      <div style={{ borderTop: `1px solid ${bd}`, padding: '14px 20px', display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, letterSpacing: 0.04, textTransform: 'uppercase', color: meta }}>
        <span>{id}</span>
        <span>{caption}</span>
      </div>
    </div>
  );
}

// ── A · Primary horizontal lockup ────────────────────────────────────
function Primary() {
  return (
    <Shell id="A" caption="primary · horizontal">
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Mark size={88} />
        <Wordmark size={64} weight={500} tracking={-0.05} />
      </div>
    </Shell>
  );
}

// ── B · Stacked lockup ───────────────────────────────────────────────
function Stacked() {
  return (
    <Shell id="B" caption="stacked">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <Mark size={104} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <Wordmark size={48} weight={500} tracking={-0.05} />
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.22, textTransform: 'uppercase', color: 'rgba(15,61,46,0.55)' }}>
            agent client
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── C · Mark only, large ─────────────────────────────────────────────
function MarkOnly() {
  return (
    <Shell id="C" caption="mark · isolation">
      <Mark size={180} />
    </Shell>
  );
}

// ── D · Inverse ──────────────────────────────────────────────────────
function Inverse() {
  return (
    <Shell bg={GREEN} fg={CREAM} id="D" caption="inverse">
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Mark size={88} bg={CREAM} fg={GREEN} />
        <Wordmark color={CREAM} size={64} weight={500} tracking={-0.05} />
      </div>
    </Shell>
  );
}

// ── E · Construction / geometry diagram ──────────────────────────────
function Construction() {
  const g = 'rgba(15,61,46,0.22)';
  return (
    <Shell id="E" caption="construction">
      <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
        <svg width="240" height="240" viewBox="0 0 100 100">
          {/* grid */}
          {[0,10,20,30,40,50,60,70,80,90,100].map(v => (
            <g key={v}>
              <line x1={v} y1="0" x2={v} y2="100" stroke={g} strokeWidth="0.3" />
              <line x1="0" y1={v} x2="100" y2={v} stroke={g} strokeWidth="0.3" />
            </g>
          ))}
          <rect x="6" y="6" width="88" height="88" rx="22" fill="none" stroke={GREEN} strokeWidth="0.6" strokeDasharray="1 1.5" />
          <rect x="6" y="6" width="88" height="88" rx="22" fill={GREEN} />
          <path d="M36 26 V74 H70" fill="none" stroke={CREAM} strokeWidth="9" strokeLinecap="square" />
          <circle cx="74" cy="30" r="6.5" fill={CREAM} />
          {/* marks */}
          <circle cx="74" cy="30" r="6.5" fill="none" stroke={CREAM} strokeWidth="0.4" strokeDasharray="0.8 0.8" opacity="0.8" transform="translate(0,0) scale(1)" />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: MONO, fontSize: 11, color: 'rgba(15,61,46,0.7)', letterSpacing: 0.02 }}>
          <div><span style={{ color: GREEN, fontWeight: 500 }}>Grid</span> &nbsp;10 × 10</div>
          <div><span style={{ color: GREEN, fontWeight: 500 }}>Container</span> &nbsp;88 · r22</div>
          <div><span style={{ color: GREEN, fontWeight: 500 }}>L stroke</span> &nbsp;9</div>
          <div><span style={{ color: GREEN, fontWeight: 500 }}>Signal</span> &nbsp;ø13</div>
          <div style={{ opacity: .6, marginTop: 6 }}>"the L is a call.<br/>the dot is a response."</div>
        </div>
      </div>
    </Shell>
  );
}

// ── F · Scale / small-size reduction ─────────────────────────────────
function Scales() {
  return (
    <Shell id="F" caption="scale · small-size">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 26 }}>
        {[128, 80, 48, 28, 16].map((s) => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Mark size={s} />
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.15, color: 'rgba(15,61,46,0.55)', textTransform: 'uppercase' }}>{s}px</div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ── G · Color variants ───────────────────────────────────────────────
function Variants() {
  const row = { display: 'flex', gap: 20, alignItems: 'center' };
  return (
    <Shell id="G" caption="color · variants">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center' }}>
        <div style={row}>
          <Mark size={72} />
          <Mark size={72} bg={CREAM} fg={GREEN} />
          <Mark size={72} bg={INK} fg={CREAM} />
          <Mark size={72} bg={CREAM_DEEP} fg={GREEN} />
        </div>
        <div style={row}>
          <Mark size={72} bg="transparent" fg={GREEN} />
          <Mark size={72} bg={GREEN_SOFT} fg={CREAM} />
          <Mark size={72} bg={GREEN} fg={GREEN_SOFT} dotted={false} />
          <Mark size={72} bg={CREAM} fg={INK} />
        </div>
      </div>
    </Shell>
  );
}

// ── H · App icons (on device-style tiles) ────────────────────────────
function AppIcons() {
  const Tile = ({ children, bg }) => (
    <div style={{
      width: 120, height: 120, borderRadius: 28, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 2px 10px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(255,255,255,0.04)',
    }}>
      {children}
    </div>
  );
  return (
    <Shell id="H" caption="app icons">
      <div style={{ display: 'flex', gap: 22 }}>
        <Tile bg={GREEN}>
          {/* Flat: no inner rounded square, just the L+dot */}
          <svg width="66" height="66" viewBox="0 0 100 100">
            <path d="M36 26 V74 H70" fill="none" stroke={CREAM} strokeWidth="11" strokeLinecap="square" />
            <circle cx="74" cy="30" r="8" fill={CREAM} />
          </svg>
        </Tile>
        <Tile bg={CREAM}>
          <svg width="66" height="66" viewBox="0 0 100 100">
            <path d="M36 26 V74 H70" fill="none" stroke={GREEN} strokeWidth="11" strokeLinecap="square" />
            <circle cx="74" cy="30" r="8" fill={GREEN} />
          </svg>
        </Tile>
        <Tile bg={INK}>
          <svg width="66" height="66" viewBox="0 0 100 100">
            <path d="M36 26 V74 H70" fill="none" stroke={CREAM} strokeWidth="11" strokeLinecap="square" />
            <circle cx="74" cy="30" r="8" fill={CREAM} />
          </svg>
        </Tile>
      </div>
    </Shell>
  );
}

// ── I · In context: site header ──────────────────────────────────────
function SiteHeader() {
  return (
    <Shell id="I" caption="header · labaik.ai" padding="0">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px', borderBottom: '1px solid rgba(15,61,46,0.10)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mark size={30} />
            <Wordmark size={20} weight={500} tracking={-0.04} />
          </div>
          <div style={{ display: 'flex', gap: 26, fontSize: 13, color: 'rgba(15,61,46,0.75)', fontWeight: 500 }}>
            <span>Agents</span>
            <span>Docs</span>
            <span>Pricing</span>
            <span style={{
              background: GREEN, color: CREAM, padding: '6px 14px', borderRadius: 999, fontSize: 12,
            }}>Sign in</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: '40px 28px', display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 500, color: GREEN, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
            A calmer client<br/>for your agents.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.15, textTransform: 'uppercase', color: 'rgba(15,61,46,0.55)' }}>
            labaik.ai · coming soon
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── J · Browser tab + favicons ───────────────────────────────────────
function Favicons() {
  return (
    <Shell id="J" caption="favicon · tab">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'stretch', width: '100%' }}>
        {/* fake chrome tab */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: '#fff', padding: '10px 14px',
          borderRadius: '10px 10px 0 0', border: '1px solid rgba(15,61,46,0.10)', borderBottom: 'none', width: 240,
        }}>
          <svg width="16" height="16" viewBox="0 0 100 100">
            <rect x="6" y="6" width="88" height="88" rx="22" fill={GREEN} />
            <path d="M36 26 V74 H70" fill="none" stroke={CREAM} strokeWidth="11" strokeLinecap="square" />
            <circle cx="74" cy="30" r="8" fill={CREAM} />
          </svg>
          <div style={{ fontSize: 12, color: 'rgba(15,61,46,0.85)', flex: 1 }}>labaik — agent client</div>
          <div style={{ fontSize: 13, color: 'rgba(15,61,46,0.4)' }}>×</div>
        </div>
        <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end' }}>
          {[48, 32, 20, 16].map((s) => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Mark size={s} />
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 0.15, color: 'rgba(15,61,46,0.55)' }}>{s}×{s}</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

// ── K · Card in context ──────────────────────────────────────────────
function Card() {
  return (
    <Shell bg={CREAM_DEEP} id="K" caption="card">
      <div style={{
        width: 340, height: 200, background: CREAM, borderRadius: 4,
        boxShadow: '0 2px 14px rgba(0,0,0,0.08)',
        padding: '26px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Mark size={34} />
          <Wordmark size={22} weight={500} tracking={-0.05} />
        </div>
        <div>
          <div style={{ fontFamily: WM_FONT, fontWeight: 500, fontSize: 13, color: GREEN }}>Your name</div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.08, color: 'rgba(15,61,46,0.6)', marginTop: 3, textTransform: 'uppercase' }}>
            labaik.ai
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── L · Specimen / hero  ─────────────────────────────────────────────
function Specimen() {
  return (
    <Shell bg={GREEN} fg={CREAM} id="L" caption="specimen" padding="48px 40px">
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.22, textTransform: 'uppercase', opacity: 0.6 }}>
          labaik · 2026
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <Mark size={180} bg={CREAM} fg={GREEN} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontFamily: WM_FONT, fontWeight: 500, fontSize: 96, letterSpacing: '-0.055em', lineHeight: 0.9, color: CREAM }}>
              labaik
            </div>
            <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 0.18, textTransform: 'uppercase', opacity: 0.6 }}>
              here I am — a client for your agents
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, letterSpacing: 0.15, textTransform: 'uppercase', opacity: 0.45 }}>
          <span>mark / wordmark / dot</span>
          <span>cream on green</span>
        </div>
      </div>
    </Shell>
  );
}

// ── Root ─────────────────────────────────────────────────────────────
function App() {
  return (
    <DesignCanvas>
      <DCSection id="lockup" title="labaik" subtitle="Monogram system · L + signal dot">
        <DCArtboard id="A" label="A · Primary" width={520} height={320}><Primary /></DCArtboard>
        <DCArtboard id="B" label="B · Stacked" width={420} height={380}><Stacked /></DCArtboard>
        <DCArtboard id="C" label="C · Mark only" width={360} height={360}><MarkOnly /></DCArtboard>
        <DCArtboard id="D" label="D · Inverse" width={520} height={320}><Inverse /></DCArtboard>
      </DCSection>

      <DCSection id="anatomy" title="Anatomy" subtitle="Construction, scale, color">
        <DCArtboard id="E" label="E · Construction" width={560} height={360}><Construction /></DCArtboard>
        <DCArtboard id="F" label="F · Scale" width={560} height={320}><Scales /></DCArtboard>
        <DCArtboard id="G" label="G · Variants" width={460} height={360}><Variants /></DCArtboard>
      </DCSection>

      <DCSection id="context" title="In context">
        <DCArtboard id="H" label="H · App icons" width={520} height={320}><AppIcons /></DCArtboard>
        <DCArtboard id="I" label="I · Site header" width={640} height={380}><SiteHeader /></DCArtboard>
        <DCArtboard id="J" label="J · Favicons" width={420} height={320}><Favicons /></DCArtboard>
        <DCArtboard id="K" label="K · Card" width={460} height={320}><Card /></DCArtboard>
        <DCArtboard id="L" label="L · Specimen" width={820} height={440}><Specimen /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
