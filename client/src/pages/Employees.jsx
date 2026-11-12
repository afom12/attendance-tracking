import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Modal, Field, ErrorNote, Empty, useAction, minToHHMM, WEEKDAYS } from '../lib.jsx';
import { LeaveForm } from './Mine.jsx';

// Seven rows, one per weekday. Used for the company schedule and for part-time staff.
export const toDays = rows => WEEKDAYS.map((_, weekday) => {
  const r = rows?.find(x => x.weekday === weekday);
  return { weekday, on: !!r, start: minToHHMM(r?.start_min) || '08:45', end: minToHHMM(r?.end_min) || '17:30', break_start: minToHHMM(r?.break_start), break_end: minToHHMM(r?.break_end) };
});
export const fromDays = days => days.filter(d => d.on).map(({ on, ...d }) => d);
export function DaysEditor({ days, onChange }) {
  const set = (i, patch) => onChange(days.map((d, j) => j === i ? { ...d, ...patch } : d));
  return (
    <table className="days">
      <thead><tr><th>Works</th><th>Start</th><th>End</th><th>Break from</th><th>Break to</th></tr></thead>
      <tbody>{[1, 2, 3, 4, 5, 6, 0].map(i => { const d = days[i]; return (
        <tr key={i} className={d.on ? '' : 'off'}>
          <td><label className="check"><input type="checkbox" checked={d.on} onChange={e => set(i, { on: e.target.checked })} /> {WEEKDAYS[i]}</label></td>
          {['start', 'end', 'break_start', 'break_end'].map(k => <td key={k}><input type="time" value={d[k]} disabled={!d.on} onChange={e => set(i, { [k]: e.target.value })} aria-label={`${WEEKDAYS[i]} ${k}`} /></td>)}
        </tr>); })}</tbody>
    </table>
  );
}

function EmployeeForm({ emp, setup, user, onClose, onDone }) {
  const [f, setF] = useState({ employee_no: '', full_name: '', email: '', phone: '', role: 'employee', department_id: '', hire_date: '', fingerprint_id: '', active: true, ...emp });
  const [temp, setTemp] = useState('');
  const act = useAction();
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = e => {
    e.preventDefault();
    act.run(async () => {
      const r = await api(emp ? `/employees/${emp.id}` : '/employees', { method: emp ? 'PUT' : 'POST', body: f });
      if (r.temp_password) setTemp(r.temp_password); else onDone();
    });
  };
  const reset = () => act.run(async () => setTemp((await api(`/employees/${emp.id}/reset-password`, { method: 'POST' })).temp_password));
  if (temp) return (
    <Modal title="Temporary password" onClose={onDone}>
      <p>Give this password to <strong>{f.full_name}</strong>. They log in with employee ID <strong>{f.employee_no}</strong> and must choose their own password the first time.</p>
      <p className="temp">{temp}</p>
      <p className="hint">It is shown only once.</p>
      <div className="row-end"><button className="primary" onClick={onDone}>Done</button></div>
    </Modal>
  );
  return (
    <Modal title={emp ? `Edit ${emp.full_name}` : 'Add an employee'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="two">
          <Field label="Employee ID"><input value={f.employee_no} onChange={set('employee_no')} required /></Field>
          <Field label="Full name"><input value={f.full_name} onChange={set('full_name')} required /></Field>
          <Field label="Department"><select value={f.department_id || ''} onChange={set('department_id')}><option value="">None</option>{setup?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Role"><select value={f.role} onChange={set('role')}>
            <option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="hr">HR officer</option>
            <option value="management">Management (view only)</option>{user.role === 'admin' && <option value="admin">Administrator</option>}</select></Field>
          <Field label="Fingerprint ID on the device"><input value={f.fingerprint_id || ''} onChange={set('fingerprint_id')} /></Field>
          <Field label="Hire date"><input type="date" value={f.hire_date || ''} onChange={set('hire_date')} /></Field>
          <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
          <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        </div>
        {emp && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active (untick when the employee leaves; records are kept)</label>}
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end">{emp && <button type="button" onClick={reset} disabled={act.busy}>Reset password</button>}<button className="primary" disabled={act.busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function ScheduleForm({ emp, onClose, onDone }) {
  const [data] = useLoad(`/employees/${emp.id}/schedule`);
  const [own, setOwn] = useState(null);
  const [days, setDays] = useState(null);
  const act = useAction();
  if (data && days === null) { setOwn(data.custom.length > 0); setDays(toDays(data.custom.length ? data.custom : data.standard)); }
  if (!days) return null;
  const save = () => act.run(async () => { await api(`/employees/${emp.id}/schedule`, { method: 'PUT', body: { days: own ? fromDays(days) : [] } }); onDone(); });
  return (
    <Modal title={`Working days: ${emp.full_name}`} onClose={onClose}>
      <div className="form">
        <label className="check"><input type="radio" checked={!own} onChange={() => setOwn(false)} /> Company standard schedule</label>
        <label className="check"><input type="radio" checked={own} onChange={() => setOwn(true)} /> Own days (part-time, for example an instructor working 3 days a week)</label>
        {own && <><DaysEditor days={days} onChange={setDays} /><p className="hint">Days left unticked are never counted as absent. Annual leave is reduced in proportion.</p></>}
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end"><button className="primary" onClick={save} disabled={act.busy}>Save</button></div>
      </div>
    </Modal>
  );
}

function LeaveAdmin({ emp, onClose }) {
  const [bal, reload] = useLoad(`/leave/balances?employee_id=${emp.id}`);
  const act = useAction();
  const year = new Date().getFullYear();
  const change = b => {
    const v = window.prompt(`Entitled ${b.name} days for ${emp.full_name} in ${year}`, b.entitled);
    if (v === null) return;
    act.run(async () => { await api('/leave/balances', { method: 'PUT', body: { employee_id: emp.id, leave_type_id: b.leave_type_id, year, entitled: v } }); reload(); });
  };
  return (
    <Modal title={`Leave: ${emp.full_name}`} onClose={onClose}>
      <table><thead><tr><th>Type</th><th className="num">Entitled</th><th className="num">Used</th><th className="num">Pending</th><th className="num">Remaining</th><th></th></tr></thead>
        <tbody>{bal?.map(b => <tr key={b.leave_type_id}><td>{b.name}</td><td className="num">{b.entitled}</td><td className="num">{b.used}</td><td className="num">{b.pending}</td><td className="num">{b.remaining}</td>
          <td className="num"><button className="link" onClick={() => change(b)}>Change</button></td></tr>)}</tbody></table>
      <ErrorNote>{act.error}</ErrorNote>
      <h2>Record leave for this employee</h2>
      <LeaveForm employeeId={emp.id} onDone={reload} />
    </Modal>
  );
}

export default function Employees({ user }) {
  const { t } = usePrefs();
  const [rows, reload] = useLoad('/employees');
  const [setup] = useLoad('/setup');
  const [find, setFind] = useState('');
  const [dialog, setDialog] = useState(null);
  const close = () => { setDialog(null); reload(); };
  const shown = rows?.filter(r => (r.full_name + r.employee_no + (r.department || '')).toLowerCase().includes(find.toLowerCase()));
  return (
    <Page title={t('Employees')}
      actions={<><input type="search" placeholder="Search name, ID, department" value={find} onChange={e => setFind(e.target.value)} aria-label="Search" /><button className="primary" onClick={() => setDialog({ kind: 'edit' })}>Add an employee</button></>}>
      {shown?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>ID</th><th>{t('Name')}</th><th>{t('Department')}</th><th>Role</th><th>Fingerprint</th><th>Schedule</th><th></th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id} className={r.active ? '' : 'inactive'}>
              <td>{r.employee_no}</td><td>{r.full_name}{!r.active && <small> inactive</small>}</td><td>{r.department}</td><td>{r.role}</td>
              <td>{r.fingerprint_id || <span className="warn">not linked</span>}</td>
              <td><button className="link" onClick={() => setDialog({ kind: 'schedule', emp: r })}>{r.custom_days ? `Own days (${r.custom_days} a week)` : 'Standard'}</button></td>
              <td className="num"><button className="link" onClick={() => setDialog({ kind: 'leave', emp: r })}>Leave</button> <button className="link" onClick={() => setDialog({ kind: 'edit', emp: r })}>Edit</button></td>
            </tr>))}</tbody>
        </table></div>
      ) : rows && <Empty>No employees found.</Empty>}
      {dialog?.kind === 'edit' && <EmployeeForm emp={dialog.emp} setup={setup} user={user} onClose={() => setDialog(null)} onDone={close} />}
      {dialog?.kind === 'schedule' && <ScheduleForm emp={dialog.emp} onClose={() => setDialog(null)} onDone={close} />}
      {dialog?.kind === 'leave' && <LeaveAdmin emp={dialog.emp} onClose={() => setDialog(null)} />}
    </Page>
  );
}
