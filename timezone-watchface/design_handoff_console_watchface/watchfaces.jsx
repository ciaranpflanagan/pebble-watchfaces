// watchfaces.jsx — three Pebble Time 2 watchface directions (200×228 e-paper)
// Live clocks computed from real time zones. Exports faces to window.
// Type system: Space Grotesk (numerals, tabular) + Space Mono (labels).
// Palette: black / white / paper, single accent #ff5630.

const ACCENT = '#ff5630';

// ---- live clock --------------------------------------------------------
function useNow() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function zoneTime(date, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function seattleDate(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', day: '2-digit', month: 'short',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return {
    weekday: p.weekday.toUpperCase(),
    day: p.day,
    month: p.month.toUpperCase(),
  };
}

// Static weather (no live API on an e-paper mock) — Seattle, partly cloudy.
const WEATHER = { temp: 54, kind: 'partly' };

// ---- flat geometric weather icon --------------------------------------
// Primitive shapes only: sun = circle + ray lines, cloud = circles + bar.
function WeatherIcon({ size = 24, ink = '#fff', accent = ACCENT }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
    const r = deg * Math.PI / 180;
    const x = 36, y = 34, r1 = 20, r2 = 27;
    return (
      <line key={i}
        x1={x + Math.cos(r) * r1} y1={y + Math.sin(r) * r1}
        x2={x + Math.cos(r) * r2} y2={y + Math.sin(r) * r2}
        stroke={accent} strokeWidth="5" strokeLinecap="round" />
    );
  });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="partly cloudy">
      {rays}
      <circle cx="36" cy="34" r="14" fill={accent} />
      {/* cloud */}
      <rect x="30" y="58" width="56" height="26" rx="13" fill={ink} />
      <circle cx="48" cy="58" r="16" fill={ink} />
      <circle cx="70" cy="60" r="13" fill={ink} />
    </svg>
  );
}

const W = 200, H = 228; // true Pebble Time 2 screen px

// ======================================================================
// Direction 1 — CONSOLE (dark, structured grid, hairline rules)
// ======================================================================
function FaceConsole() {
  const now = useNow();
  const t = zoneTime(now, 'America/Los_Angeles');
  const dub = zoneTime(now, 'Europe/Dublin');
  const d = seattleDate(now);
  const [hh, mm] = t.split(':');
  return (
    <div style={{
      width: W, height: H, background: '#000', color: '#fff',
      fontFamily: "'Space Mono', monospace", position: 'relative',
      display: 'flex', flexDirection: 'column', padding: '16px 16px 14px',
      boxSizing: 'border-box',
    }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: '#7c7c7c' }}>{d.weekday}</div>
          <div style={{ fontSize: 14, letterSpacing: 1, marginTop: 2 }}>{d.day} {d.month}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <WeatherIcon size={26} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600 }}>
            {WEATHER.temp}°
          </span>
        </div>
      </div>

      {/* main time */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 62,
          letterSpacing: -1, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {hh}<span style={{ color: ACCENT }}>:</span>{mm}
        </div>
      </div>

      {/* footer — second zone */}
      <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 10, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT }} />
          <span style={{ fontSize: 11, letterSpacing: 2, color: '#9a9a9a' }}>DUBLIN</span>
        </div>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 500,
          fontVariantNumeric: 'tabular-nums' }}>{dub}</span>
      </div>
    </div>
  );
}

// ======================================================================
// Direction 2 — STACK (dark, maximal stacked numerals)
// ======================================================================
function FaceStack() {
  const now = useNow();
  const t = zoneTime(now, 'America/Los_Angeles');
  const dub = zoneTime(now, 'Europe/Dublin');
  const d = seattleDate(now);
  const [hh, mm] = t.split(':');
  return (
    <div style={{
      width: W, height: H, background: '#000', color: '#fff',
      fontFamily: "'Space Mono', monospace", position: 'relative',
      display: 'flex', flexDirection: 'column', padding: '14px 16px',
      boxSizing: 'border-box',
    }}>
      {/* top: weather right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
        <WeatherIcon size={24} />
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600 }}>
          {WEATHER.temp}°
        </span>
      </div>

      {/* stacked time */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 96,
          lineHeight: 0.86, letterSpacing: -3, fontVariantNumeric: 'tabular-nums',
        }}>
          <div>{hh}</div>
          <div style={{ color: ACCENT }}>{mm}</div>
        </div>
      </div>

      {/* bottom meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: '#bdbdbd' }}>
          {d.weekday} {d.day} {d.month}
        </div>
        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 8, display: 'flex',
          alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT }} />
          <span style={{ fontSize: 11, letterSpacing: 2, color: '#9a9a9a' }}>DUBLIN</span>
          <span style={{ marginLeft: 'auto', fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{dub}</span>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// Direction 3 — PAPER (light, refined, calm)
// ======================================================================
function FacePaper() {
  const now = useNow();
  const t = zoneTime(now, 'America/Los_Angeles');
  const dub = zoneTime(now, 'Europe/Dublin');
  const d = seattleDate(now);
  const [hh, mm] = t.split(':');
  const ink = '#1a1613';
  return (
    <div style={{
      width: W, height: H, background: '#f4f3ef', color: ink,
      fontFamily: "'Space Mono', monospace", position: 'relative',
      display: 'flex', flexDirection: 'column', padding: '17px 16px 15px',
      boxSizing: 'border-box',
    }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 2, color: '#9b948b' }}>{d.weekday}</div>
          <div style={{ fontSize: 14, letterSpacing: 1, marginTop: 2 }}>{d.day} {d.month}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <WeatherIcon size={26} ink={ink} />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600 }}>
            {WEATHER.temp}°
          </span>
        </div>
      </div>

      {/* main time */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500, fontSize: 60,
          letterSpacing: -1, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {hh}<span style={{ color: ACCENT }}>:</span>{mm}
        </div>
      </div>

      {/* footer */}
      <div style={{ borderTop: '1px solid #ddd9d0', paddingTop: 10, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT }} />
          <span style={{ fontSize: 11, letterSpacing: 2, color: '#8c857b' }}>DUBLIN</span>
        </div>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 500,
          fontVariantNumeric: 'tabular-nums' }}>{dub}</span>
      </div>
    </div>
  );
}

Object.assign(window, { FaceConsole, FaceStack, FacePaper });
