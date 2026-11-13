import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Chip, Modal, Drawer, Field, ErrorNote, Empty, useAction, hours, todayISO } from '../lib.jsx';

const FLAGS = { missing_out: 'No departure recorded', unscheduled: 'Not one of your working days', field: 'Recorded outside the office' };

function CorrectionForm({ date, onClose, onDone }) {
  const { fmtDate } = usePrefs();
  const [f, setF] = useState({ date, requested_in: '', requested_out: '', reason: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { await api('/corrections', { method: 'POST', body: f }); onDone(); }); };
  return (
    <Modal title={`Correct ${fmtDate(date)}`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="hint">Fill in only the time that is wrong or missing. Your supervisor decides.</p>
        <div className="two">
          <Field label="I arrived at"><input type="time" value={f.requested_in} onChange={e => setF({ ...f, requested_in: e.target.value })} /></Field>
          <Field label="I left at"><input type="time" value={f.requested_out} onChange={e => setF({ ...f, requested_out: e.target.value })} /></Field>
        </div>
        <Field label="What happened?"><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} required /></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end"><button className="primary" disabled={act.busy}>Send to my supervisor</button></div>
      </form>
    </Modal>
  );
}

export function MyAttendance() {
  const { t, fmtDate, fmtTime } = usePrefs();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
  const [rows] = useLoad(`/attendance?from=${month}-01&to=${end}`);
  const [corr, reloadCorr] = useLoad('/corrections');
  const [fix, setFix] = useState(null);
  const waiting = corr?.filter(c => c.status === 'pending') || [];
  return (
    <Page title={t('My attendance')} hint="Something wrong on a day? Choose Correct beside it."
      actions={<input type="month" value={month} max={todayISO().slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" />}>
      {waiting.length > 0 && <p className="notice">{waiting.length} correction{waiting.length > 1 ? 's are' : ' is'} waiting for your supervisor: {waiting.map(c => fmtDate(c.date)).join(', ')}.</p>}
      {rows?.length ? (
        <ul className="list">
          {rows.map(r => (
            <li key={r.id}>
              <div className="grow"><strong>{fmtDate(r.date)}</strong>
                <small>{r.check_in ? `${fmtTime(r.check_in)} to ${r.check_out ? fmtTime(r.check_out) : '?'}${r.worked_min ? `, ${hours(r.worked_min)} hours` : ''}` : ' '}{r.flag && <span className="warn"> {FLAGS[r.flag]}</span>}</small></div>
              <div className="side"><Chip status={r.status} />{r.late_min > 0 && <span className="time">{r.late_min} min</span>}<button className="quiet" onClick={() => setFix(r.date)}>Correct</button></div>
            </li>))}
        </ul>
      ) : rows && <Empty>Nothing recorded in this month.</Empty>}
      {fix && <CorrectionForm date={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); reloadCorr(); }} />}
    </Page>
  );
}

export function LeaveForm({ employeeId, onDone }) {
  const { t } = usePrefs();
  const [setup] = useLoad('/setup');
  const [f, setF] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { await api('/leave/requests', { method: 'POST', body: { ...f, employee_id: employeeId } }); onDone(); }); };
  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Leave type')}>
        <select value={f.leave_type_id} onChange={e => setF({ ...f, leave_type_id: e.target.value })} required>
          <option value="">Choose…</option>
          {setup?.leave_types.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name}{x.paid ? '' : ' (unpaid)'}</option>)}
        </select>
      </Field>
      <div className="two">
        <Field label="First day off"><input type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} required /></Field>
        <Field label="Last day off"><input type="date" min={f.start_date} value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} required /></Field>
      </div>
      <Field label={t('Reason')}><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      <small>Rest days and public holidays inside these dates are not counted.</small>
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>{employeeId ? 'Record this leave' : 'Send request'}</button>
    </form>
  );
}

export function MyLeave() {
  const { t, fmtDate } = usePrefs();
  const [bal, reloadBal] = useLoad('/leave/balances');
  const [reqs, reloadReqs] = useLoad('/leave/requests');
  const [asking, setAsking] = useState(false);
  const refresh = () => { reloadBal(); reloadReqs(); };
  const cancel = async id => { await api(`/leave/requests/${id}/cancel`, { method: 'POST' }).catch(() => {}); refresh(); };
  const annual = bal?.[0], others = bal?.slice(1).filter(b => b.entitled > 0) || [];
  return (
    <Page title={t('My leave')} actions={<button className="primary" onClick={() => setAsking(true)}>{t('Request leave')}</button>}>
      {annual && <>
        <p className="big-number">{annual.remaining}</p>
        <p className="hint">days of annual leave left, out of {annual.entitled} this year{annual.pending > 0 && `. ${annual.pending} more are waiting for approval`}.</p>
        <div className="meter"><i style={{ width: `${Math.max(0, annual.remaining / (annual.entitled || 1) * 100)}%` }} /></div>
      </>}
      {others.length > 0 && <details className="more"><summary>Other kinds of leave</summary>
        <ul className="list" style={{ marginTop: '1rem' }}>{others.map(b => <li key={b.leave_type_id}><div className="grow"><strong>{b.name}</strong></div><span className="time">{b.remaining} of {b.entitled} days left</span></li>)}</ul></details>}

      <h2>My requests</h2>
      {reqs?.length ? (
        <ul className="list">
          {reqs.map(r => (
            <li key={r.id}>
              <div className="grow"><strong>{r.leave_type}, {r.days} {r.days === 1 ? 'day' : 'days'}</strong><small>{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` to ${fmtDate(r.end_date)}`}{r.decision_note && `. "${r.decision_note}"`}</small></div>
              <div className="side"><Chip status={r.status} />{r.status === 'pending' && <button className="quiet" onClick={() => cancel(r.id)}>Withdraw</button>}</div>
            </li>))}
        </ul>
      ) : reqs && <Empty>You have not asked for any leave yet.</Empty>}
      {asking && <Drawer title={t('Request leave')} subtitle="Your supervisor is told as soon as you send it." onClose={() => setAsking(false)}><LeaveForm onDone={() => { setAsking(false); refresh(); }} /></Drawer>}
    </Page>
  );
}
