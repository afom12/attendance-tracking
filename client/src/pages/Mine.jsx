import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Chip, Modal, Field, ErrorNote, Empty, useAction, hours, todayISO } from '../lib.jsx';

const FLAGS = { missing_out: 'No check-out recorded', unscheduled: 'Not a scheduled day', field: 'Outside the office' };

function CorrectionForm({ date, onClose, onDone }) {
  const [f, setF] = useState({ date, requested_in: '', requested_out: '', reason: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { await api('/corrections', { method: 'POST', body: f }); onDone(); }); };
  return (
    <Modal title="Request a correction" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="hint">Fill in only the time that is wrong or missing. Your supervisor decides.</p>
        <Field label="Date"><input type="date" max={todayISO()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
        <div className="two">
          <Field label="Correct check-in"><input type="time" value={f.requested_in} onChange={e => setF({ ...f, requested_in: e.target.value })} /></Field>
          <Field label="Correct check-out"><input type="time" value={f.requested_out} onChange={e => setF({ ...f, requested_out: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} required /></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end"><button className="primary" disabled={act.busy}>Send request</button></div>
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
  return (
    <Page title={t('My attendance')}
      actions={<><input type="month" value={month} max={todayISO().slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" />
        <button onClick={() => setFix(todayISO())}>{t('Request correction')}</button></>}>
      {rows?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Date')}</th><th>{t('Status')}</th><th>{t('Check-in')}</th><th>{t('Check-out')}</th><th className="num">{t('Hours worked')}</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{fmtDate(r.date)}</td>
              <td><Chip status={r.status} />{r.late_min > 0 && <small> {r.late_min} min</small>}{r.flag && <small className="warn"> {FLAGS[r.flag]}</small>}</td>
              <td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td>
              <td className="num">{r.worked_min ? hours(r.worked_min) : ''}</td>
              <td className="num"><button className="link" onClick={() => setFix(r.date)}>Correct</button></td>
            </tr>))}</tbody>
        </table></div>
      ) : rows && <Empty>No records for this month.</Empty>}

      {corr?.length > 0 && <>
        <h2>My correction requests</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Date')}</th><th>Requested</th><th>{t('Reason')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>{corr.map(c => <tr key={c.id}><td>{fmtDate(c.date)}</td><td>{[c.requested_in && 'in ' + c.requested_in, c.requested_out && 'out ' + c.requested_out].filter(Boolean).join(', ')}</td><td>{c.reason}</td><td><Chip status={c.status} /></td></tr>)}</tbody>
        </table></div>
      </>}
      {fix && <CorrectionForm date={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); reloadCorr(); }} />}
    </Page>
  );
}

export function LeaveForm({ employeeId, onDone }) {
  const { t } = usePrefs();
  const [setup] = useLoad('/setup');
  const [f, setF] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const act = useAction();
  const submit = e => {
    e.preventDefault();
    act.run(async () => { await api('/leave/requests', { method: 'POST', body: { ...f, employee_id: employeeId } }); setF({ leave_type_id: '', start_date: '', end_date: '', reason: '' }); onDone(); });
  };
  return (
    <form onSubmit={submit} className="form card">
      <div className="two">
        <Field label={t('Leave type')}>
          <select value={f.leave_type_id} onChange={e => setF({ ...f, leave_type_id: e.target.value })} required>
            <option value="">Choose…</option>
            {setup?.leave_types.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name}{x.paid ? '' : ' (unpaid)'}</option>)}
          </select>
        </Field>
        <Field label={t('Reason')}><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label={t('From')}><input type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} required /></Field>
        <Field label={t('To')}><input type="date" min={f.start_date} value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} required /></Field>
      </div>
      <ErrorNote>{act.error}</ErrorNote>
      <div className="row-end"><button className="primary" disabled={act.busy}>{t('Request leave')}</button></div>
    </form>
  );
}

export function MyLeave() {
  const { t, fmtDate } = usePrefs();
  const [bal, reloadBal] = useLoad('/leave/balances');
  const [reqs, reloadReqs] = useLoad('/leave/requests');
  const refresh = () => { reloadBal(); reloadReqs(); };
  const cancel = async id => { await api(`/leave/requests/${id}/cancel`, { method: 'POST' }).catch(() => {}); refresh(); };
  return (
    <Page title={t('My leave')} hint="Weekly rest days and public holidays inside your dates are not counted.">
      <div className="stats">
        {bal?.filter(b => b.entitled > 0).map(b => <div key={b.leave_type_id}><strong>{b.remaining}</strong><span>{b.name} · {t('Remaining').toLowerCase()} / {b.entitled}</span></div>)}
      </div>
      <h2>{t('Request leave')}</h2>
      <LeaveForm onDone={refresh} />
      <h2>My requests</h2>
      {reqs?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Leave type')}</th><th>{t('From')}</th><th>{t('To')}</th><th className="num">{t('Days')}</th><th>{t('Status')}</th><th></th></tr></thead>
          <tbody>{reqs.map(r => (
            <tr key={r.id}><td>{r.leave_type}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td><td className="num">{r.days}</td>
              <td><Chip status={r.status} />{r.decision_note && <small> {r.decision_note}</small>}</td>
              <td className="num">{r.status === 'pending' && <button className="link" onClick={() => cancel(r.id)}>{t('Cancel')}</button>}</td></tr>))}</tbody>
        </table></div>
      ) : reqs && <Empty>You have not requested any leave yet.</Empty>}
    </Page>
  );
}
