import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad, usePrefs, Avatar, Chip, Icon, Empty, ErrorNote, nowMin } from '../lib.jsx';
import { SERIES, StackedDays, Donut, Arrivals, Legend, CountUp } from '../charts.jsx';

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : null;
const SOURCE = { device: ['finger', 'Fingerprint'], phone: ['phone', 'Phone, in the office'], 'phone-field': ['phone', 'Phone, outside'], import: ['download', 'Imported'] };

// A headline number with its change since the previous working day.
function Kpi({ label, value, unit, sub, icon, tone, delta, goodWhenUp = true, to }) {
  const body = <>
    <span className="top">{label}<span className="ic"><Icon name={icon} /></span></span>
    <span className="value"><CountUp value={value} />{unit && <small>{unit}</small>}</span>
    <span className="sub">
      {delta != null && delta !== 0 && <span className={'delta ' + ((delta > 0) === goodWhenUp ? 'good' : 'bad')}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>}
      {delta === 0 && <span className="delta flat">● same</span>}
      {sub}
    </span>
  </>;
  return to ? <Link className={'stat kpi ' + tone} to={to}>{body}</Link> : <div className={'stat kpi ' + tone}>{body}</div>;
}

function Panel({ title, icon, action, className = '', children }) {
  return (
    <section className={'panel ' + className}>
      <header><h2><Icon name={icon} />{title}</h2>{action}</header>
      {children}
    </section>
  );
}

export default function Dashboard({ user }) {
  const { fmtDate, fmtTime, clock } = usePrefs();
  const [days, setDays] = useState(30);
  const [dept, setDept] = useState('');
  const [table, setTable] = useState(false);
  const [setup] = useLoad('/setup');
  const [d, reload, error] = useLoad(`/dashboard/team?days=${days}&department_id=${dept}`);
  const [updated, setUpdated] = useState(new Date());
  // Live: refresh every minute while the page is open.
  useEffect(() => { const id = setInterval(() => { reload(); setUpdated(new Date()); }, 60000); return () => clearInterval(id); }, [reload]);
  if (error) return <section className="page wide"><ErrorNote>{error}</ErrorNote></section>;
  if (!d) return <section className="page wide"><div className="skeleton" /></section>;

  const t = d.today, prev = d.previous;
  const arrived = t.present + t.late, scheduled = t.present + t.late + t.absent + t.not_in + t.leave;
  const prevArrived = prev ? prev.present + prev.late : null;
  const sum = k => d.trend.reduce((n, r) => n + r[k], 0);
  const expected = sum('present') + sum('late') + sum('absent');
  const rate = pct(sum('present') + sum('late'), expected), punctual = pct(sum('present'), sum('present') + sum('late'));
  const hour = Math.floor(nowMin() / 60);
  const md = iso => `${+iso.slice(8)} ${EN_MONTHS[+iso.slice(5, 7) - 1]}`;
  const watch = [
    { n: t.late, icon: 'clock', tone: 'gold', label: 'Late today', to: '/team' },
    { n: t.not_in, icon: 'hourglass', tone: '', label: 'Not in yet', to: '/team' },
    { n: d.watch.missing_out, icon: 'alert', tone: 'gold', label: 'Days to fix (missing check-out and others)', to: '/exceptions', hr: true },
    { n: d.watch.approvals, icon: 'check', tone: 'blue', label: 'Requests waiting for a decision', to: '/approvals' },
    { n: d.watch.probation_due, icon: 'id', tone: 'gold', label: 'Probations ending or overdue', to: '/employees', hr: true },
    { n: d.watch.absent_streak, icon: 'alert', tone: 'red', label: 'Absent several days in a row', to: '/employees', hr: true },
  ].filter(w => !w.hr || ['hr', 'admin'].includes(user.role));
  const todayParts = [...SERIES.map(s => ({ label: s.label, value: t[s.key], color: s.color })), { label: 'Not in yet', value: t.not_in, color: 'var(--s-none)' }];
  const maxDept = Math.max(1, ...d.departments.map(x => x.present + x.late + x.absent));

  return (
    <section className="page wide dash">
      <div className="greet">
        <div>
          <p className="eyebrow"><span className="live" />Live · updated {fmtTime(updated)}</p>
          <h1>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {user.full_name.split(/\s+/)[0]}</h1>
          <p className="hint">{fmtDate(d.to)} · {d.employees} people{dept ? ' in this department' : ''}</p>
        </div>
        <div className="actions">
          <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>{setup?.departments.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <div className="seg" role="group" aria-label="Period">
            {[7, 30, 90].map(n => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} days</button>)}
          </div>
        </div>
      </div>

      <div className="stats kpis">
        <Kpi label="In today" value={arrived} unit={`/ ${scheduled}`} icon="check" tone="green" to="/team"
          delta={prevArrived == null ? null : arrived - prevArrived} sub={`${pct(arrived, scheduled - t.leave) ?? 0}% of those expected`} />
        <Kpi label="Late today" value={t.late} icon="clock" tone="gold" to="/team" goodWhenUp={false}
          delta={prev ? t.late - prev.late : null} sub="vs last working day" />
        <Kpi label="Absent" value={t.absent} icon="alert" tone="red" to="/team" goodWhenUp={false}
          delta={prev ? t.absent - prev.absent : null} sub={t.not_in ? `${t.not_in} not in yet` : 'vs last working day'} />
        <Kpi label="On leave" value={t.leave} icon="plane" tone="blue" to="/leave-calendar" sub="Approved leave today" />
        <Kpi label="Attendance rate" value={rate ?? 0} unit="%" icon="trend" tone="violet"
          sub={punctual == null ? `Last ${days} days` : `Last ${days} days · ${punctual}% on time`} />
      </div>

      <div className="dash-grid">
        <Panel className="span-8" title="Attendance per day" icon="chart"
          action={<button className="quiet" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>}>
          <Legend items={SERIES.map(s => ({ ...s, value: sum(s.key) }))} />
          {!d.trend.length ? <Empty>No attendance recorded in this period yet.</Empty>
            : table ? <div className="table-wrap flat"><table>
                <thead><tr><th>Date</th>{SERIES.map(s => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Rate</th></tr></thead>
                <tbody>{[...d.trend].reverse().map(r => <tr key={r.date}><td>{fmtDate(r.date)}</td>{SERIES.map(s => <td key={s.key} className="num">{r[s.key]}</td>)}
                  <td className="num">{pct(r.present + r.late, r.present + r.late + r.absent) ?? '–'}%</td></tr>)}</tbody></table></div>
            : <StackedDays data={d.trend} fmtLabel={md} fmtFull={fmtDate} />}
        </Panel>

        <Panel className="span-4" title="Today" icon="users">
          <div className="today-split">
            <Donut parts={todayParts} center={`${pct(arrived, scheduled - t.leave) ?? 0}%`} sub="in" />
            <ul className="breakdown">{todayParts.map(p => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.value}</b></li>)}</ul>
          </div>
        </Panel>

        <Panel className="span-7" title={`Arrival times, last ${days} days`} icon="clock">
          {d.arrivals.length ? <Arrivals bins={d.arrivals} lateAfter={d.shift_start + d.grace_min} clock={clock} />
            : <Empty>No arrivals recorded in this period yet.</Empty>}
        </Panel>

        <Panel className="span-5" title="Needs attention" icon="bell">
          <ul className="watch">{watch.map(w => <li key={w.label}>
            <Link to={w.to} className={w.n ? '' : 'calm'}><span className={'ic ' + (w.n ? w.tone : '')}><Icon name={w.n ? w.icon : 'check'} /></span>
              <span className="grow">{w.label}</span><b>{w.n}</b><span className="chev">›</span></Link></li>)}</ul>
        </Panel>

        <Panel className="span-7" title="Departments" icon="id" action={<Link className="button quiet" to="/reports">Full report <Icon name="arrow" /></Link>}>
          {d.departments.length ? <div className="table-wrap flat"><table className="dept">
            <thead><tr><th>Department</th><th className="num">People</th><th className="num">Late days</th><th className="num">Absent days</th><th>Attendance</th></tr></thead>
            <tbody>{d.departments.map(x => { const r = pct(x.present + x.late, x.present + x.late + x.absent); return (
              <tr key={x.id ?? 'none'}><td><strong>{x.name}</strong></td><td className="num">{x.people}</td><td className="num">{x.late || '–'}</td><td className="num">{x.absent || '–'}</td>
                <td><div className="rate"><div className="bar" title={`${x.present + x.late} of ${x.present + x.late + x.absent} expected days`}>
                  <i style={{ width: `${r ?? 0}%` }} /></div><b>{r ?? '–'}{r != null && '%'}</b></div></td></tr>); })}</tbody>
          </table></div> : <Empty>No departments with attendance yet.</Empty>}
        </Panel>

        <Panel className="span-5" title="Latest check-ins" icon="finger">
          {d.recent.length ? <ul className="feed">{d.recent.map(r => { const [ic, src] = SOURCE[r.source] || ['finger', r.source]; return (
            <li key={r.id}><Avatar name={r.full_name} /><div className="grow"><strong>{r.full_name}</strong><small><Icon name={ic} />{src}{r.department && ` · ${r.department}`}</small></div>
              <div className="side"><span className="time">{fmtTime(r.punched_at)}</span>{r.status && <Chip status={r.status} />}</div></li>); })}</ul>
            : <p className="hint">No one has checked in in the last two days.</p>}
        </Panel>

        <Panel className="span-6" title={`Most often late, last ${days} days`} icon="clock">
          {d.late_leaders.length ? <ol className="leaders">{d.late_leaders.map((p, i) => <li key={p.id}>
            <span className="rank">{i + 1}</span><Avatar name={p.full_name} /><div className="grow"><strong>{p.full_name}</strong><small>{p.department}</small></div>
            <div className="side"><b>{p.times}×</b><small>{Math.round(p.minutes / p.times)} min on average</small></div></li>)}</ol>
            : <p className="hint">Nobody was late in this period.</p>}
        </Panel>

        <Panel className="span-6" title="Fingerprint readers" icon="finger">
          {d.devices.length ? <ul className="devices">{d.devices.map(x => <li key={x.id}>
            <span className={'pulse ' + (x.online ? 'on' : 'off')} /><div className="grow"><strong>{x.name}</strong>
              <small>{x.last_sync_at ? `Last heard from ${fmtDate(x.last_sync_at)} ${fmtTime(x.last_sync_at)}` : 'Never connected'}</small></div>
            <span className={'tag ' + (x.online ? 'good' : 'bad')}>{x.online ? 'Online' : 'Offline'}</span></li>)}</ul>
            : <p className="hint">{['hr', 'admin'].includes(user.role) ? <>No reader is registered yet. Add one in <Link to="/settings">Settings</Link>.</> : 'Reader status is shown to HR.'}</p>}
        </Panel>
      </div>
    </section>
  );
}
