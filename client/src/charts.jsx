// Small SVG charts, no library. Colours come from CSS tokens (--s-*), validated for light and dark.
// Every chart has a hover tooltip, a legend or direct labels, and identity never rests on colour alone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const SERIES = [
  { key: 'present', label: 'On time', color: 'var(--s-present)' },
  { key: 'late', label: 'Late', color: 'var(--s-late)' },
  { key: 'leave', label: 'On leave', color: 'var(--s-leave)' },
  { key: 'absent', label: 'Absent', color: 'var(--s-absent)' },
];

// Width of the element, kept current as the layout changes.
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// A tooltip that follows the pointer inside the chart box and stays on screen.
function useTip() {
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const show = (e, content) => {
    const r = box.current.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, content });
  };
  const el = tip && <div className="tip" style={{ left: Math.min(Math.max(tip.x, 90), tip.w - 90), top: tip.y }}>{tip.content}</div>;
  return { box, show, hide: () => setTip(null), el };
}

// Axis top that splits into 4 equal whole-number steps, rounded to a half power of ten when large.
const niceMax = v => { const raw = Math.max(1, v) / 4, p = 10 ** Math.floor(Math.log10(raw)); const step = p >= 10 ? Math.ceil(raw / (p / 2)) * (p / 2) : Math.ceil(raw); return step * 4; };
const topRounded = (x, y, w, h, r) => {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export function Legend({ items }) {
  return <div className="legend">{items.map(i => <span key={i.label}><i style={{ background: i.color }} />{i.label}{i.value != null && <b>{i.value}</b>}</span>)}</div>;
}

// Days side by side, each split into on time / late / on leave / absent.
export function StackedDays({ data, series = SERIES, height = 240, fmtLabel, fmtFull }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const [hover, setHover] = useState(null);
  const pad = { l: 34, r: 8, t: 10, b: 26 };
  const total = d => series.reduce((n, s) => n + (d[s.key] || 0), 0);
  const max = niceMax(Math.max(1, ...data.map(total)));
  const iw = Math.max(0, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const step = data.length ? iw / data.length : 0, bw = Math.max(3, Math.min(28, step * 0.62));
  const y = v => pad.t + ih - v / max * ih;
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 56))));
  return (
    <div className="chart" ref={el => { ref.current = el; tip.box.current = el; }} onMouseLeave={() => { tip.hide(); setHover(null); }}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label="Attendance per day">
        {[0, .25, .5, .75, 1].map(f => <g key={f}>
          <line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} className={f ? 'grid' : 'axis'} />
          <text x={pad.l - 8} y={y(max * f) + 4} className="tick" textAnchor="end">{Math.round(max * f)}</text></g>)}
        {data.map((d, i) => {
          const cx = pad.l + step * i + step / 2;
          let acc = 0;
          const segs = series.map(s => ({ s, v: d[s.key] || 0 })).filter(x => x.v > 0);
          return <g key={d.date}>
            {hover === i && <rect x={cx - step / 2} y={pad.t} width={step} height={ih} className="hover-band" />}
            {segs.map((x, j) => {
              const y0 = y(acc), y1 = y(acc + x.v); acc += x.v;
              const top = j === segs.length - 1, h = Math.max(0, y0 - y1 - (top ? 0 : 2));
              return top ? <path key={x.s.key} d={topRounded(cx - bw / 2, y1, bw, y0 - y1, 4)} style={{ fill: x.s.color }} />
                : <rect key={x.s.key} x={cx - bw / 2} y={y1 + 2} width={bw} height={h} style={{ fill: x.s.color }} />;
            })}
            {i % every === 0 && <text x={cx} y={height - 8} className="tick" textAnchor="middle">{fmtLabel(d.date)}</text>}
            <rect x={cx - step / 2} y={pad.t} width={step} height={ih} fill="transparent"
              onMouseMove={e => { setHover(i); tip.show(e, <><strong>{fmtFull(d.date)}</strong>{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}<b>{d[s.key] || 0}</b></span>)}</>); }} />
          </g>;
        })}
      </svg>}
      {tip.el}
    </div>
  );
}

// Part of a whole, with a gap between parts and the headline number in the middle.
export function Donut({ parts, center, sub, size = 168 }) {
  const tip = useTip();
  const total = parts.reduce((n, p) => n + p.value, 0);
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut" ref={tip.box} onMouseLeave={tip.hide} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${center} ${sub}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="donut-bg" />
        {total > 0 && parts.filter(p => p.value > 0).map(p => {
          const len = p.value / total * c, gap = parts.filter(x => x.value > 0).length > 1 ? Math.min(3, len / 2) : 0;
          const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} className="donut-arc" style={{ stroke: p.color }}
            strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            onMouseMove={e => tip.show(e, <><strong>{p.label}</strong><span>{p.value} {p.value === 1 ? 'person' : 'people'}<b>{Math.round(p.value / total * 100)}%</b></span></>)} />;
          acc += len;
          return el;
        })}
      </svg>
      <div className="mid"><b>{center}</b><small>{sub}</small></div>
      {tip.el}
    </div>
  );
}

// How many people arrived in each 5 minutes; bars after the grace period are drawn as late.
export function Arrivals({ bins, lateAfter, clock, height = 270 }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const [hover, setHover] = useState(null);
  const from = Math.min(lateAfter - 90, ...bins.map(b => b.min)), to = Math.max(lateAfter + 90, ...bins.map(b => b.min + 5));
  const slots = [];
  for (let m = Math.floor(from / 30) * 30; m < to; m += 5) slots.push({ min: m, n: bins.find(b => b.min === m)?.n || 0 });
  const pad = { l: 30, r: 8, t: 22, b: 24 }, iw = Math.max(0, width - pad.l - pad.r), ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...slots.map(s => s.n))), step = slots.length ? iw / slots.length : 0, bw = Math.max(2, step - 2);
  const every = step * 6 < 44 ? 60 : 30;
  const y = v => pad.t + ih - v / max * ih, x = m => pad.l + (m - slots[0].min) / 5 * step;
  return (
    <div className="chart" ref={el => { ref.current = el; tip.box.current = el; }} onMouseLeave={() => { tip.hide(); setHover(null); }}>
      {width > 0 && slots.length > 0 && <svg width={width} height={height} role="img" aria-label="Arrival times">
        {[0, .5, 1].map(f => <g key={f}><line x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} className={f ? 'grid' : 'axis'} />
          <text x={pad.l - 7} y={y(max * f) + 4} className="tick" textAnchor="end">{Math.round(max * f)}</text></g>)}
        {slots.map((s, i) => <g key={s.min}>
          {s.n > 0 && <path d={topRounded(x(s.min) + 1, y(s.n), bw, pad.t + ih - y(s.n), 4)} style={{ fill: s.min >= lateAfter ? 'var(--s-late)' : 'var(--s-present)', opacity: hover == null || hover === i ? 1 : .55 }} />}
          {s.min % every === 0 && <text x={x(s.min)} y={height - 7} className="tick" textAnchor="middle">{clock(s.min)}</text>}
          <rect x={x(s.min)} y={pad.t} width={step} height={ih} fill="transparent"
            onMouseMove={e => { setHover(i); tip.show(e, <><strong>{clock(s.min)} – {clock(s.min + 5)}</strong><span>{s.n} {s.n === 1 ? 'arrival' : 'arrivals'}<b>{s.min >= lateAfter ? 'late' : 'on time'}</b></span></>); }} />
        </g>)}
        <line x1={x(lateAfter)} x2={x(lateAfter)} y1={pad.t - 6} y2={pad.t + ih} className="marker" />
        <text x={x(lateAfter) + 5} y={pad.t - 9} className="tick strong">Late after {clock(lateAfter)}</text>
      </svg>}
      {tip.el}
    </div>
  );
}

// Animated count-up for headline numbers.
export function CountUp({ value, decimals = 0 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof value !== 'number') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(value); return; }
    let raf, t0;
    const run = t => { t0 ??= t; const k = Math.min(1, (t - t0) / 600); setV(value * (1 - (1 - k) ** 3)); if (k < 1) raf = requestAnimationFrame(run); };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return typeof value === 'number' ? v.toFixed(decimals) : value;
}
