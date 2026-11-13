import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Drawer, Tabs, Avatar, Field, ErrorNote, Empty, useAction, minToHHMM, WEEKDAYS } from '../lib.jsx';
import { LeaveForm } from './Mine.jsx';

// Seven rows, one per weekday. Used for the company schedule and for part-time staff.
export const toDays = rows => WEEKDAYS.map((_, weekday) => {
  const r = rows?.find(x => x.weekday === weekday);
  return { weekday, on: !!r, start: minToHHMM(r?.start_min) || '08:45', end: minToHHMM(r?.end_min) || '17:30', break_start: minToHHMM(r?.break_start), break_end: minToHHMM(r?.break_end) };
});
export const fromDays = days => days.filter(d => d.on).map(({ on, ...d }) => d);
export function DaysEditor({ days, onChange }) {
  const set = (i, patch) => onChange(days.map((d, j) => j === i ? { ...d, ...patch } : d));
  // One lunch time for the whole week; each day only says whether it has a lunch break.
  const lunch = days.find(d => d.break_start) || { break_start: '12:30', break_end: '13:30' };
  const setLunch = patch => onChange(days.map(d => d.break_start ? { ...d, ...patch } : d));
  return (<>
    <table className="days">
      <thead><tr><th>Works on</th><th>From</th><th>Until</th><th>Lunch break</th></tr></thead>
      <tbody>{[1, 2, 3, 4, 5, 6, 0].map(i => { const d = days[i]; return (
        <tr key={i} className={d.on ? '' : 'off'}>
          <td><label className="check"><input type="checkbox" checked={d.on} onChange={e => set(i, { on: e.target.checked })} /> {WEEKDAYS[i]}</label></td>
          <td>{d.on && <input type="time" value={d.start} onChange={e => set(i, { start: e.target.value })} aria-label={`${WEEKDAYS[i]} from`} />}</td>
          <td>{d.on && <input type="time" value={d.end} onChange={e => set(i, { end: e.target.value })} aria-label={`${WEEKDAYS[i]} until`} />}</td>
          <td>{d.on && <label className="check"><input type="checkbox" checked={!!d.break_start} aria-label={`${WEEKDAYS[i]} has a lunch break`}
            onChange={e => set(i, e.target.checked ? { break_start: lunch.break_start, break_end: lunch.break_end } : { break_start: '', break_end: '' })} /> {d.break_start ? 'Yes' : 'No'}</label>}</td>
        </tr>); })}</tbody>
    </table>
    <div className="inline">
      <span>Lunch is from</span><input type="time" value={lunch.break_start} onChange={e => setLunch({ break_start: e.target.value })} aria-label="Lunch from" />
      <span>until</span><input type="time" value={lunch.break_end} onChange={e => setLunch({ break_end: e.target.value })} aria-label="Lunch until" />
    </div>
  </>);
}

const ROLES = { employee: 'Employee', supervisor: 'Supervisor', hr: 'HR officer', management: 'Management', admin: 'Administrator' };

// Shown after a password is created, so it cannot be missed.
function PasswordCard({ name, id, password, onDone }) {
  return (
    <div className="form">
      <p>Give this to <strong>{name}</strong>. They log in with employee ID <strong>{id}</strong> and choose their own password the first time.</p>
      <p className="temp">{password}</p>
      <p className="hint">Lost it later? Open the employee and choose Password to set a new one at any time.</p>
      <button className="primary" onClick={onDone}>I have written it down</button>
    </div>
  );
}

function Profile({ emp, setup, user, onSaved }) {
  const [f, setF] = useState({ employee_no: '', full_name: '', email: '', phone: '', role: 'employee', department_id: '', hire_date: '', fingerprint_id: '', password: '', active: true, ...emp });
  const act = useAction();
  const set = k => e => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = e => { e.preventDefault(); act.run(async () => onSaved(await api(emp ? `/employees/${emp.id}` : '/employees', { method: emp ? 'PUT' : 'POST', body: f }), f)); };
  return (
    <form onSubmit={submit} className="form">
      <Field label="Full name"><input value={f.full_name} onChange={set('full_name')} required autoFocus={!emp} /></Field>
      <div className="two">
        <Field label="Employee ID"><input value={f.employee_no} onChange={set('employee_no')} required /><small>They log in with this.</small></Field>
        <Field label="Fingerprint ID"><input value={f.fingerprint_id || ''} onChange={set('fingerprint_id')} /><small>Their number on the reader.</small></Field>
        <Field label="Department"><select value={f.department_id || ''} onChange={set('department_id')}><option value="">None</option>{setup?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Role"><select value={f.role} onChange={set('role')}>{Object.entries(ROLES).filter(([k]) => k !== 'admin' || user.role === 'admin').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Started work on"><input type="date" value={f.hire_date || ''} onChange={set('hire_date')} /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
      </div>
      <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
      {!emp && <Field label="Starting password"><input value={f.password} onChange={set('password')} placeholder="Leave empty to get one made for you" /><small>At least 6 characters. You will see it once more after saving.</small></Field>}
      {emp && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Still works here</label>}
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>{emp ? 'Save changes' : 'Add employee'}</button>
    </form>
  );
}

function WorkingDays({ emp, onSaved }) {
  const [data] = useLoad(`/employees/${emp.id}/schedule`);
  const [own, setOwn] = useState(null);
  const [days, setDays] = useState(null);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  if (data && days === null) { setOwn(data.custom.length > 0); setDays(toDays(data.custom.length ? data.custom : data.standard)); }
  if (!days) return null;
  const save = () => act.run(async () => { await api(`/employees/${emp.id}/schedule`, { method: 'PUT', body: { days: own ? fromDays(days) : [] } }); setSaved(true); onSaved(); });
  const pick = v => { setOwn(v); setSaved(false); };
  return (
    <div className="form">
      <label className="check"><input type="radio" checked={!own} onChange={() => pick(false)} /> Works the company's normal days</label>
      <label className="check"><input type="radio" checked={own} onChange={() => pick(true)} /> Works only some days, like a part-time instructor</label>
      {own && <><DaysEditor days={days} onChange={d => { setDays(d); setSaved(false); }} /><p className="hint">On the other days this person is never marked absent. Annual leave is reduced in proportion.</p></>}
      <ErrorNote>{act.error}</ErrorNote>
      <div className="inline"><button className="primary" onClick={save} disabled={act.busy}>Save working days</button>{saved && <span className="ok">Saved</span>}</div>
    </div>
  );
}

function LeaveAdmin({ emp }) {
  const [bal, reload] = useLoad(`/leave/balances?employee_id=${emp.id}`);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const year = new Date().getFullYear();
  const change = b => {
    const v = window.prompt(`Days of ${b.name.toLowerCase()} leave for ${emp.full_name} in ${year}`, b.entitled);
    if (v !== null) act.run(async () => { await api('/leave/balances', { method: 'PUT', body: { employee_id: emp.id, leave_type_id: b.leave_type_id, year, entitled: v } }); reload(); });
  };
  if (adding) return <><h2 className="sub" style={{ marginTop: 0 }}>Record leave for {emp.full_name}</h2><LeaveForm employeeId={emp.id} onDone={() => { setAdding(false); reload(); }} /><div className="row-end"><button className="quiet" onClick={() => setAdding(false)}>Back</button></div></>;
  return (
    <div className="form">
      <ul className="list">{bal?.map(b => <li key={b.leave_type_id}><div className="grow"><strong>{b.name}</strong><small>{b.used} used{b.pending > 0 && `, ${b.pending} waiting`}</small></div>
        <div className="side"><span className="time">{b.remaining} of {b.entitled} left</span><button className="quiet" onClick={() => change(b)}>Change</button></div></li>)}</ul>
      <ErrorNote>{act.error}</ErrorNote>
      <button onClick={() => setAdding(true)}>Record leave for this employee</button>
    </div>
  );
}

function SetPassword({ emp, onShow }) {
  const [password, setPassword] = useState('');
  const act = useAction();
  const save = e => { e.preventDefault(); act.run(async () => onShow((await api(`/employees/${emp.id}/reset-password`, { method: 'POST', body: { password } })).temp_password)); };
  return (
    <form onSubmit={save} className="form">
      <p className="hint">Use this when {emp.full_name} has forgotten their password or never received one. Their old password stops working at once.</p>
      <Field label="New password"><input value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave empty to get one made for you" /><small>At least 6 characters. They will be asked to choose their own after logging in.</small></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>Set new password</button>
    </form>
  );
}

function EmployeePanel({ emp, setup, user, onClose, onChanged }) {
  const [tab, setTab] = useState('Details');
  const [shown, setShown] = useState(null);     // { name, id, password } after a password is created
  if (shown) return <Drawer title="Password ready" onClose={onClose}><PasswordCard {...shown} onDone={onClose} /></Drawer>;
  if (!emp) return (
    <Drawer title="Add an employee" onClose={onClose}>
      <Profile setup={setup} user={user} onSaved={(r, f) => { onChanged(); setShown({ name: f.full_name, id: f.employee_no, password: r.temp_password }); }} />
    </Drawer>
  );
  return (
    <Drawer title={emp.full_name} subtitle={[ROLES[emp.role], emp.department].filter(Boolean).join(', ')} onClose={onClose}>
      <Tabs tabs={['Details', 'Working days', 'Leave', 'Password']} value={tab} onChange={setTab} />
      {tab === 'Details' && <Profile emp={emp} setup={setup} user={user} onSaved={() => { onChanged(); onClose(); }} />}
      {tab === 'Working days' && <WorkingDays emp={emp} onSaved={onChanged} />}
      {tab === 'Leave' && <LeaveAdmin emp={emp} />}
      {tab === 'Password' && <SetPassword emp={emp} onShow={password => setShown({ name: emp.full_name, id: emp.employee_no, password })} />}
    </Drawer>
  );
}

export default function Employees({ user }) {
  const { t } = usePrefs();
  const [rows, reload] = useLoad('/employees');
  const [setup] = useLoad('/setup');
  const [find, setFind] = useState('');
  const [open, setOpen] = useState(undefined);        // undefined = closed, null = new, object = existing
  const shown = rows?.filter(r => (r.full_name + r.employee_no + (r.department || '')).toLowerCase().includes(find.toLowerCase()));
  return (
    <Page title={t('Employees')} hint={rows ? `${rows.filter(r => r.active).length} people. Choose a person to change their details, working days, leave or password.` : undefined}
      actions={<><input type="search" placeholder="Find a person" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a person" /><button className="primary" onClick={() => setOpen(null)}>Add an employee</button></>}>
      {shown?.length ? (
        <ul className="list">
          {shown.map(r => (
            <li key={r.id} className={'click' + (r.active ? '' : ' muted')} onClick={() => setOpen(r)} onKeyDown={e => e.key === 'Enter' && setOpen(r)} tabIndex={0} role="button">
              <Avatar name={r.full_name} />
              <div className="grow"><strong>{r.full_name}</strong><small>{[r.department, r.role !== 'employee' && ROLES[r.role], r.custom_days > 0 && `${r.custom_days} days a week`, !r.active && 'No longer works here'].filter(Boolean).join(', ') || 'No department'}</small></div>
              <div className="side">{r.active && !r.fingerprint_id && <span className="warn">No fingerprint ID</span>}<span className="chev" aria-hidden="true">›</span></div>
            </li>))}
        </ul>
      ) : rows && <Empty>{find ? 'Nobody matches that search.' : 'No employees yet. Add the first one.'}</Empty>}
      {open !== undefined && <EmployeePanel emp={open} setup={setup} user={user} onClose={() => setOpen(undefined)} onChanged={reload} />}
    </Page>
  );
}
