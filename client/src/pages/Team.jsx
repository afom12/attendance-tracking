import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Chip, Modal, Avatar, Field, ErrorNote, Empty, useAction, todayISO, STATUS, Stat, Tabs, Icon } from '../lib.jsx';

const CELL = { present: ['check', 'good'], extra: ['plus', 'good'], late: ['clock', 'warn'], half_day: ['clock', 'warn'], absent: ['x', 'bad'],
  leave: ['plane', 'away'], holiday: ['sun', 'away'], not_in: ['hourglass', 'wait'] };

// Seven days, one row per person: patterns (always late on Mondays, absent every Friday) jump out.
function WeekGrid() {
  const { fmtDate, fmtTime } = usePrefs();
  const [start, setStart] = useState(todayISO());
  const [data] = useLoad(`/attendance/week?start=${start}`);
  const [find, setFind] = useState('');
  const shift = n => { const d = new Date(Date.parse((data?.start || start) + 'T00:00:00Z') + n * 7 * 864e5); setStart(d.toISOString().slice(0, 10)); };
  const people = data?.people.filter(p => (p.full_name + (p.department || '')).toLowerCase().includes(find.toLowerCase()));
  const short = iso => fmtDate(iso).split(' ');
  return (<>
    <div className="filters">
      <button onClick={() => shift(-1)} aria-label="Previous week">‹</button>
      <strong className="week-label">{data && `${fmtDate(data.start)} – ${fmtDate(data.end)}`}</strong>
      <button onClick={() => shift(1)} disabled={data && data.end >= todayISO()} aria-label="Next week">›</button>
      <input type="search" className="push" placeholder="Find a person" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a person" />
    </div>
    {people?.length ? <div className="table-wrap"><table className="week">
      <thead><tr><th>Person</th>{data.days.map(d => <th key={d} className={d === todayISO() ? 'today' : ''}><span>{short(d)[0]}</span><b>{short(d)[1]}</b></th>)}<th className="num">Hours</th></tr></thead>
      <tbody>{people.map(p => {
        const cells = data.days.map(d => p.cells[d]);
        const hrs = cells.reduce((n, c) => n + (c?.worked_min || 0), 0) / 60;
        const late = cells.filter(c => ['late', 'half_day'].includes(c?.status)).length, absent = cells.filter(c => c?.status === 'absent').length;
        return <tr key={p.id}>
          <td><div className="who-cell"><Avatar name={p.full_name} /><div><strong>{p.full_name}</strong><small>{p.department}</small></div></div></td>
          {cells.map((c, i) => { const [ic, tone] = CELL[c?.status] || []; return <td key={i} className="cell">
            {c ? <div className={'day ' + tone + (c.flag ? ' flag' : '')} title={`${fmtDate(data.days[i])}: ${STATUS[c.status] || c.status}${c.check_in ? `, ${fmtTime(c.check_in)}${c.check_out ? `–${fmtTime(c.check_out)}` : ''}` : ''}${c.late_min ? `, ${c.late_min} min late` : ''}`}>
              <Icon name={ic} /><span>{c.worked_min ? (c.worked_min / 60).toFixed(1) + 'h' : STATUS[c.status]}</span></div>
              : <div className="day off">–</div>}</td>; })}
          <td className="num"><b>{hrs.toFixed(1)}h</b>{(late > 0 || absent > 0) && <div className="mini-tags">{late > 0 && <span className="tag warn">{late} late</span>}{absent > 0 && <span className="tag bad">{absent} absent</span>}</div>}</td>
        </tr>; })}</tbody>
    </table></div> : data && <Empty>Nobody to show for this week.</Empty>}
  </>);
}

export function TeamToday() {
  const [view, setView] = useState('Today');
  return view === 'This week'
    ? <Page wide title="This week" hint="Every person, every day. Hover a day for the times." actions={<Tabs tabs={['Today', 'This week']} value={view} onChange={setView} />}><WeekGrid /></Page>
    : <DayView tabs={<Tabs tabs={['Today', 'This week']} value={view} onChange={setView} />} />;
}

function DayView({ tabs }) {
  const { t, fmtDate, fmtTime } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [rows] = useLoad(`/attendance/today?date=${date}`);
  const [only, setOnly] = useState('');
  const count = s => rows?.filter(r => r.status === s).length || 0;
  const groups = ['present', 'late', 'half_day', 'not_in', 'absent', 'leave'].filter(s => count(s));
  // The tiles filter by group: 'in' covers everyone who arrived, 'late' includes half days.
  const GROUP = { in: ['present', 'late', 'half_day', 'extra'], late: ['late', 'half_day'] };
  const shown = rows?.filter(r => only ? (GROUP[only] || [only]).includes(r.status) : r.status !== 'off');
  const scheduled = rows?.filter(r => r.status !== 'off').length || 0;
  const inNow = count('present') + count('late') + count('half_day') + count('extra');
  const pick = s => setOnly(only === s ? '' : s);
  return (
    <Page wide title={date === todayISO() ? t('Team today') : fmtDate(date)} hint={date === todayISO() ? `${fmtDate(date)} · ${inNow} of ${scheduled} in` : undefined}
      actions={<>{tabs}<input type="date" value={date} max={todayISO()} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" /></>}>
      {rows && scheduled > 0 && <div className="stats" style={{ marginTop: 0, marginBottom: '1.25rem' }}>
        <Stat label="In" value={inNow} unit={`/ ${scheduled}`} sub={scheduled ? `${Math.round(inNow / scheduled * 100)}% attendance` : ''} icon="check" tone="green" on={only === 'in'} onClick={() => pick('in')} />
        <Stat label="Late" value={count('late') + count('half_day')} sub="Arrived after the grace period" icon="clock" tone="gold" on={only === 'late'} onClick={() => pick('late')} />
        <Stat label="Not in yet" value={count('not_in')} sub={count('absent') ? `${count('absent')} absent` : 'No absences'} icon="hourglass" tone={count('absent') ? 'red' : ''} on={only === 'not_in'} onClick={() => pick('not_in')} />
        <Stat label="On leave" value={count('leave')} sub="Approved leave" icon="plane" tone="blue" on={only === 'leave'} onClick={() => pick('leave')} />
      </div>}
      {groups.length > 0 && <div className="filters">
        <button className={only ? '' : 'on'} onClick={() => setOnly('')}>Everyone</button>
        {groups.map(s => <button key={s} className={only === s ? 'on' : ''} onClick={() => setOnly(s)}>{t(STATUS[s])} <span className="n">{count(s)}</span></button>)}
      </div>}
      {shown?.length ? (
        <ul className="list">
          {shown.map(r => (
            <li key={r.employee_id}><Avatar name={r.full_name} />
              <div className="grow"><strong>{r.full_name}</strong><small>{r.department}</small></div>
              <div className="side">{r.check_in && <span className="time">{fmtTime(r.check_in)}{r.check_out && ` to ${fmtTime(r.check_out)}`}</span>}<Chip status={r.status} /></div>
            </li>))}
        </ul>
      ) : rows && <Empty>Nobody is scheduled to work on this day.</Empty>}
    </Page>
  );
}

// Approve with one click; rejecting asks for a short reason the employee will see.
function Decision({ path, id, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const send = approve => act.run(async () => { await api(`${path}/${id}/decide`, { method: 'POST', body: { approve, note } }); onDone(); });
  if (rejecting) return (
    <form className="inline" onSubmit={e => { e.preventDefault(); send(false); }}>
      <input autoFocus placeholder="Reason for the employee" value={note} onChange={e => setNote(e.target.value)} required />
      <button className="danger" disabled={act.busy}>Reject</button><button type="button" className="quiet" onClick={() => setRejecting(false)}>Back</button>
      <ErrorNote>{act.error}</ErrorNote>
    </form>
  );
  return <><button onClick={() => setRejecting(true)}>Reject</button><button className="primary" onClick={() => send(true)} disabled={act.busy}>Approve</button><ErrorNote>{act.error}</ErrorNote></>;
}

export function Approvals() {
  const { t, fmtDate } = usePrefs();
  const [leave, reloadLeave] = useLoad('/leave/requests?scope=pending');
  const [corr, reloadCorr] = useLoad('/corrections?scope=pending');
  const nothing = leave && corr && !leave.length && !corr.length;
  return (
    <Page title={t('Approvals')} hint="Requests that are yours to decide. Nobody decides their own.">
      {nothing && <Empty>Nothing is waiting for you.</Empty>}
      {leave?.length > 0 && <>
        <h2 style={{ marginTop: 0 }}>Leave</h2>
        <ul className="list">{leave.map(r => (
          <li key={r.id}><Avatar name={r.full_name} />
            <div className="grow"><strong>{r.full_name} asks for {r.days} {r.days === 1 ? 'day' : 'days'} of {r.leave_type.toLowerCase()} leave</strong>
              <small>{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` to ${fmtDate(r.end_date)}`}{r.reason && `. ${r.reason}`}</small>
              <span className="tags">
                {r.balance && <span className={'tag ' + (r.balance.left_after < 0 ? 'bad' : 'good')}>{r.balance.left_after < 0 ? 'Not enough balance' : `${r.balance.left_after} of ${r.balance.entitled} days left after this`}</span>}
                {r.also_away?.length > 0 && <span className="tag warn" title={r.also_away.join(', ')}>Also away then: {r.also_away.slice(0, 2).join(', ')}{r.also_away.length > 2 && ` +${r.also_away.length - 2}`}</span>}
                {r.waiting_days >= 2 && <span className="tag warn">Waiting {r.waiting_days} days</span>}
              </span></div>
            <div className="side"><Decision path="/leave/requests" id={r.id} onDone={reloadLeave} /></div>
          </li>))}</ul>
      </>}
      {corr?.length > 0 && <>
        <h2>Attendance corrections</h2>
        <ul className="list">{corr.map(c => (
          <li key={c.id}><Avatar name={c.full_name} />
            <div className="grow"><strong>{c.full_name} says {[c.requested_in && `arrival was ${c.requested_in}`, c.requested_out && `departure was ${c.requested_out}`].filter(Boolean).join(' and ')}</strong>
              <small>{fmtDate(c.date)}. {c.reason}</small></div>
            <div className="side"><Decision path="/corrections" id={c.id} onDone={reloadCorr} /></div>
          </li>))}</ul>
      </>}
    </Page>
  );
}

const PROBLEM = { missing_out: 'did not record a departure', unscheduled: 'came in on a day off', field: 'recorded time outside the office' };

export function FixRecord({ record, employees, onClose, onDone }) {
  const { fmtDate } = usePrefs();
  const hhmm = ts => { if (!ts) return ''; const d = new Date(new Date(ts).getTime() + 3 * 36e5); return d.toISOString().slice(11, 16); };
  const [f, setF] = useState({ employee_id: record.employee_id || '', date: record.date || todayISO(), check_in: hhmm(record.check_in), check_out: hhmm(record.check_out), status: '', note: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { await api('/attendance', { method: 'POST', body: f }); onDone(); }); };
  return (
    <Modal title={record.full_name ? `${record.full_name}, ${fmtDate(record.date)}` : 'Add a day by hand'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        {employees && <>
          <Field label="Employee"><select value={f.employee_id} onChange={e => setF({ ...f, employee_id: e.target.value })} required>
            <option value="">Choose…</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
          <Field label="Date"><input type="date" max={todayISO()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
        </>}
        <div className="two">
          <Field label="Arrived"><input type="time" value={f.check_in} onChange={e => setF({ ...f, check_in: e.target.value })} /></Field>
          <Field label="Left"><input type="time" value={f.check_out} onChange={e => setF({ ...f, check_out: e.target.value })} /></Field>
        </div>
        {!f.check_in && <Field label="No times? Mark the day as"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} required>
          <option value="">Choose…</option><option value="absent">Absent</option><option value="present">Present</option><option value="leave">On leave</option><option value="holiday">Holiday</option></select></Field>}
        <Field label="Reason"><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} required /><small>Kept in the change history.</small></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end"><button className="primary" disabled={act.busy}>Save the day</button></div>
      </form>
    </Modal>
  );
}

export function Exceptions() {
  const { t, fmtDate, fmtTime, fmtStamp } = usePrefs();
  const [rows, reload, error] = useLoad('/attendance/exceptions');
  const [unknown] = useLoad('/punches/unknown');
  const [employees] = useLoad('/employees');
  const [fix, setFix] = useState(null);
  const act = useAction();
  const accept = r => act.run(async () => { await api(`/attendance/${r.id}/accept`, { method: 'POST', body: {} }); reload(); });
  return (
    <Page title={t('Exceptions')} hint="Only the days that need your decision. Every other day was recorded automatically."
      actions={<button onClick={() => setFix({})}>Add a day by hand</button>}>
      <ErrorNote>{error || act.error}</ErrorNote>
      {rows?.length ? (
        <ul className="list">
          {rows.map(r => (
            <li key={r.id}><Avatar name={r.full_name} />
              <div className="grow"><strong>{r.full_name} {PROBLEM[r.flag] || r.flag}</strong>
                <small>{fmtDate(r.date)}, {fmtTime(r.check_in)}{r.check_out ? ` to ${fmtTime(r.check_out)}` : ''}</small></div>
              <div className="side">{r.flag !== 'missing_out' && <button onClick={() => accept(r)}>Accept as it is</button>}<button className="primary" onClick={() => setFix(r)}>Fix</button></div>
            </li>))}
        </ul>
      ) : rows && <Empty>All clear. Every recent day is complete.</Empty>}

      {unknown?.length > 0 && <>
        <h2>Fingerprints with no owner</h2>
        <p className="hint" style={{ marginBottom: '1rem' }}>Someone used the reader with these numbers, but no employee has them. Open the employee and enter the number as their fingerprint ID.</p>
        <ul className="list">{unknown.map(u => <li key={u.fingerprint_id}><div className="grow"><strong>Fingerprint ID {u.fingerprint_id}</strong><small>Used {u.punches} {u.punches === 1 ? 'time' : 'times'}, last on {fmtStamp(u.last_seen)}</small></div></li>)}</ul>
      </>}
      {fix && <FixRecord record={fix} employees={fix.id ? null : employees} onClose={() => setFix(null)} onDone={() => { setFix(null); reload(); }} />}
    </Page>
  );
}
