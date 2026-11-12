import { useState } from 'react';
import { api, useLoad, usePrefs, Page, Field, ErrorNote, Empty, useAction, todayISO } from '../lib.jsx';
import { DaysEditor, toDays, fromDays } from './Employees.jsx';

const TABS = ['Rules', 'Schedule', 'Departments', 'Holidays', 'Leave types', 'Devices', 'Audit log'];
const RULES = [
  ['grace_min', 'Grace period (minutes after start before a check-in is late)'],
  ['half_day_min', 'Late by this many minutes or more counts as a half day'],
  ['early_tolerance_min', 'Leaving this many minutes early is still on time'],
  ['overtime_min', 'Minimum minutes after end of day that count as overtime'],
  ['dedupe_min', 'Ignore repeat punches within this many minutes'],
  ['correction_window_days', 'Working days an employee has to request a correction'],
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

function Departments({ setup, reload }) {
  const [employees] = useLoad('/employees');
  const [name, setName] = useState('');
  const act = useAction();
  const save = body => act.run(async () => { await api('/departments', { method: 'POST', body }); setName(''); reload(); });
  return (
    <div className="form">
      <p className="hint">The supervisor of a department sees its attendance and approves its leave. Without a supervisor, requests go to HR.</p>
      <table><thead><tr><th>Department</th><th>Supervisor</th></tr></thead>
        <tbody>{setup.departments.map(d => <tr key={d.id}><td>{d.name}</td>
          <td><select value={d.supervisor_id || ''} onChange={e => save({ ...d, supervisor_id: e.target.value || null })} aria-label={`Supervisor of ${d.name}`}>
            <option value="">None (HR approves)</option>{employees?.filter(e => e.active && e.role !== 'employee').map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></td></tr>)}</tbody></table>
      <form className="inline" onSubmit={e => { e.preventDefault(); save({ name, branch_id: setup.branches[0]?.id }); }}>
        <input placeholder="New department name" value={name} onChange={e => setName(e.target.value)} required /><button className="primary" disabled={act.busy}>Add department</button>
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

export default function Settings() {
  const { t } = usePrefs();
  const [tab, setTab] = useState(TABS[0]);
  const [setup, reload] = useLoad('/setup');
  if (!setup) return null;
  return (
    <Page title={t('Settings')}>
      <div className="filters">{TABS.map(x => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{x}</button>)}</div>
      {tab === 'Rules' && <Rules />}
      {tab === 'Schedule' && <Schedule setup={setup} />}
      {tab === 'Departments' && <Departments setup={setup} reload={reload} />}
      {tab === 'Holidays' && <Holidays setup={setup} reload={reload} />}
      {tab === 'Leave types' && <LeaveTypes setup={setup} reload={reload} />}
      {tab === 'Devices' && <Devices setup={setup} />}
      {tab === 'Audit log' && <Audit />}
    </Page>
  );
}
