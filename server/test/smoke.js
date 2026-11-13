// End-to-end check of the main rules against a real database.
// Run: DATABASE_URL=... NO_SCHEDULER=1 PORT=4100 node src/index.js   then   node test/smoke.js
const B = process.env.BASE || 'http://localhost:4100';
let token = '';
const call = async (method, path, body, tk = token) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tk }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...(Array.isArray(j) ? { list: j } : j) };
};
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + JSON.stringify(got))); if (!ok) failed++; };
const eat = d => new Date(d.getTime() + 3 * 36e5).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const wd = s => new Date(s).getUTCDay();
const today = eat(new Date());
// most recent past day with the given weekday
const last = w => { let d = addDays(today, -1); while (wd(d) !== w) d = addDays(d, -1); return d; };
const day = async (id, date) => (await call('GET', `/api/attendance?employee_id=${id}&from=${date}&to=${date}`)).list[0];

let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'ChangeMe123' });
check('admin logs in', r.status === 200 && r.user.must_change_password, r); token = r.token;
r = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
check('wrong password refused', r.status === 401, r);
r = await call('GET', '/api/setup');
check('temporary password blocks the API until changed (FR-02)', r.status === 403, r);
r = await call('POST', '/api/auth/change-password', { current: 'ChangeMe123', next: 'ChangeMe123' });
check('new password must differ from the old one', r.status === 400, r);
r = await call('POST', '/api/auth/change-password', { current: 'ChangeMe123', next: 'Admin-Test-2026' });
check('own password chosen, API opens', r.ok && (await call('GET', '/api/setup')).status === 200, r);
// Log in with a temporary password and choose an own one, as every new user must.
const loginOwn = async (username, temp) => {
  const tk = (await call('POST', '/api/auth/login', { username, password: temp })).token;
  await call('POST', '/api/auth/change-password', { current: temp, next: temp + '-own' }, tk);
  return tk;
};

const setup = await call('GET', '/api/setup');
const dept = (await call('POST', '/api/departments', { name: 'Training' })).id;
const mk = async (no, name, fp, role = 'employee') => (await call('POST', '/api/employees', { employee_no: no, full_name: name, fingerprint_id: fp, role, department_id: dept, hire_date: '2024-01-01' }));
const abel = await mk('E001', 'Abel Full-time', '101');
const sara = await mk('E002', 'Sara Instructor', '102');
const sup = await mk('E003', 'Hana Supervisor', '103', 'supervisor');
await call('POST', '/api/departments', { id: dept, name: 'Training', supervisor_id: sup.id });
check('employees created with temp password', abel.temp_password && sara.id, abel);
// Sara is part-time: Monday, Wednesday, Friday
const t = { start: '08:45', end: '17:30', break_start: '12:30', break_end: '13:30' };
r = await call('PUT', `/api/employees/${sara.id}/schedule`, { days: [1, 3, 5].map(weekday => ({ weekday, ...t })) });
check('part-time schedule saved', r.ok, r);

const dev = await call('POST', '/api/devices', { name: 'Front door', serial_no: 'SN123' });
const push = punches => fetch(B + '/api/devices/push', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': dev.api_key }, body: JSON.stringify({ punches }) }).then(x => x.json());
const mon = last(1), tue = last(2), wed = last(3), thu = last(4), sat = last(6);

r = await push([
  { fingerprint_id: '101', time: mon + ' 08:40:00' }, { fingerprint_id: '101', time: mon + ' 08:40:50' }, // double punch
  { fingerprint_id: '101', time: mon + ' 12:31:00' }, { fingerprint_id: '101', time: mon + ' 13:29:00' },
  { fingerprint_id: '101', time: mon + ' 17:35:00' },
  { fingerprint_id: '101', time: tue + ' 09:10:00' }, { fingerprint_id: '101', time: tue + ' 17:30:00' }, // late 25
  { fingerprint_id: '101', time: wed + ' 08:50:00' },                                                     // no check-out
  { fingerprint_id: '101', time: sat + ' 08:45:00' }, { fingerprint_id: '101', time: sat + ' 12:30:00' }, // Saturday half day
  { fingerprint_id: '102', time: tue + ' 09:00:00' }, { fingerprint_id: '102', time: tue + ' 12:00:00' }, // Sara on an unscheduled day
  { fingerprint_id: '999', time: mon + ' 08:00:00' },                                                     // not enrolled
]);
check('device push accepted', r.saved === 13 && r.unknown === 1, r);
r = await push([{ fingerprint_id: '101', time: mon + ' 08:40:00' }]);
check('same punch sent twice is stored once', r.saved === 0, r);

let a = await day(abel.id, mon);
check('first punch = in, last = out, on time', a.status === 'present' && a.late_min === 0 && !a.flag, a);
check('lunch hour removed from hours (08:40-17:35 = 475 min)', a.worked_min === 475, a.worked_min);
a = await day(abel.id, tue);
check('09:10 is late by 25 minutes', a.status === 'late' && a.late_min === 25, a);
a = await day(abel.id, wed);
check('single punch flagged as missing check-out', a.flag === 'missing_out', a);
a = await day(abel.id, sat);
check('Saturday half day counts as a full present day', a.status === 'present' && a.early_min === 0 && a.worked_min === 225, a);
a = await day(sara.id, tue);
check('part-time punch on unscheduled day = extra, flagged', a.status === 'extra' && a.flag === 'unscheduled', a);

await call('POST', '/api/attendance/reprocess', { from: addDays(today, -8), to: today });
a = await day(abel.id, thu);
check('full-timer with no punch on a working day = absent', a?.status === 'absent', a);
a = await day(sara.id, thu);
check('part-timer is NOT absent on a day she does not work', a === undefined, a);
a = await day(sara.id, last(3));
check('part-timer IS absent on her own working day', a?.status === 'absent', a);

r = await call('GET', '/api/attendance/exceptions');
check('exceptions list shows the flagged days', r.list.length === 2, r.list.map(x => x.flag));
r = await call('POST', '/api/attendance', { employee_id: abel.id, date: wed, check_in: '08:50', check_out: '17:30', note: 'Forgot to punch out' });
check('HR fixes the missing check-out', r.flag === null && r.manual && r.worked_min === 460, r);
await push([{ fingerprint_id: '101', time: wed + ' 20:00:00' }]);
a = await day(abel.id, wed);
check('a later punch does not overwrite the HR fix', a.manual && a.worked_min === 460, a);
r = await call('GET', '/api/punches/unknown');
check('unknown fingerprint ID is listed for HR', r.list[0]?.fingerprint_id === '999', r);

// Leave
const annual = setup.leave_types.find(x => x.is_annual);
r = await call('GET', `/api/leave/balances?employee_id=${abel.id}`);
check('full-time annual leave = 16 days', r.list.find(x => x.leave_type_id === annual.id).entitled === 16, r.list[0]);
r = await call('GET', `/api/leave/balances?employee_id=${sara.id}`);
check('part-time (3 of 6 days) annual leave pro-rated to 8', r.list.find(x => x.leave_type_id === annual.id).entitled === 8, r.list[0]);

const abelTk = await loginOwn('E001', abel.temp_password);
const supTk = await loginOwn('E003', sup.temp_password);
let nm = addDays(today, 7); while (wd(nm) !== 1) nm = addDays(nm, 1);       // a Monday next week or later
if (nm.slice(0, 4) !== addDays(nm, 6).slice(0, 4)) nm = addDays(nm, 14);    // keep the test week inside one year
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: nm, end_date: addDays(nm, 6), reason: 'Family' }, abelTk);
check('annual leave is closed during probation', r.status === 400 && /probation/.test(r.error), r);
r = await call('PUT', '/api/settings', { annual_leave_during_probation: 'maybe' });
check('a yes/no rule refuses other values', r.status === 400, r);
r = await call('PUT', '/api/settings', { annual_leave_during_probation: 'true' });
check('HR can open annual leave to people on probation', r.annual_leave_during_probation === 'true', r);
r = await call('GET', '/api/approvers', null, abelTk);
check('employee is told their supervisor decides', r.via === 'supervisor' && r.names.join() === 'Hana Supervisor', r);
r = await call('GET', '/api/approvers', null, supTk);
check('a supervisor cannot be their own approver: HR decides', r.via === 'hr' && r.names.join() === 'System Administrator', r);
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: nm, end_date: addDays(nm, 6), reason: 'Family' }, abelTk);
check('Mon-Sun leave counts 6 working days, and says who it waits for', r.days === 6 && r.waiting_for?.join() === 'Hana Supervisor', r);
const reqId = r.id;
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: addDays(nm, 2), end_date: addDays(nm, 3) }, abelTk);
check('overlapping request refused', r.status === 400, r);
// Paternity leave is 3 days; a full working week (the one before the request above) is more than that.
r = await call('POST', '/api/leave/requests', { leave_type_id: setup.leave_types.find(x => x.name === 'Paternity').id, start_date: addDays(nm, -7), end_date: addDays(nm, -3) }, abelTk);
check('request above the balance refused', r.status === 400 && /Not enough/.test(r.error), r);
r = await call('POST', `/api/leave/requests/${reqId}/decide`, { approve: true }, abelTk);
check('employee cannot approve own leave', r.status === 403, r);
r = await call('GET', '/api/leave/requests?scope=pending', null, supTk);
check('supervisor sees the pending request', r.list.length === 1, r);
r = await call('GET', '/api/leave/requests?scope=pending', null, supTk);
check('approver sees the balance after the request', r.list[0]?.balance?.left_after === 10 && Array.isArray(r.list[0].also_away), r.list[0]);
r = await call('POST', `/api/leave/requests/${reqId}/decide`, { approve: false }, supTk);
check('rejecting needs a reason', r.status === 400, r);
r = await call('POST', `/api/leave/requests/${reqId}/decide`, { approve: true }, supTk);
check('supervisor approves', r.ok, r);
r = await call('GET', '/api/leave/balances', null, abelTk);
check('balance reduced to 10', r.list.find(x => x.leave_type_id === annual.id).remaining === 10, r.list[0]);

// Access control
r = await call('GET', `/api/attendance?employee_id=${sara.id}`, null, abelTk);
check('employee cannot read another employee', r.status === 403, r);
r = await call('GET', '/api/employees', null, abelTk);
check('employee gets no employee list', r.list.length === 0, r);
r = await call('POST', '/api/employees', { employee_no: 'X', full_name: 'X' }, abelTk);
check('employee cannot create employees', r.status === 403, r);
r = await call('GET', '/api/employees', null, supTk);
check('supervisor sees only own department', r.list.length === 3, r.list.length);

// Correction flow
r = await call('POST', '/api/corrections', { date: tue, requested_in: '08:45', reason: 'Device did not read my finger' }, abelTk);
const corrOk = r.status === 200;
if (corrOk) {
  await call('POST', `/api/corrections/${r.id}/decide`, { approve: true }, supTk);
  a = await day(abel.id, tue);
  check('approved correction removes the lateness', a.status === 'present' && a.late_min === 0 && a.manual, a);
} else console.log('SKIP correction (date outside the correction window today)');

// Report, ZK push protocol, audit
r = await call('GET', `/api/reports/monthly?from=${addDays(today, -8)}&to=${today}`);
const row = r.rows.find(x => x.employee_no === 'E001');
check('report totals per employee', row.days_worked >= 4 && row.absent_days >= 1, row);
let x = await fetch(`${B}/api/reports/monthly.xlsx?from=${addDays(today, -8)}&to=${today}&token=${token}`);
check('Excel export downloads', x.status === 200 && (await x.arrayBuffer()).byteLength > 3000, x.status);
x = await fetch(`${B}/iclock/cdata?SN=SN123&table=ATTLOG&Stamp=1`, { method: 'POST', body: `103\t${mon} 08:44:10\t0\t1\t0\t0\n103\t${mon} 17:31:00\t1\t1\t0\t0\n` });
check('ZK push protocol accepted', (await x.text()) === 'OK: 2', x.status);
a = await day(sup.id, mon);
check('ZK punches became attendance', a?.status === 'present' && a.worked_min === 467, a);
x = await fetch(`${B}/iclock/cdata?SN=NOPE&table=ATTLOG`, { method: 'POST', body: 'x' });
check('unregistered device refused', x.status === 401, x.status);
r = await call('GET', '/api/audit');
check('audit log records changes', r.list.some(e => e.action === 'manual-edit' && e.old_value) && r.list.some(e => e.action === 'approve'), r.list.length);
r = await call('GET', '/api/dashboard/me', null, abelTk);
check('employee dashboard loads', r.status === 200 && r.month, r);

// Offices and the phone check-in area (FR-39, FR-11)
r = await call('POST', '/api/branches', { name: 'Bole Office', latitude: '9.0100' });
check('office with only half a location refused', r.status === 400, r);
r = await call('POST', '/api/branches', { name: 'Bole Office', latitude: '95', longitude: '38.76' });
check('office with an impossible location refused', r.status === 400, r);
const office = await call('POST', '/api/branches', { name: 'Bole Office', address: 'Bole', latitude: '9.010000', longitude: '38.760000', radius_m: 100 });
check('office saved with its location', office.id && office.latitude === 9.01 && office.radius_m === 100, office);
await call('POST', '/api/departments', { id: dept, name: 'Training', branch_id: office.id, supervisor_id: sup.id });
r = (await call('GET', '/api/setup')).branches.find(b => b.id === office.id);
check('office shows its department count', r?.departments === 1, r);
r = await call('POST', '/api/checkin', { latitude: 9.0200, longitude: 38.7600 }, abelTk);
check('phone check-in 1 km away with no note refused', r.status === 400, r);
r = await call('POST', '/api/checkin', { latitude: 9.0102, longitude: 38.7601 }, abelTk);
check('phone check-in inside the office area accepted without review', r.employee_id === abel.id && r.check_in && r.flag !== 'field', r);
r = (await call('GET', '/api/audit')).list.find(e => e.entity === 'branch' && e.action === 'create');
check('office change is in the change history', !!r, r);

for (const path of ['/api/leave/requests', '/api/corrections', '/api/leave/calendar', '/api/leave/requests?scope=all', '/api/attendance/today',
  '/api/notifications', '/api/settings', '/api/devices', '/api/setup', '/api/corrections?scope=pending', `/api/employees/${sara.id}/schedule`]) {
  r = await call('GET', path);
  check('loads ' + path, r.status === 200, r);
}
r = await call('GET', '/api/leave/requests', null, abelTk);
check('employee sees own leave requests', r.list?.length === 1, r);

// Leave balances in notifications and per employee
r = await call('GET', '/api/notifications', null, abelTk);
check('approval notification says how much leave is left', r.list.some(n => /Annual leave approved/.test(n.title) && /6 days.*10 days left/.test(n.body) && n.link === '/leave'), r.list);
r = await call('GET', `/api/leave/requests?employee_id=${abel.id}`);
check('HR sees one person’s leave history', r.list?.length === 1 && r.list[0].leave_type === 'Annual', r);
r = await call('GET', `/api/leave/requests?employee_id=${sara.id}`, null, abelTk);
check('employee cannot read another person’s leave history', r.status === 403, r);
r = await call('GET', '/api/reports/leave');
const lr = r.rows?.find(x => x.employee_no === 'E001');
check('leave report: taken and left per person', lr && lr.leave[annual.id].used === 6 && lr.leave[annual.id].remaining === 10, lr);
x = await fetch(`${B}/api/reports/leave.xlsx?token=${token}`);
check('leave Excel downloads', x.status === 200 && (await x.arrayBuffer()).byteLength > 3000, x.status);

// System account, approval chain, leave rules
const adminId = (await call('GET', '/api/me')).id;
r = await call('GET', '/api/attendance/today');
check('the system administrator is not in the team list', !r.list.some(x => x.employee_id === adminId) && r.list.length > 0, r.list.map(x => x.full_name));
r = await call('GET', `/api/reports/monthly?from=${addDays(today, -8)}&to=${today}`);
check('the system administrator is not in reports', !r.rows.some(x => x.employee_no === 'ADMIN'), r.rows.map(x => x.employee_no));
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: nm, end_date: nm });
check('a system account cannot ask for leave', r.status === 400 && /not recorded/.test(r.error), r);
r = await call('GET', '/api/approvers');
check('with one administrator, nobody could decide for them', r.names.length === 0 && r.via === 'none', r);
r = await call('POST', '/api/attendance', { employee_id: adminId, date: mon, status: 'present', note: 'Me' });
check('HR cannot change their own attendance', r.status === 403, r);
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: `${today.slice(0, 4)}-12-30`, end_date: `${+today.slice(0, 4) + 1}-01-03` }, abelTk);
check('leave across two years is refused with the reason', r.status === 400 && /two requests/.test(r.error), r);
const sick = setup.leave_types.find(x => x.name === 'Sick');
r = await call('POST', '/api/leave/requests', { employee_id: sara.id, leave_type_id: sick.id, start_date: addDays(nm, 21), end_date: addDays(nm, 22), reason: 'Clinic' });
check('leave recorded by HR is approved at once', r.status === 'approved' && r.days === 2, r);
r = await call('GET', `/api/leave/balances?employee_id=${sara.id}`);
check('recorded leave is taken from the balance', r.list.find(x => x.leave_type_id === sick.id).used === 2, r.list);

// HR officers and administrators: management decides, with the other HR people
const officer = await call('POST', '/api/employees', { employee_no: 'E020', full_name: 'Marta Officer', role: 'hr', hire_date: '2024-01-01', on_probation: false });
const boss = await call('POST', '/api/employees', { employee_no: 'E021', full_name: 'Girma Manager', role: 'management', hire_date: '2020-01-01', on_probation: false, track_attendance: false });
const officerTk = await loginOwn('E020', officer.temp_password), bossTk = await loginOwn('E021', boss.temp_password);
r = await call('GET', '/api/approvers', null, officerTk);
check('an HR officer is decided by management and the other HR people', r.via === 'senior' && r.names.join() === 'Girma Manager,System Administrator', r);
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: addDays(nm, 28), end_date: addDays(nm, 28) }, officerTk);
const officerReq = r.id;
r = await call('POST', `/api/leave/requests/${officerReq}/decide`, { approve: true }, officerTk);
check('an HR officer cannot approve their own leave', r.status === 403, r);
r = await call('GET', '/api/leave/requests?scope=pending', null, bossTk);
check('management sees only what is theirs to decide', r.list.length === 1 && r.list[0].id === officerReq, r.list?.map(x => x.full_name));
r = await call('GET', '/api/counts', null, bossTk);
check('management has an approvals count', r.approvals === 1, r);
r = await call('POST', '/api/corrections', { date: today, requested_in: '08:45', reason: 'Test' }, bossTk);
check('an account that is not recorded cannot ask for a correction', r.status === 400, r);
r = await call('POST', `/api/leave/requests/${officerReq}/decide`, { approve: true }, bossTk);
check('management approves the HR officer leave', r.ok, r);
r = await call('GET', '/api/me', null, bossTk);
check('an account can be marked as not recorded', r.track_attendance === false, r);
r = await call('GET', '/api/dashboard/me', null, abelTk);
check('my page says where I sit and who decides', r.place?.supervisor === 'Hana Supervisor' && r.approvers?.names[0] === 'Hana Supervisor', [r.place, r.approvers]);

// Team dashboard and week grid
r = await call('GET', '/api/dashboard/team?days=30');
check('dashboard loads with today, trend, departments', r.today && Array.isArray(r.trend) && r.trend.length > 0 && Array.isArray(r.departments) && r.watch, Object.keys(r));
check('dashboard trend counts add up', r.trend.every(d => ['present', 'late', 'leave', 'absent'].every(k => Number.isInteger(d[k]))), r.trend[0]);
check('dashboard arrival times in 5-minute steps', r.arrivals.length > 0 && r.arrivals.every(a => a.min % 5 === 0), r.arrivals);
r = await call('GET', '/api/dashboard/team', null, supTk);
check('supervisor dashboard covers only their department', r.employees <= 3 && Array.isArray(r.devices) && r.devices.length === 0, r.employees);
r = await call('GET', '/api/dashboard/team', null, abelTk);
check('employee cannot open the team dashboard', r.status === 403, r);
r = await call('GET', `/api/attendance/week?start=${wed}`);
check('week grid starts on Monday with 7 days', r.days?.length === 7 && wd(r.start) === 1 && r.people.some(p => Object.keys(p.cells).length), r.start);

// Probation (2 months) and the employment lifecycle
let list = (await call('GET', '/api/employees')).list;
let ab = list.find(e => e.id === abel.id);
check('new employee starts on probation, 2 months from start', ab.employment_status === 'probation' && ab.probation_end === '2024-03-01' && ab.probation_days_left < 0, ab);
check('employee list shows annual leave left', ab.annual?.remaining === 10 && ab.leave_taken === 6, ab.annual);
r = await call('GET', '/api/dashboard/me', null, abelTk);
check('employee sees own probation on Home', r.employment?.employment_status === 'probation' && r.employment.probation_days_left < 0, r.employment);
const perm = await call('POST', '/api/employees', { employee_no: 'E009', full_name: 'Moved Permanent', department_id: dept, hire_date: '2025-05-01', on_probation: false });
list = (await call('GET', '/api/employees')).list;
check('HR can add someone who is already permanent', list.find(e => e.id === perm.id)?.employment_status === 'permanent', list.find(e => e.id === perm.id));
r = await call('POST', `/api/employees/${perm.id}/probation`, { decision: 'start' });
check('a never-confirmed person can be put on probation', r.ok && r.probation_end === '2025-07-01', r);
r = await call('POST', `/api/employees/${abel.id}/probation`, { decision: 'confirm' }, supTk);
check('supervisor cannot decide a probation', r.status === 403, r);
r = await call('POST', `/api/employees/${abel.id}/probation`, { decision: 'confirm', note: 'Good attendance' });
ab = (await call('GET', '/api/employees')).list.find(e => e.id === abel.id);
check('HR confirms probation: now permanent', r.ok && ab.employment_status === 'permanent' && ab.confirmed_on, ab);
r = await call('GET', '/api/notifications', null, abelTk);
check('employee is told they are permanent', r.list.some(n => /permanent/.test(n.title)), r.list.map(n => n.title));
r = await call('POST', `/api/employees/${abel.id}/probation`, { decision: 'confirm' });
check('cannot confirm twice', r.status === 400, r);
const me = (await call('GET', '/api/me')).id;
r = await call('POST', `/api/employees/${me}/status`, { active: false, reason: 'Resigned' });
check('nobody can deactivate themselves', r.status === 403, r);

const newbie = await call('POST', '/api/employees', { employee_no: 'E010', full_name: 'New Starter', fingerprint_id: '110', department_id: dept, hire_date: addDays(today, -20) });
const hired = addDays(today, -20), share = Math.round(16 * (13 - +hired.slice(5, 7)) / 12 * 2) / 2;
r = (await call('GET', '/api/employees')).list.find(e => e.id === newbie.id);
check('first-year annual leave is the share for the months worked', hired.slice(0, 4) !== today.slice(0, 4) || r.annual?.entitled === share, [r.annual, share]);
r = await call('POST', `/api/employees/${newbie.id}/probation`, { decision: 'reject' });
check('ending a probation needs a reason', r.status === 400, r);
r = await call('POST', `/api/employees/${newbie.id}/probation`, { decision: 'reject', note: 'Frequent late arrival' });
list = (await call('GET', '/api/employees')).list;
const nb = list.find(e => e.id === newbie.id);
check('probation not confirmed: inactive, record kept', r.ok && nb && !nb.active && nb.employment_status === 'not_confirmed' && nb.left_reason === 'Probation not confirmed', nb);
r = await call('POST', '/api/auth/login', { username: 'E010', password: newbie.temp_password });
check('inactive person cannot log in', r.status === 401, r);
r = await call('GET', `/api/employees/${newbie.id}/history`);
check('history shows start and end', r.list?.map(h => h.event).join() === 'hired,left' && /late/.test(r.list[1].note), r.list);

r = await call('POST', `/api/employees/${sara.id}/status`, { active: false, reason: 'Nope' });
check('leaving needs a known reason', r.status === 400, r);
const lastDay = addDays(last(3), -1);
check('part-timer was absent after her later last day (before)', (await day(sara.id, last(3)))?.status === 'absent', null);
const keptBefore = (await call('GET', `/api/attendance?employee_id=${sara.id}&from=2024-01-01&to=${lastDay}`)).list.length;
r = await call('POST', `/api/employees/${sara.id}/status`, { active: false, date: lastDay, reason: 'Resigned', note: 'Moved city' });
check('HR marks someone as no longer working here', r.ok, r);
check('no absences after the last day', (await day(sara.id, last(3))) === undefined, await day(sara.id, last(3)));
r = await call('GET', `/api/attendance?employee_id=${sara.id}&from=2024-01-01&to=${lastDay}`);
check('attendance up to the last day is kept', r.list.length === keptBefore, [r.list.length, keptBefore]);
r = await call('POST', `/api/employees/${sara.id}/status`, { active: true, note: 'Rehired' });
list = (await call('GET', '/api/employees')).list;
check('person can come back to work', r.ok && list.find(e => e.id === sara.id)?.active, r);
r = await call('POST', `/api/employees/${newbie.id}/status`, { active: true, date: today });
check('return date must be after the last day', r.status === 400, r);
r = await call('POST', `/api/employees/${newbie.id}/status`, { active: true, date: addDays(today, 1) });
check('coming back after failed probation starts a new probation', r.ok && r.probation_end, r);

// Automatic reminders: probation ending, and several days absent in a row
if (process.env.DATABASE_URL) {
  const { runAlerts } = await import('../src/alerts.js');
  const { getSettings, pool } = await import('../src/db.js');
  const late = await call('POST', '/api/employees', { employee_no: 'E011', full_name: 'Overdue Probation', department_id: dept, hire_date: '2024-01-01' });
  const gone = await call('POST', '/api/employees', { employee_no: 'E012', full_name: 'Never Came', fingerprint_id: '112', department_id: dept, hire_date: addDays(today, -20) });
  await call('POST', '/api/attendance/reprocess', { from: addDays(today, -10), to: today });
  r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: addDays(nm, 35), end_date: addDays(nm, 35) }, officerTk);
  await pool.query("UPDATE leave_requests SET created_at = now() - interval '3 days' WHERE id = $1", [r.id]);
  await runAlerts(await getSettings());
  await runAlerts(await getSettings());
  r = (await call('GET', '/api/notifications')).list;
  check('a request waiting too long is chased once', r.filter(n => n.title === 'A request is still waiting for you' && n.body.startsWith('Marta Officer')).length === 1, r.map(n => n.title));
  r = (await call('GET', '/api/notifications')).list;
  check('HR reminded once about an overdue probation', r.filter(n => n.title === 'Probation decision needed' && n.body.startsWith('Overdue Probation')).length === 1 && r.find(n => n.body.startsWith('Overdue Probation')).link === `/employees?open=${late.id}`, r.map(n => n.title));
  check('HR alerted about several days absent in a row', r.filter(n => n.title === 'Absent several days in a row' && n.body.startsWith('Never Came')).length === 1, r.map(n => n.title));
  r = (await call('GET', '/api/notifications', null, supTk)).list;
  check('supervisor gets the same alerts, linked to Team today', r.some(n => n.body.startsWith('Never Came') && n.link === '/team'), r.map(n => n.title));
  list = (await call('GET', '/api/employees')).list;
  check('employee list shows the absence run', list.find(e => e.id === gone.id).absent_streak >= 3, list.find(e => e.id === gone.id));
  r = await call('GET', '/api/counts');
  check('Employees menu counts people who need HR', r.people >= 2 && r.notifications > 0, r);
  const one = (await call('GET', '/api/notifications')).list.find(n => !n.read_at);
  await call('POST', '/api/notifications/read', { id: one.id });
  r = (await call('GET', '/api/notifications')).list;
  check('one notification can be marked as read', r.find(n => n.id === one.id).read_at && r.some(n => !n.read_at), null);
  await pool.end();
} else console.log('SKIP reminders (set DATABASE_URL for the test process too)');

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
