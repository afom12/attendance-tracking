import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Drawer, Field, ErrorNote, Empty, useAction, todayISO } from '../lib.jsx';
import { DaysEditor, toDays, fromDays } from './Employees.jsx';

const RULES = [
  ['grace_min', 'Grace period (minutes after start before a check-in is late)'],
  ['half_day_min', 'Late by this many minutes or more counts as a half day'],
  ['early_tolerance_min', 'Leaving this many minutes early is still on time'],
  ['overtime_min', 'Minimum minutes after end of day that count as overtime'],
  ['dedupe_min', 'Ignore repeat punches within this many minutes'],
  ['correction_window_days', 'Working days an employee has to request a correction'],
  ['probation_months', 'Months a new employee is on probation'],
  ['probation_alert_days', 'Remind HR this many days before a probation ends'],
  ['absence_alert_days', 'Alert HR and the supervisor after this many working days absent in a row (0 = never)'],
  ['approval_reminder_days', 'Chase a request that has waited this many days for a decision (0 = never)'],
  ['carry_over_max_days', 'Unused annual leave days that move into the next year (0 = none)'],
];

function Rules() {
  const [s, reload] = useLoad('/settings');
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  if (s && !f) setF(s);
  if (!f) return null;
  const save = e => { e.preventDefault(); act.run(async () => { await api('/settings', { method: 'PUT', body: f }); reload(); setSaved(true); }); };
  return (
    <form onSubmit={save} className="form narrow">
      {RULES.map(([k, label]) => <Field key={k} label={label}><input type="number" min="0" value={f[k]} onChange={e => { setSaved(false); setF({ ...f, [k]: e.target.value }); }} required /></Field>)}
      <label className="check"><input type="checkbox" checked={f.annual_extra_day_every_2_years === 'true'} onChange={e => { setSaved(false); setF({ ...f, annual_extra_day_every_2_years: String(e.target.checked) }); }} /> Add 1 annual leave day for every 2 further years of service</label>
      <label className="check"><input type="checkbox" checked={f.annual_leave_during_probation === 'true'} onChange={e => { setSaved(false); setF({ ...f, annual_leave_during_probation: String(e.target.checked) }); }} /> People on probation may ask for annual leave</label>
      <label className="check"><input type="checkbox" checked={f.annual_prorate_first_year === 'true'} onChange={e => { setSaved(false); setF({ ...f, annual_prorate_first_year: String(e.target.checked) }); }} /> In the year someone starts, give annual leave only for the months worked</label>
      <ErrorNote>{act.error}</ErrorNote>
      <div className="row-end">{saved && <span className="ok">Saved</span>}<button className="primary" disabled={act.busy}>Save</button></div>
    </form>
  );
}

function Schedule({ setup }) {
  const shift = setup.shifts[0];
  const [days, setDays] = useState(toDays(setup.shift_days.filter(d => d.shift_id === shift.id)));
  const [saved, setSaved] = useState(false);
  const [range, setRange] = useState({ from: todayISO().slice(0, 8) + '01', to: todayISO() });
  const act = useAction(), redo = useAction();
  const save = () => act.run(async () => { await api(`/shifts/${shift.id}/days`, { method: 'PUT', body: { days: fromDays(days) } }); setSaved(true); });
  const [redone, setRedone] = useState(false);
  return (
    <div className="form">
      <p className="hint">The company's standard working days. Part-time staff get their own days on the Employees screen.</p>
      <DaysEditor days={days} onChange={d => { setSaved(false); setDays(d); }} />
      <ErrorNote>{act.error}</ErrorNote>
      <div className="row-end">{saved && <span className="ok">Saved</span>}<button className="primary" onClick={save} disabled={act.busy}>Save</button></div>
      <h2>Recalculate attendance</h2>
      <p className="hint">Use after changing rules, schedules or holidays for days already past. Records fixed by HR are not touched.</p>
      <div className="inline">
        <input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} aria-label="From" />
        <input type="date" value={range.to} max={todayISO()} onChange={e => setRange({ ...range, to: e.target.value })} aria-label="To" />
        <button disabled={redo.busy} onClick={async () => setRedone(await redo.run(() => api('/attendance/reprocess', { method: 'POST', body: range })))}>{redo.busy ? 'Working…' : 'Recalculate'}</button>
        {redone && <span className="ok">Done</span>}
      </div>
      <ErrorNote>{redo.error}</ErrorNote>
    </div>
  );
}

// One office per row; choosing it opens the details. The location decides whether a phone check-in is "in the office".
function OfficeForm({ office, onDone }) {
  const [f, setF] = useState({ name: '', address: '', latitude: '', longitude: '', radius_m: 100, ...office });
  const act = useAction(), locate = useAction();
  const [accuracy, setAccuracy] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const here = () => locate.run(async () => {
    if (!navigator.geolocation) throw new Error('This browser cannot read the location. Type the numbers instead.');
    const p = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, () => no(new Error('The location could not be read. Allow location access, or type the numbers instead.')), { enableHighAccuracy: true, timeout: 15000 }));
    setF(x => ({ ...x, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }));
    setAccuracy(Math.round(p.coords.accuracy));
  });
  const save = e => { e.preventDefault(); act.run(async () => { await api('/branches', { method: 'POST', body: f }); onDone(); }); };
  const hasPlace = f.latitude !== '' && f.latitude != null && f.longitude !== '' && f.longitude != null;
  return (
    <form onSubmit={save} className="form">
      <Field label="Office name"><input value={f.name} onChange={set('name')} required autoFocus={!office} /></Field>
      <Field label="Address"><input value={f.address || ''} onChange={set('address')} placeholder="For example Bole, Addis Ababa" /></Field>
      <h2 className="sub">Where the office is</h2>
      <p className="hint">Phone check-ins inside this area are accepted at once. Outside it, the employee must say where they are and HR reviews it.</p>
      <div className="inline"><button type="button" onClick={here} disabled={locate.busy}>{locate.busy ? 'Reading location…' : 'Use my current location'}</button>
        {accuracy != null && <small>Accurate to about {accuracy} metres{accuracy > 100 ? '. Try again near a window or outside' : ''}.</small>}</div>
      <ErrorNote>{locate.error}</ErrorNote>
      <div className="two">
        <Field label="Latitude"><input inputMode="decimal" value={f.latitude ?? ''} onChange={set('latitude')} placeholder="9.010000" /></Field>
        <Field label="Longitude"><input inputMode="decimal" value={f.longitude ?? ''} onChange={set('longitude')} placeholder="38.760000" /></Field>
      </div>
      <Field label="Office area, in metres around that point"><input type="number" min="20" max="5000" value={f.radius_m} onChange={set('radius_m')} required /><small>100 metres suits most buildings.</small></Field>
      {hasPlace && <a href={`https://www.openstreetmap.org/?mlat=${f.latitude}&mlon=${f.longitude}#map=18/${f.latitude}/${f.longitude}`} target="_blank" rel="noreferrer">Check this point on a map</a>}
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>{office ? 'Save changes' : 'Add office'}</button>
    </form>
  );
}

function Offices({ setup, reload }) {
  const [open, setOpen] = useState(undefined);       // undefined = closed, null = new, object = existing
  const done = () => { setOpen(undefined); reload(); };
  return (<>
    <div className="actions" style={{ marginBottom: '1.5rem' }}><button className="primary" onClick={() => setOpen(null)}>Add an office</button></div>
    <ul className="list">{setup.branches.map(b => (
      <li key={b.id} className="click" onClick={() => setOpen(b)} onKeyDown={e => e.key === 'Enter' && setOpen(b)} tabIndex={0} role="button">
        <div className="grow"><strong>{b.name}</strong><small>{[b.address, `${b.departments} ${b.departments === 1 ? 'department' : 'departments'}`].filter(Boolean).join(', ')}</small></div>
        <div className="side">{b.latitude == null ? <span className="warn">Location not set</span> : <span className="time">{b.radius_m} m area</span>}<span className="chev" aria-hidden="true">›</span></div>
      </li>))}</ul>
    {open !== undefined && <Drawer title={open ? open.name : 'Add an office'} onClose={() => setOpen(undefined)}><OfficeForm office={open} onDone={done} /></Drawer>}
  </>);
}

function Departments({ setup, reload }) {
  const [employees] = useLoad('/employees');
  const [name, setName] = useState('');
  const [office, setOffice] = useState('');
  const act = useAction();
  const many = setup.branches.length > 1;          // the office choice only appears once there is more than one
  const save = body => act.run(async () => { await api('/departments', { method: 'POST', body }); setName(''); reload(); });
  return (
    <div className="form">
      <p className="hint">The supervisor of a department sees its attendance and approves its leave. Without a supervisor, requests go to HR.</p>
      <table><thead><tr><th>Department</th>{many && <th>Office</th>}<th>Supervisor</th></tr></thead>
        <tbody>{setup.departments.map(d => <tr key={d.id}><td>{d.name}</td>
          {many && <td><select value={d.branch_id || ''} onChange={e => save({ ...d, branch_id: e.target.value || null })} aria-label={`Office of ${d.name}`}>
            <option value="">None</option>{setup.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>}
          <td><select value={d.supervisor_id || ''} onChange={e => save({ ...d, supervisor_id: e.target.value || null })} aria-label={`Supervisor of ${d.name}`}>
            <option value="">None (HR approves)</option>{employees?.filter(e => e.active && e.role !== 'employee').map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></td></tr>)}</tbody></table>
      <form className="inline" onSubmit={e => { e.preventDefault(); save({ name, branch_id: (many ? office : '') || setup.branches[0]?.id }); }}>
        <input placeholder="New department name" value={name} onChange={e => setName(e.target.value)} required />
        {many && <select value={office} onChange={e => setOffice(e.target.value)} aria-label="Office of the new department" required>
          <option value="">Office…</option>{setup.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <button className="primary" disabled={act.busy}>Add department</button>
      </form>
      <ErrorNote>{act.error}</ErrorNote>
    </div>
  );
}

function Holidays({ setup, reload }) {
  const { fmtDate } = usePrefs();
  const [f, setF] = useState({ date: '', name: '' });
  const act = useAction();
  const add = e => { e.preventDefault(); act.run(async () => { await api('/holidays', { method: 'POST', body: f }); setF({ date: '', name: '' }); reload(); }); };
  const year = todayISO().slice(0, 4);
  const list = setup.holidays.filter(h => h.date >= year);
  return (
    <div className="form narrow">
      <p className="hint">Public holidays and company days off. Nobody is marked absent on these days. Enter each year's dates, because several Ethiopian holidays move.</p>
      {list.length ? <table><tbody>{list.map(h => <tr key={h.id}><td>{fmtDate(h.date)}</td><td>{h.name}</td>
        <td className="num"><button className="link" onClick={async () => { await api(`/holidays/${h.id}`, { method: 'DELETE' }); reload(); }}>Remove</button></td></tr>)}</tbody></table> : <Empty>No holidays entered yet.</Empty>}
      <form className="inline" onSubmit={add}>
        <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required aria-label="Date" />
        <input placeholder="Holiday name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /><button className="primary" disabled={act.busy}>Add</button>
      </form>
      <ErrorNote>{act.error}</ErrorNote>
    </div>
  );
}

function LeaveTypes({ setup, reload }) {
  const blank = { name: '', days_per_year: '', paid: true, calendar_days: false, active: true };
  const [f, setF] = useState(blank);
  const act = useAction();
  const save = e => { e.preventDefault(); act.run(async () => { await api('/leave-types', { method: 'POST', body: f }); setF(blank); reload(); }); };
  return (
    <div className="form">
      <p className="hint">Annual leave is 16 working days as confirmed. The other values are starting points: check each against company policy. A change applies to balances created afterwards.</p>
      <table><thead><tr><th>Type</th><th className="num">Days per year</th><th>Paid</th><th>Counts</th><th>In use</th><th></th></tr></thead>
        <tbody>{setup.leave_types.map(x => <tr key={x.id} className={x.active ? '' : 'inactive'}><td>{x.name}</td><td className="num">{x.days_per_year}</td><td>{x.paid ? 'Paid' : 'Unpaid'}</td><td>{x.calendar_days ? 'Calendar days' : 'Working days'}</td><td>{x.active ? 'Yes' : 'No'}</td>
          <td className="num"><button className="link" onClick={() => setF(x)}>Edit</button></td></tr>)}</tbody></table>
      <form onSubmit={save} className="inline">
        <input placeholder="Leave type name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
        <input type="number" min="0" step="0.5" placeholder="Days per year" value={f.days_per_year} onChange={e => setF({ ...f, days_per_year: e.target.value })} required />
        <label className="check"><input type="checkbox" checked={f.paid} onChange={e => setF({ ...f, paid: e.target.checked })} /> Paid</label>
        <label className="check"><input type="checkbox" checked={f.calendar_days} onChange={e => setF({ ...f, calendar_days: e.target.checked })} /> Count calendar days</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> In use</label>
        <button className="primary" disabled={act.busy}>{f.id ? 'Save changes' : 'Add leave type'}</button>
        {f.id && <button type="button" onClick={() => setF(blank)}>Cancel</button>}
      </form>
      <ErrorNote>{act.error}</ErrorNote>
    </div>
  );
}

function Devices({ setup }) {
  const { fmtStamp } = usePrefs();
  const [rows, reload] = useLoad('/devices');
  const [f, setF] = useState({ name: '', serial_no: '' });
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const act = useAction(), imp = useAction();
  const add = e => { e.preventDefault(); act.run(async () => { await api('/devices', { method: 'POST', body: { ...f, branch_id: setup.branches[0]?.id } }); setF({ name: '', serial_no: '' }); reload(); }); };
  const stale = d => !d.last_sync_at || Date.now() - new Date(d.last_sync_at) > 30 * 60000;
  return (
    <div className="form">
      <p className="hint">Register each fingerprint device, then connect it. <strong>Hikvision:</strong> open the device's web page, go to Configuration &gt; Network &gt; HTTP Listening, and enter this system's address with the URL shown in the device's row below. <strong>ZKTeco:</strong> set the cloud (ADMS) server address to this system. If the device cannot push, use the file import further down.</p>
      {rows?.length ? <table><thead><tr><th>Device</th><th>Serial number</th><th>Last contact</th><th>HTTP Listening URL (Hikvision)</th><th></th></tr></thead>
        <tbody>{rows.map(d => <tr key={d.id}><td>{d.name}</td><td>{d.serial_no}</td><td>{d.last_sync_at ? fmtStamp(d.last_sync_at) : 'Never'}{stale(d) && <small className="warn"> not connected</small>}</td><td><code>/hik/{d.api_key}</code></td>
          <td className="num"><button className="link" onClick={async () => { if (window.confirm(`Remove ${d.name}? Its past punches are kept.`)) { await api(`/devices/${d.id}`, { method: 'DELETE' }); reload(); } }}>Remove</button></td></tr>)}</tbody></table> : rows && <Empty>No devices registered yet.</Empty>}
      <form className="inline" onSubmit={add}>
        <input placeholder="Name, for example Front door" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
        <input placeholder="Serial number" value={f.serial_no} onChange={e => setF({ ...f, serial_no: e.target.value })} required /><button className="primary" disabled={act.busy}>Add device</button>
      </form>
      <ErrorNote>{act.error}</ErrorNote>
      <h2>Import punches from a file</h2>
      <p className="hint">If the device cannot send punches itself, export its log and paste it here. One punch per line: fingerprint ID, then date and time, for example <code>101,2026-11-12 08:44:00</code>. Importing the same lines twice is safe.</p>
      <textarea rows="5" value={csv} onChange={e => setCsv(e.target.value)} placeholder="101,2026-11-12 08:44:00" aria-label="Punch lines" />
      <ErrorNote>{imp.error}</ErrorNote>
      <div className="row-end">{result && <span className="ok">{result.saved} new punches saved{result.unknown ? `, ${result.unknown} from unknown fingerprint IDs` : ''}</span>}
        <button disabled={imp.busy || !csv.trim()} onClick={() => imp.run(async () => { setResult(await api('/punches/import', { method: 'POST', body: { csv } })); setCsv(''); })}>Import</button></div>
    </div>
  );
}

function Audit() {
  const { fmtStamp } = usePrefs();
  const [rows] = useLoad('/audit');
  return rows?.length ? (
    <div className="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Before → after</th></tr></thead>
      <tbody>{rows.map(a => <tr key={a.id}><td>{fmtStamp(a.created_at)}</td><td>{a.user_name || 'System'}</td><td>{a.action}</td><td>{a.entity} {a.entity_id}</td>
        <td><details><summary>Show</summary><pre>{JSON.stringify({ before: a.old_value, after: a.new_value }, null, 1)}</pre></details></td></tr>)}</tbody>
    </table></div>
  ) : rows && <Empty>No changes recorded yet.</Empty>;
}

const SECTIONS = [
  ['Working hours', 'The normal working days and times, and recalculating past days', 'Schedule'],
  ['Attendance rules', 'Grace period, half days, overtime and corrections', 'Rules'],
  ['Offices', 'Office addresses and the area where phone check-ins count as in the office', 'Offices'],
  ['Departments', 'Departments and who supervises each one', 'Departments'],
  ['Holidays', 'Public holidays and company days off', 'Holidays'],
  ['Leave types', 'Kinds of leave and how many days each gives', 'Leave types'],
  ['Fingerprint readers', 'Connect a reader or bring in its records from a file', 'Devices'],
  ['Change history', 'Who changed what, and when', 'Audit log'],
];

export default function Settings() {
  const { t } = usePrefs();
  const [tab, setTab] = useState('');
  const [setup, reload] = useLoad('/setup');
  if (!setup) return null;
  const current = SECTIONS.find(x => x[2] === tab);
  if (!current) return (
    <Page title={t('Settings')}>
      <ul className="list">{SECTIONS.map(([title, about, key]) => (
        <li key={key} className="click" onClick={() => setTab(key)} onKeyDown={e => e.key === 'Enter' && setTab(key)} tabIndex={0} role="button">
          <div className="grow"><strong>{title}</strong><small>{about}</small></div><span className="chev" aria-hidden="true">›</span>
        </li>))}</ul>
    </Page>
  );
  return (
    <Page wide={tab === 'Audit log' || tab === 'Devices'} title={current[0]} hint={<button className="link" onClick={() => setTab('')}>‹ {t('Settings')}</button>}>
      {tab === 'Rules' && <Rules />}
      {tab === 'Schedule' && <Schedule setup={setup} />}
      {tab === 'Offices' && <Offices setup={setup} reload={reload} />}
      {tab === 'Departments' && <Departments setup={setup} reload={reload} />}
      {tab === 'Holidays' && <Holidays setup={setup} reload={reload} />}
      {tab === 'Leave types' && <LeaveTypes setup={setup} reload={reload} />}
      {tab === 'Devices' && <Devices setup={setup} />}
      {tab === 'Audit log' && <Audit />}
    </Page>
  );
}
