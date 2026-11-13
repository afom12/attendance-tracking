import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useLoad, usePrefs, Page, Drawer, Tabs, Avatar, Chip, Icon, PasswordInput, Field, ErrorNote, Empty, useAction, minToHHMM, todayISO, WEEKDAYS } from '../lib.jsx';
import { LeaveForm } from './Mine.jsx';

const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// How the probation is going, in words and a tone: 'bad' when overdue, 'warn' when close.
export function probationText(daysLeft, alertDays = 14) {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return { text: `Probation ended ${plural(-daysLeft, 'day')} ago, decision needed`, tone: 'bad' };
  if (daysLeft === 0) return { text: 'Probation ends today', tone: 'bad' };
  return { text: `Probation: ${plural(daysLeft, 'day')} left`, tone: daysLeft <= alertDays ? 'warn' : 'soft' };
}

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

function Profile({ emp, setup, user, rules, onSaved }) {
  const { fmtDate } = usePrefs();
  const [f, setF] = useState({ employee_no: '', full_name: '', email: '', phone: '', role: 'employee', department_id: '', hire_date: todayISO(), fingerprint_id: '', password: '', on_probation: true, track_attendance: true, ...emp });
  const months = +(rules?.probation_months || 2);
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
      {!emp && <Field label="Starting password"><PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" placeholder="Leave empty to get one made for you" /><small>At least 6 characters. You will see it once more after saving.</small></Field>}
      {!emp && <div>
        <label className="check"><input type="checkbox" checked={f.on_probation} onChange={set('on_probation')} /> Starts on probation ({plural(months, 'month')})</label>
        <small>{f.on_probation ? `Probation ends on ${fmtDate(addMonths(f.hire_date || todayISO(), months))}. HR is reminded before then to confirm or end the employment.`
          : 'Untick only for someone who is already permanent, for example moved from another company in the group.'}</small>
      </div>}
      <div>
        <label className="check"><input type="checkbox" checked={f.track_attendance} onChange={set('track_attendance')} /> Attendance and leave are recorded for this person</label>
        <small>{f.track_attendance ? 'They are expected at work on their working days and can ask for leave.'
          : 'Use this for a login that is not a person at work, such as the system administrator account or an owner who does not use the reader. No absences, no leave balance, not counted in reports.'}</small>
      </div>
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
  const { fmtDate } = usePrefs();
  const [bal, reloadBal] = useLoad(`/leave/balances?employee_id=${emp.id}`);
  const [history, reloadHistory] = useLoad(`/leave/requests?employee_id=${emp.id}`);
  const reload = () => { reloadBal(); reloadHistory(); };
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const year = new Date().getFullYear();
  const change = b => {
    const v = window.prompt(`Days of ${b.name.toLowerCase()} leave for ${emp.full_name} in ${year}`, b.entitled);
    if (v !== null) act.run(async () => { await api('/leave/balances', { method: 'PUT', body: { employee_id: emp.id, leave_type_id: b.leave_type_id, year, entitled: v } }); reload(); });
  };
  if (adding) return <><h2 className="sub" style={{ marginTop: 0 }}>Record leave for {emp.full_name}</h2><p className="hint">Leave you record here is approved straight away and taken from their balance. They are told at once.</p><LeaveForm employeeId={emp.id} onDone={() => { setAdding(false); reload(); }} /><div className="row-end"><button className="quiet" onClick={() => setAdding(false)}>Back</button></div></>;
  return (
    <div className="form">
      <ul className="list">{bal?.map(b => <li key={b.leave_type_id}><div className="grow"><strong>{b.name}</strong><small>{b.used} used{b.pending > 0 && `, ${b.pending} waiting`}</small></div>
        <div className="side"><span className="time">{b.remaining} of {b.entitled} left</span><button className="quiet" onClick={() => change(b)}>Change</button></div></li>)}</ul>
      <ErrorNote>{act.error}</ErrorNote>
      {emp.active && <button onClick={() => setAdding(true)}>Record leave for this employee</button>}
      <h2 className="sub">Leave taken and asked for</h2>
      {history?.length ? <ul className="list">{history.map(r => <li key={r.id}>
        <div className="grow"><strong>{r.leave_type}, {plural(r.days, 'day')}</strong>
          <small>{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` to ${fmtDate(r.end_date)}`}{r.decided_by_name && ` · decided by ${r.decided_by_name}`}{r.decision_note && ` · ${r.decision_note}`}</small></div>
        <div className="side"><Chip status={r.status} /></div></li>)}</ul>
        : history && <p className="hint">No leave recorded yet.</p>}
    </div>
  );
}

const EVENTS = { hired: 'Started work', probation: 'Put on probation', confirmed: 'Confirmed as permanent', left: 'Stopped working here', rejoined: 'Came back to work' };

// Probation, permanent, or no longer here; the decisions that change it; and the full history.
function Employment({ emp, rules, onChanged }) {
  const { fmtDate } = usePrefs();
  const [history, reloadHistory] = useLoad(`/employees/${emp.id}/history`);
  const [reasons] = useLoad('/employees/leaving-reasons');
  const [mode, setMode] = useState(null);           // confirm | reject | leave | return
  const [f, setF] = useState({});
  const [result, setResult] = useState(null);
  const act = useAction();
  const t = todayISO(), alertDays = +(rules?.probation_alert_days || 14);
  const start = (m, defaults = {}) => { setMode(m); setF({ date: t, note: '', reason: '', probation: false, ...defaults }); act.setError(''); setResult(null); };
  const send = e => {
    e.preventDefault();
    act.run(async () => {
      const r = mode === 'confirm' || mode === 'reject'
        ? await api(`/employees/${emp.id}/probation`, { method: 'POST', body: { decision: mode, date: f.date, note: f.note } })
        : await api(`/employees/${emp.id}/status`, { method: 'POST', body: { active: mode === 'return', date: f.date, reason: f.reason, note: f.note, probation: f.probation } });
      setResult(r); setMode(null); reloadHistory(); onChanged();
    });
  };
  const onProbation = emp.active && emp.employment_status === 'probation';
  const p = onProbation ? probationText(daysBetween(t, emp.probation_end), alertDays) : null;
  const total = onProbation && emp.hire_date ? Math.max(1, daysBetween(emp.hire_date, emp.probation_end)) : 0;
  const done = total ? Math.min(total, Math.max(0, daysBetween(emp.hire_date, t))) : 0;

  return (
    <div className="form">
      <div className={'status-card' + (emp.active ? '' : ' gone')}>
        {onProbation ? <>
          <p className="label">On probation</p>
          <p className={'big ' + p.tone}>{p.text.replace('Probation: ', '')}</p>
          {total > 0 && <div className="meter" aria-label={`${done} of ${total} days done`}><i style={{ width: `${done / total * 100}%` }} className={p.tone} /></div>}
          <small>Started {fmtDate(emp.hire_date)}. Probation ends {fmtDate(emp.probation_end)}.</small>
        </> : emp.active ? <>
          <p className="label">Permanent employee</p>
          <p className="big">{emp.confirmed_on ? `Since ${fmtDate(emp.confirmed_on)}` : 'Works here'}</p>
          {emp.hire_date && <small>Started {fmtDate(emp.hire_date)}{emp.annual && ` · ${emp.annual.remaining} of ${emp.annual.entitled} annual leave days left`}</small>}
        </> : <>
          <p className="label">No longer works here</p>
          <p className="big">{emp.left_reason || 'Inactive'}</p>
          <small>{emp.left_on ? `Last day ${fmtDate(emp.left_on)}. ` : ''}Their records are kept. They cannot log in, and no absences are counted after their last day.</small>
        </>}
      </div>

      {result && <p className="notice">
        Done.{result.cancelled_leave > 0 && ` ${plural(result.cancelled_leave, 'leave request')} not yet taken ${result.cancelled_leave === 1 ? 'was' : 'were'} cancelled.`}
        {result.supervises?.length > 0 && ` They were supervisor of ${result.supervises.join(', ')}. Choose a new supervisor in Settings > Departments.`}
        {result.probation_end && ` New probation until ${fmtDate(result.probation_end)}.`}
      </p>}

      {!mode && <div className="inline">
        {onProbation && <><button className="primary" onClick={() => start('confirm')}>Confirm as permanent</button>
          <button className="danger" onClick={() => start('reject')}>Do not confirm</button></>}
        {emp.active && !onProbation && <button className="danger" onClick={() => start('leave')}>No longer works here</button>}
        {emp.active && !onProbation && !emp.confirmed_on && emp.hire_date &&
          <button className="quiet" disabled={act.busy} onClick={() => act.run(async () => { setResult(await api(`/employees/${emp.id}/probation`, { method: 'POST', body: { decision: 'start' } })); reloadHistory(); onChanged(); })}>Still on probation</button>}
        {emp.active && onProbation && <button className="quiet" onClick={() => start('leave')}>Left before the end of probation</button>}
        {!emp.active && <button className="primary" onClick={() => start('return', { probation: false })}>Coming back to work</button>}
      </div>}

      {mode && <form onSubmit={send} className="form decision">
        <h2 className="sub" style={{ margin: 0 }}>{{ confirm: `Confirm ${emp.full_name} as permanent`, reject: 'End the employment after probation',
          leave: `${emp.full_name} no longer works here`, return: `${emp.full_name} is coming back` }[mode]}</h2>
        <p className="hint">{{
          confirm: 'They become permanent staff and are told at once.',
          reject: 'They stop working here from this date and can no longer log in. Their attendance and leave records are kept.',
          leave: 'They can no longer log in and are no longer counted as absent. Leave not yet taken is cancelled. All records are kept.',
          return: 'They can log in again with their old password and are counted from this date.' }[mode]}</p>
        <div className="two">
          <Field label={mode === 'return' ? 'Back from' : mode === 'confirm' ? 'Confirmed on' : 'Last working day'}>
            <input type="date" value={f.date} max={mode === 'return' ? undefined : t} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
          {mode === 'leave' && <Field label="Why"><select value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} required>
            <option value="">Choose</option>{reasons?.filter(r => r !== 'Probation not confirmed').map(r => <option key={r}>{r}</option>)}</select></Field>}
        </div>
        <Field label={mode === 'reject' ? 'Reason (kept in their record)' : 'Note'}>
          <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} required={mode === 'reject' || f.reason === 'Other'}
            placeholder={mode === 'confirm' ? 'Optional, for example the supervisor’s assessment' : 'Optional'} /></Field>
        {mode === 'return' && emp.employment_status !== 'not_confirmed' &&
          <label className="check"><input type="checkbox" checked={f.probation} onChange={e => setF({ ...f, probation: e.target.checked })} /> Start a new probation period</label>}
        {mode === 'return' && emp.employment_status === 'not_confirmed' && <p className="hint">Their earlier probation was not confirmed, so a new probation starts.</p>}
        <ErrorNote>{act.error}</ErrorNote>
        <div className="inline"><button className={mode === 'reject' || mode === 'leave' ? 'primary danger-fill' : 'primary'} disabled={act.busy}>
          {{ confirm: 'Confirm as permanent', reject: 'End employment', leave: 'Mark as no longer working here', return: 'Bring back' }[mode]}</button>
          <button type="button" className="quiet" onClick={() => setMode(null)}>Back</button></div>
      </form>}

      <h2 className="sub">History</h2>
      {history?.length ? <ol className="timeline">{history.map(h => <li key={h.id} className={'ev-' + h.event}>
        <strong>{EVENTS[h.event] || h.event}</strong> <span className="time">{fmtDate(h.effective_date)}</span>
        {(h.note || h.by_name) && <small>{[h.note, h.by_name && `by ${h.by_name}`].filter(Boolean).join(' · ')}</small>}
      </li>)}</ol> : history && <p className="hint">Nothing recorded yet.</p>}
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
      <Field label="New password"><PasswordInput value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="Leave empty to get one made for you" /><small>At least 6 characters. They will be asked to choose their own after logging in.</small></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>Set new password</button>
    </form>
  );
}

function EmployeePanel({ emp, setup, user, rules, onClose, onChanged }) {
  const [tab, setTab] = useState(emp && (emp.employment_status === 'probation' || !emp.active) ? 'Employment' : 'Details');
  const [shown, setShown] = useState(null);     // { name, id, password } after a password is created
  if (shown) return <Drawer title="Password ready" onClose={onClose}><PasswordCard {...shown} onDone={onClose} /></Drawer>;
  if (!emp) return (
    <Drawer title="Add an employee" onClose={onClose}>
      <Profile setup={setup} user={user} rules={rules} onSaved={(r, f) => { onChanged(); setShown({ name: f.full_name, id: f.employee_no, password: r.temp_password }); }} />
    </Drawer>
  );
  const self = emp.id === user.id;
  return (
    <Drawer avatar={emp.full_name} title={emp.full_name} subtitle={[ROLES[emp.role], emp.department, !emp.active && 'No longer works here'].filter(Boolean).join(', ')} onClose={onClose}>
      <Tabs tabs={['Details', ...(self ? [] : ['Employment']), ...(emp.track_attendance ? ['Working days', 'Leave'] : []), 'Password']} value={tab} onChange={setTab} />
      {tab === 'Details' && <Profile emp={emp} setup={setup} user={user} onSaved={() => { onChanged(); onClose(); }} />}
      {tab === 'Employment' && <Employment emp={emp} rules={rules} onChanged={onChanged} />}
      {tab === 'Working days' && <WorkingDays emp={emp} onSaved={onChanged} />}
      {tab === 'Leave' && <LeaveAdmin emp={emp} />}
      {tab === 'Password' && <SetPassword emp={emp} onShow={password => setShown({ name: emp.full_name, id: emp.employee_no, password })} />}
    </Drawer>
  );
}

// The groups HR switches between. "Needs attention" collects what the system detected for them.
const GROUPS = {
  active: { label: 'Working here', test: r => r.active },
  probation: { label: 'On probation', test: r => r.active && r.employment_status === 'probation' },
  attention: { label: 'Needs attention', test: (r, k) => r.active && ((r.probation_days_left != null && r.probation_days_left <= k.alert) || r.absent_streak >= k.absent || (!r.fingerprint_id && r.track_attendance)) },
  inactive: { label: 'No longer here', test: r => !r.active },
  all: { label: 'Everyone', test: () => true },
};

export default function Employees({ user }) {
  const { t, fmtDate } = usePrefs();
  const [rows, reload] = useLoad('/employees');
  const [setup] = useLoad('/setup');
  const [rules] = useLoad('/settings');
  const [params, setParams] = useSearchParams();
  const [find, setFind] = useState('');
  const [group, setGroup] = useState('active');
  const [openId, setOpenId] = useState(undefined);    // undefined = closed, null = new, number = existing
  // A notification can open a person directly: /employees?open=12
  useEffect(() => { const id = +params.get('open'); if (id) { setOpenId(id); setParams({}, { replace: true }); } }, [params]);
  const k = { alert: +(rules?.probation_alert_days ?? 14), absent: +(rules?.absence_alert_days || 0) || Infinity };
  const open = openId ? rows?.find(r => r.id === openId) : openId;   // always the freshest copy after a change
  const counts = Object.fromEntries(Object.entries(GROUPS).map(([key, g]) => [key, rows?.filter(r => g.test(r, k)).length || 0]));
  const shown = rows?.filter(r => GROUPS[group].test(r, k) && (r.full_name + r.employee_no + (r.department || '')).toLowerCase().includes(find.toLowerCase()));
  return (
    <Page wide title={t('Employees')} hint={rows ? `${counts.active} ${counts.active === 1 ? 'person' : 'people'} working here, ${counts.probation} on probation. Choose a person to change their details, employment, working days, leave or password.` : undefined}
      actions={<><button className="primary" onClick={() => setOpenId(null)}><Icon name="plus" />Add an employee</button></>}>
      <div className="filters" role="tablist">
        {Object.entries(GROUPS).map(([key, g]) => <button key={key} role="tab" aria-selected={group === key} className={(group === key ? 'on' : '') + (key === 'attention' && counts.attention ? ' alert' : '')}
          onClick={() => setGroup(key)}>{g.label} <span className="n">{counts[key]}</span></button>)}
        <input type="search" className="push" placeholder="Find a person" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a person" />
      </div>
      {shown?.length ? (
        <ul className="list">
          {shown.map(r => {
            const p = r.active && probationText(r.probation_days_left, k.alert);
            return (
              <li key={r.id} className={'click' + (r.active ? '' : ' muted')} onClick={() => setOpenId(r.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(r.id)} tabIndex={0} role="button">
                <Avatar name={r.full_name} />
                <div className="grow"><strong>{r.full_name}</strong>
                  <small>{[r.department, r.role !== 'employee' && ROLES[r.role], r.custom_days > 0 && `${r.custom_days} days a week`].filter(Boolean).join(', ') || 'No department'}
                    {!r.active && ` · Left ${r.left_on ? fmtDate(r.left_on) : ''}${r.left_reason ? `, ${r.left_reason.toLowerCase()}` : ''}`}</small>
                  {(p || !r.track_attendance || (r.active && (r.absent_streak >= k.absent || !r.fingerprint_id))) && <span className="tags">
                    {p && <span className={'tag ' + p.tone}>{p.text}</span>}
                    {r.active && r.absent_streak >= k.absent && <span className="tag bad">Absent {r.absent_streak} days in a row</span>}
                    {r.active && r.track_attendance && !r.fingerprint_id && <span className="tag warn">No fingerprint ID</span>}
                    {!r.track_attendance && <span className="tag">System account, attendance not recorded</span>}
                  </span>}</div>
                <div className="side">
                  {r.annual && <span className="time" title={`${r.leave_taken} days of leave taken this year (all types)`}>{r.annual.remaining} of {r.annual.entitled} leave days left</span>}
                  <span className="chev" aria-hidden="true">›</span>
                </div>
              </li>);
          })}
        </ul>
      ) : rows && <Empty>{find ? 'Nobody matches that search.' : rows.length ? `Nobody in “${GROUPS[group].label}”.` : 'No employees yet. Add the first one.'}</Empty>}
      {openId !== undefined && (open || openId === null) && <EmployeePanel key={openId ?? 'new'} emp={open} setup={setup} user={user} rules={rules} onClose={() => setOpenId(undefined)} onChanged={reload} />}
    </Page>
  );
}
