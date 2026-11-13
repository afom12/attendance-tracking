import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Chip, Modal, Avatar, Field, ErrorNote, Empty, useAction, todayISO, STATUS } from '../lib.jsx';

export function TeamToday() {
  const { t, fmtDate, fmtTime } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [rows] = useLoad(`/attendance/today?date=${date}`);
  const [only, setOnly] = useState('');
  const count = s => rows?.filter(r => r.status === s).length || 0;
  const groups = ['present', 'late', 'half_day', 'not_in', 'absent', 'leave'].filter(s => count(s));
  const shown = rows?.filter(r => only ? r.status === only : r.status !== 'off');
  return (
    <Page title={date === todayISO() ? t('Team today') : fmtDate(date)} hint={date === todayISO() ? fmtDate(date) : undefined}
      actions={<input type="date" value={date} max={todayISO()} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" />}>
      {groups.length > 0 && <div className="filters">
        <button className={only ? '' : 'on'} onClick={() => setOnly('')}>Everyone</button>
        {groups.map(s => <button key={s} className={only === s ? 'on' : ''} onClick={() => setOnly(s)}>{count(s)} {t(STATUS[s]).toLowerCase()}</button>)}
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
    <Page title={t('Approvals')}>
      {nothing && <Empty>Nothing is waiting for you.</Empty>}
      {leave?.length > 0 && <>
        <h2 style={{ marginTop: 0 }}>Leave</h2>
        <ul className="list">{leave.map(r => (
          <li key={r.id}><Avatar name={r.full_name} />
            <div className="grow"><strong>{r.full_name} asks for {r.days} {r.days === 1 ? 'day' : 'days'} of {r.leave_type.toLowerCase()} leave</strong>
              <small>{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` to ${fmtDate(r.end_date)}`}{r.reason && `. ${r.reason}`}</small></div>
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
