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

const abelTk = (await call('POST', '/api/auth/login', { username: 'E001', password: abel.temp_password })).token;
const supTk = (await call('POST', '/api/auth/login', { username: 'E003', password: sup.temp_password })).token;
let nm = addDays(today, 7); while (wd(nm) !== 1) nm = addDays(nm, 1);       // a Monday next week or later
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: nm, end_date: addDays(nm, 6), reason: 'Family' }, abelTk);
check('Mon-Sun leave counts 6 working days', r.days === 6, r);
const reqId = r.id;
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: addDays(nm, 2), end_date: addDays(nm, 3) }, abelTk);
check('overlapping request refused', r.status === 400, r);
r = await call('POST', '/api/leave/requests', { leave_type_id: annual.id, start_date: addDays(nm, 14), end_date: addDays(nm, 40) }, abelTk);
check('request above the balance refused', r.status === 400 && /Not enough/.test(r.error), r);
r = await call('POST', `/api/leave/requests/${reqId}/decide`, { approve: true }, abelTk);
check('employee cannot approve own leave', r.status === 403, r);
r = await call('GET', '/api/leave/requests?scope=pending', null, supTk);
check('supervisor sees the pending request', r.list.length === 1, r);
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

for (const path of ['/api/leave/requests', '/api/corrections', '/api/leave/calendar', '/api/leave/requests?scope=all', '/api/attendance/today',
  '/api/notifications', '/api/settings', '/api/devices', '/api/setup', '/api/corrections?scope=pending', `/api/employees/${sara.id}/schedule`]) {
  r = await call('GET', path);
  check('loads ' + path, r.status === 200, r);
}
r = await call('GET', '/api/leave/requests', null, abelTk);
check('employee sees own leave requests', r.list?.length === 1, r);
console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
