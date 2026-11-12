import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Chip, Modal, Field, ErrorNote, Empty, useAction, todayISO, STATUS } from '../lib.jsx';

export function TeamToday() {
  const { t, fmtDate, fmtTime } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [rows] = useLoad(`/attendance/today?date=${date}`);
  const [only, setOnly] = useState('');
  const count = s => rows?.filter(r => r.status === s).length || 0;
  const groups = ['present', 'late', 'half_day', 'not_in', 'absent', 'leave'].filter(s => count(s));
  const shown = rows?.filter(r => !only || r.status === only);
  return (
    <Page title={t('Team today')} hint={fmtDate(date)}
      actions={<input type="date" value={date} max={todayISO()} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" />}>
      <div className="filters">
        <button className={only ? '' : 'on'} onClick={() => setOnly('')}>All {rows?.length ?? ''}</button>
        {groups.map(s => <button key={s} className={only === s ? 'on' : ''} onClick={() => setOnly(s)}>{t(STATUS[s])} {count(s)}</button>)}
      </div>
      {shown?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Name')}</th><th>{t('Department')}</th><th>{t('Status')}</th><th>{t('Check-in')}</th><th>{t('Check-out')}</th></tr></thead>
          <tbody>{shown.map(r => <tr key={r.employee_id}><td>{r.full_name}</td><td>{r.department}</td>
            <td><Chip status={r.status} />{r.late_min > 0 && <small> {r.late_min} min</small>}</td><td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td></tr>)}</tbody>
        </table></div>
      ) : rows && <Empty>No employees to show.</Empty>}
    </Page>
  );
}

function Decide({ what, onClose, onDone }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const send = approve => act.run(async () => { await api(`${what.path}/${what.id}/decide`, { method: 'POST', body: { approve, note } }); onDone(); });
  return (
    <Modal title={what.title} onClose={onClose}>
      <p>{what.text}</p>
      <Field label="Comment (optional)"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <div className="row-end"><button onClick={() => send(false)} disabled={act.busy}>Reject</button><button className="primary" onClick={() => send(true)} disabled={act.busy}>Approve</button></div>
    </Modal>
  );
}

export function Approvals() {
  const { t, fmtDate } = usePrefs();
  const [leave, reloadLeave] = useLoad('/leave/requests?scope=pending');
  const [corr, reloadCorr] = useLoad('/corrections?scope=pending');
  const [what, setWhat] = useState(null);
  const done = () => { setWhat(null); reloadLeave(); reloadCorr(); };
  return (
    <Page title={t('Approvals')} hint="Requests waiting for your decision.">
      <h2>Leave</h2>
      {leave?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Name')}</th><th>{t('Leave type')}</th><th>{t('From')}</th><th>{t('To')}</th><th className="num">{t('Days')}</th><th>{t('Reason')}</th><th></th></tr></thead>
          <tbody>{leave.map(r => <tr key={r.id}><td>{r.full_name}<small> {r.department}</small></td><td>{r.leave_type}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td><td className="num">{r.days}</td><td>{r.reason}</td>
            <td className="num"><button onClick={() => setWhat({ path: '/leave/requests', id: r.id, title: 'Leave request', text: `${r.full_name}: ${r.leave_type}, ${fmtDate(r.start_date)} to ${fmtDate(r.end_date)} (${r.days} days).` })}>Decide</button></td></tr>)}</tbody>
        </table></div>
      ) : leave && <Empty>No leave requests are waiting.</Empty>}
      <h2>Attendance corrections</h2>
      {corr?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Name')}</th><th>{t('Date')}</th><th>Requested</th><th>{t('Reason')}</th><th></th></tr></thead>
          <tbody>{corr.map(c => { const asked = [c.requested_in && 'in ' + c.requested_in, c.requested_out && 'out ' + c.requested_out].filter(Boolean).join(', ');
            return <tr key={c.id}><td>{c.full_name}<small> {c.department}</small></td><td>{fmtDate(c.date)}</td><td>{asked}</td><td>{c.reason}</td>
              <td className="num"><button onClick={() => setWhat({ path: '/corrections', id: c.id, title: 'Attendance correction', text: `${c.full_name}, ${fmtDate(c.date)}: ${asked}. Reason: ${c.reason}` })}>Decide</button></td></tr>; })}</tbody>
        </table></div>
      ) : corr && <Empty>No corrections are waiting.</Empty>}
      {what && <Decide what={what} onClose={() => setWhat(null)} onDone={done} />}
    </Page>
  );
}

const FLAG_TEXT = { missing_out: 'No check-out', unscheduled: 'Came on a day off', field: 'Checked in outside the office' };

export function FixRecord({ record, employees, onClose, onDone }) {
  const hhmm = ts => { if (!ts) return ''; const d = new Date(new Date(ts).getTime() + 3 * 36e5); return d.toISOString().slice(11, 16); };
  const [f, setF] = useState({ employee_id: record.employee_id || '', date: record.date || todayISO(), check_in: hhmm(record.check_in), check_out: hhmm(record.check_out), status: '', note: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { await api('/attendance', { method: 'POST', body: f }); onDone(); }); };
  return (
    <Modal title={record.full_name ? `Fix record: ${record.full_name}` : 'Add a record'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        {employees && <Field label="Employee"><select value={f.employee_id} onChange={e => setF({ ...f, employee_id: e.target.value })} required>
          <option value="">Choose…</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_no})</option>)}</select></Field>}
        <Field label="Date"><input type="date" max={todayISO()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required disabled={!employees} /></Field>
        <div className="two">
          <Field label="Check-in"><input type="time" value={f.check_in} onChange={e => setF({ ...f, check_in: e.target.value })} /></Field>
          <Field label="Check-out"><input type="time" value={f.check_out} onChange={e => setF({ ...f, check_out: e.target.value })} /></Field>
        </div>
        {!f.check_in && <Field label="No times? Set the day as"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} required>
          <option value="">Choose…</option><option value="absent">Absent</option><option value="present">Present (no times)</option><option value="leave">On leave</option><option value="holiday">Holiday</option></select></Field>}
        <Field label="Reason (kept in the audit log)"><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} required /></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end"><button className="primary" disabled={act.busy}>Save</button></div>
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
    <Page title={t('Exceptions')} hint="Only the days that need a decision. Everything else was recorded automatically."
      actions={<button onClick={() => setFix({})}>Add a record</button>}>
      <ErrorNote>{error || act.error}</ErrorNote>
      {rows?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Date')}</th><th>{t('Name')}</th><th>Problem</th><th>{t('Check-in')}</th><th>{t('Check-out')}</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.full_name}<small> {r.department}</small></td><td><span className="warn">{FLAG_TEXT[r.flag] || r.flag}</span></td>
            <td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td>
            <td className="num">{r.flag !== 'missing_out' && <button onClick={() => accept(r)}>Accept</button>} <button className="primary" onClick={() => setFix(r)}>Fix</button></td></tr>)}</tbody>
        </table></div>
      ) : rows && <Empty>Nothing needs your attention. All recent days are complete.</Empty>}

      {unknown?.length > 0 && <>
        <h2>Fingerprints not linked to an employee</h2>
        <p className="hint">These IDs punched on a device but no employee has them. Enter the ID on the employee's record and the punches become attendance.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Fingerprint ID</th><th className="num">Punches</th><th>Last seen</th></tr></thead>
          <tbody>{unknown.map(u => <tr key={u.fingerprint_id}><td>{u.fingerprint_id}</td><td className="num">{u.punches}</td><td>{fmtStamp(u.last_seen)}</td></tr>)}</tbody>
        </table></div>
      </>}
      {fix && <FixRecord record={fix} employees={fix.id ? null : employees} onClose={() => setFix(null)} onDone={() => { setFix(null); reload(); }} />}
    </Page>
  );
}
