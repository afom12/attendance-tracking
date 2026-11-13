import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { q, q1, getSettings, DEFAULT_SETTINGS } from './db.js';
import { auth, allow, wrap, fail, sign, isHr, canSee, visibleDepartments, audit, notify,
         local, toUTC, today, addDays, hhmmToMin, isDate, parseLocal } from './util.js';
import { processDay, processRange, ingestPunches, computeRecord, scheduleFor, countLeaveDays, getBalance } from './engine.js';

export const api = express.Router();
export const iclock = express.Router();
const HR = allow('hr', 'admin');
const tempPassword = () => crypto.randomBytes(5).toString('base64url');
const pickPassword = typed => {
  if (!typed) return tempPassword();
  if (String(typed).length < 6) fail(400, 'The password needs at least 6 characters');
  return String(typed);
};
const EMP_COLS = `e.id, e.employee_no, e.full_name, e.email, e.phone, e.role, e.department_id, e.shift_id,
  e.hire_date, e.active, e.fingerprint_id, d.name AS department`;

// ---------- Fingerprint devices (no user login; the device proves itself with its key or serial) ----------
api.post('/devices/push', wrap(async (req, res) => {
  const dev = await q1('SELECT * FROM devices WHERE api_key=$1', [req.headers['x-device-key'] || '']);
  if (!dev) fail(401, 'Unknown device key');
  const list = (req.body.punches || []).map(p => ({ fingerprint_id: p.fingerprint_id, at: parseLocal(p.time) }));
  res.json(await ingestPunches(list, { deviceId: dev.id }));
}));

// ZKTeco-style "push" (ADMS) protocol, used by many fingerprint terminals. Point the device's
// cloud server address at this server; register its serial number under Settings > Devices first.
const zkDevice = wrap(async (req, res, next) => {
  req.device = await q1('SELECT * FROM devices WHERE serial_no=$1', [req.query.SN || '']);
  if (!req.device) return res.status(401).type('text').send('UNKNOWN DEVICE');
  await q('UPDATE devices SET last_sync_at = now() WHERE id=$1', [req.device.id]);
  next();
});
iclock.get('/cdata', zkDevice, (req, res) => res.type('text').send(
  `GET OPTION FROM: ${req.query.SN}\nStamp=9999\nOpStamp=9999\nErrorDelay=60\nDelay=30\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nEncrypt=0\nTimeZone=3\n`));
iclock.post('/cdata', zkDevice, wrap(async (req, res) => {
  if (req.query.table !== 'ATTLOG') return res.type('text').send('OK');
  const list = String(req.body || '').split(/\r?\n/).map(l => l.split('\t')).filter(c => c.length >= 2)
    .map(c => ({ fingerprint_id: c[0].trim(), at: parseLocal(c[1]) }));
  const r = await ingestPunches(list, { deviceId: req.device.id });
  res.type('text').send('OK: ' + r.received);
}));
iclock.get('/getrequest', zkDevice, (req, res) => res.type('text').send('OK'));
iclock.post('/devicecmd', zkDevice, (req, res) => res.type('text').send('OK'));

// Hikvision terminals: "HTTP Listening" sends one request per event. The device cannot send a custom
// header, so its key is part of the address: /hik/<device key>. The body may be multipart, JSON or XML.
export const hik = express.Router();
hik.post('/:key', wrap(async (req, res) => {
  const dev = await q1('SELECT * FROM devices WHERE api_key=$1', [req.params.key]);
  if (!dev) return res.status(401).type('text').send('UNKNOWN DEVICE');
  const body = String(req.body || '');
  const pick = name => (new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(body) || new RegExp(`<${name}>([^<]+)</${name}>`).exec(body) || [])[1];
  const who = pick('employeeNoString'), when = new Date(pick('dateTime') || '');
  // Heartbeats and door events carry no employee number; they only prove the device is alive.
  if (who && !isNaN(when)) await ingestPunches([{ fingerprint_id: who, at: when }], { deviceId: dev.id });
  else await q('UPDATE devices SET last_sync_at = now() WHERE id=$1', [dev.id]);
  res.type('text').send('OK');
}));

// ---------- Login ----------
api.post('/auth/login', wrap(async (req, res) => {
  const { username = '', password = '' } = req.body;
  const u = await q1('SELECT * FROM employees WHERE lower(employee_no)=lower($1) OR lower(email)=lower($1)', [username.trim()]);
  if (!u || !u.active) fail(401, 'Wrong employee ID or password');
  if (u.locked_until && u.locked_until > new Date()) fail(423, 'Too many failed attempts. Try again in 15 minutes.');
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const n = u.failed_logins + 1;
    await q('UPDATE employees SET failed_logins=$2, locked_until=$3 WHERE id=$1',
      [u.id, n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60000) : null]);
    fail(401, 'Wrong employee ID or password');
  }
  await q('UPDATE employees SET failed_logins=0, locked_until=NULL WHERE id=$1', [u.id]);
  await audit(u, 'login', 'employee', u.id);
  res.json({ token: sign(u), user: { id: u.id, full_name: u.full_name, role: u.role, employee_no: u.employee_no, must_change_password: u.must_change_password } });
}));

api.use(auth);

api.get('/me', (req, res) => res.json(req.user));
api.post('/auth/change-password', wrap(async (req, res) => {
  const { current = '', next = '' } = req.body;
  if (next.length < 8) fail(400, 'The new password needs at least 8 characters');
  if (next === current) fail(400, 'The new password must be different from the current one');
  const u = await q1('SELECT password_hash FROM employees WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(current, u.password_hash))) fail(400, 'The current password is wrong');
  await q('UPDATE employees SET password_hash=$2, must_change_password=false WHERE id=$1', [req.user.id, await bcrypt.hash(next, 10)]);
  await audit(req.user, 'change-password', 'employee', req.user.id);
  res.json({ ok: true });
}));

// ---------- Employees ----------
api.get('/employees', wrap(async (req, res) => {
  const depts = await visibleDepartments(req.user);
  if (depts !== null && !depts.length) return res.json([]);
  res.json(await q(`SELECT ${EMP_COLS}, (SELECT count(*)::int FROM employee_days x WHERE x.employee_id = e.id) AS custom_days
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
    WHERE ($1::int[] IS NULL OR e.department_id = ANY($1)) ORDER BY e.full_name`, [depts]));
}));

function employeeFields(b, user) {
  if (!b.employee_no?.trim() || !b.full_name?.trim()) fail(400, 'Employee ID and full name are required');
  const role = b.role || 'employee';
  if (!['employee', 'supervisor', 'hr', 'admin', 'management'].includes(role)) fail(400, 'Unknown role');
  if (role === 'admin' && user.role !== 'admin') fail(403, 'Only an administrator can create administrators');
  if (b.hire_date && !isDate(b.hire_date)) fail(400, 'Hire date is not valid');
  return [b.employee_no.trim(), b.full_name.trim(), b.email?.trim() || null, b.phone?.trim() || null, role,
    b.department_id || null, b.shift_id || null, b.hire_date || null, b.fingerprint_id?.toString().trim() || null];
}
// When a fingerprint ID is linked, earlier punches from that ID become this employee's attendance.
async function linkPunches(empId, fingerprintId) {
  if (!fingerprintId) return;
  const rows = await q('UPDATE punches SET employee_id=$1 WHERE fingerprint_id=$2 AND employee_id IS NULL RETURNING punched_at', [empId, fingerprintId]);
  for (const d of new Set(rows.map(r => local(r.punched_at).date))) await processDay(empId, d);
}
api.post('/employees', HR, wrap(async (req, res) => {
  const f = employeeFields(req.body, req.user);
  const temp = pickPassword(req.body.password);
  const shift = f[6] || (await q1('SELECT id FROM shifts ORDER BY id LIMIT 1'))?.id;
  f[6] = shift;
  const e = await q1(`INSERT INTO employees (employee_no, full_name, email, phone, role, department_id, shift_id, hire_date, fingerprint_id, password_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [...f, await bcrypt.hash(temp, 10)]);
  await linkPunches(e.id, f[8]);
  await audit(req.user, 'create', 'employee', e.id, null, { employee_no: f[0], full_name: f[1], role: f[4] });
  res.json({ id: e.id, temp_password: temp });
}));
api.put('/employees/:id', HR, wrap(async (req, res) => {
  const old = await q1('SELECT * FROM employees WHERE id=$1', [req.params.id]);
  if (!old) fail(404, 'Employee not found');
  if (old.role === 'admin' && req.user.role !== 'admin') fail(403, 'Only an administrator can change an administrator');
  const f = employeeFields(req.body, req.user);
  await q(`UPDATE employees SET employee_no=$2, full_name=$3, email=$4, phone=$5, role=$6, department_id=$7,
    shift_id=COALESCE($8, shift_id), hire_date=$9, fingerprint_id=$10, active=$11 WHERE id=$1`,
    [old.id, ...f, req.body.active !== false]);
  await linkPunches(old.id, f[8]);
  delete old.password_hash;
  await audit(req.user, 'update', 'employee', old.id, old, req.body);
  res.json({ ok: true });
}));
api.post('/employees/:id/reset-password', HR, wrap(async (req, res) => {
  const temp = pickPassword(req.body.password);
  const e = await q1('UPDATE employees SET password_hash=$2, must_change_password=true, failed_logins=0, locked_until=NULL WHERE id=$1 RETURNING id',
    [req.params.id, await bcrypt.hash(temp, 10)]);
  if (!e) fail(404, 'Employee not found');
  await audit(req.user, 'reset-password', 'employee', e.id);
  res.json({ temp_password: temp });
}));

// Working days. Body: { days: [{ weekday, start:'08:45', end:'17:30', break_start, break_end }] }
function parseDays(days) {
  return (days || []).map(d => {
    const row = [+d.weekday, hhmmToMin(d.start), hhmmToMin(d.end), hhmmToMin(d.break_start), hhmmToMin(d.break_end)];
    if (!(row[0] >= 0 && row[0] <= 6) || row[1] == null || row[2] == null || row[2] <= row[1]) fail(400, 'Each working day needs a valid start and end time');
    if ((row[3] == null) !== (row[4] == null)) fail(400, 'A break needs both a start and an end');
    return row;
  });
}
api.get('/employees/:id/schedule', wrap(async (req, res) => {
  if (!(await canSee(req.user, req.params.id))) fail(403, 'Not allowed');
  res.json({
    custom: await q('SELECT * FROM employee_days WHERE employee_id=$1 ORDER BY weekday', [req.params.id]),
    standard: await q('SELECT sd.* FROM shift_days sd JOIN employees e ON e.shift_id = sd.shift_id WHERE e.id=$1 ORDER BY weekday', [req.params.id]),
  });
}));
api.put('/employees/:id/schedule', HR, wrap(async (req, res) => {
  const rows = parseDays(req.body.days);
  const old = await q('SELECT * FROM employee_days WHERE employee_id=$1', [req.params.id]);
  await q('DELETE FROM employee_days WHERE employee_id=$1', [req.params.id]);
  for (const r of rows) await q('INSERT INTO employee_days VALUES ($1,$2,$3,$4,$5,$6)', [req.params.id, ...r]);
  await audit(req.user, 'update', 'employee-schedule', req.params.id, old, req.body.days);
  await processDay(+req.params.id, today());
  res.json({ ok: true });
}));

// ---------- Company setup ----------
api.get('/setup', wrap(async (req, res) => res.json({
  branches: await q(`SELECT b.*, (SELECT count(*)::int FROM departments d WHERE d.branch_id = b.id) AS departments
    FROM branches b ORDER BY b.name`),
  departments: await q('SELECT d.*, e.full_name AS supervisor FROM departments d LEFT JOIN employees e ON e.id = d.supervisor_id ORDER BY d.name'),
  shifts: await q('SELECT * FROM shifts ORDER BY id'),
  shift_days: await q('SELECT * FROM shift_days ORDER BY shift_id, weekday'),
  holidays: await q('SELECT * FROM holidays ORDER BY date'),
  leave_types: await q('SELECT * FROM leave_types ORDER BY id'),
})));
api.post('/branches', HR, wrap(async (req, res) => {
  const b = req.body; if (!b.name?.trim()) fail(400, 'Name is required');
  // The office location is optional, but when given it needs both numbers (decimal degrees).
  const num = v => v === '' || v == null ? null : Number(v);
  const lat = num(b.latitude), lng = num(b.longitude), radius = num(b.radius_m) ?? 100;
  if ((lat == null) !== (lng == null)) fail(400, 'Give both latitude and longitude, or neither');
  if (lat != null && !(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) fail(400, 'The location is not valid');
  if (!(radius >= 20 && radius <= 5000)) fail(400, 'The office area must be between 20 and 5000 metres');
  const args = [b.name.trim(), b.address?.trim() || null, lat, lng, Math.round(radius)];
  const old = b.id ? await q1('SELECT * FROM branches WHERE id=$1', [b.id]) : null;
  if (b.id && !old) fail(404, 'Office not found');
  const r = b.id
    ? await q1('UPDATE branches SET name=$2, address=$3, latitude=$4, longitude=$5, radius_m=$6 WHERE id=$1 RETURNING *', [b.id, ...args])
    : await q1('INSERT INTO branches (name, address, latitude, longitude, radius_m) VALUES ($1,$2,$3,$4,$5) RETURNING *', args);
  await audit(req.user, b.id ? 'update' : 'create', 'branch', r.id, old, r);
  res.json(r);
}));
api.post('/departments', HR, wrap(async (req, res) => {
  const b = req.body; if (!b.name?.trim()) fail(400, 'Name is required');
  const args = [b.name.trim(), b.branch_id || null, b.supervisor_id || null];
  const r = b.id
    ? await q1('UPDATE departments SET name=$2, branch_id=$3, supervisor_id=$4 WHERE id=$1 RETURNING id', [b.id, ...args])
    : await q1('INSERT INTO departments (name, branch_id, supervisor_id) VALUES ($1,$2,$3) RETURNING id', args);
  await audit(req.user, b.id ? 'update' : 'create', 'department', r.id, null, b);
  res.json(r);
}));
api.put('/shifts/:id/days', HR, wrap(async (req, res) => {
  const rows = parseDays(req.body.days);
  if (!rows.length) fail(400, 'The standard schedule needs at least one working day');
  await q('DELETE FROM shift_days WHERE shift_id=$1', [req.params.id]);
  for (const r of rows) await q('INSERT INTO shift_days VALUES ($1,$2,$3,$4,$5,$6)', [req.params.id, ...r]);
  await audit(req.user, 'update', 'shift', req.params.id, null, req.body.days);
  res.json({ ok: true });
}));
api.post('/holidays', HR, wrap(async (req, res) => {
  if (!isDate(req.body.date) || !req.body.name?.trim()) fail(400, 'Date and name are required');
  const r = await q1('INSERT INTO holidays (date, name) VALUES ($1,$2) ON CONFLICT (date) DO UPDATE SET name=$2 RETURNING id', [req.body.date, req.body.name.trim()]);
  await audit(req.user, 'create', 'holiday', r.id, null, req.body);
  if (req.body.date <= today()) await processRange(req.body.date, req.body.date);
  res.json(r);
}));
api.delete('/holidays/:id', HR, wrap(async (req, res) => {
  const h = await q1('DELETE FROM holidays WHERE id=$1 RETURNING *', [req.params.id]);
  if (h) { await audit(req.user, 'delete', 'holiday', h.id, h); if (h.date <= today()) await processRange(h.date, h.date); }
  res.json({ ok: true });
}));
api.post('/leave-types', HR, wrap(async (req, res) => {
  const b = req.body; if (!b.name?.trim() || !(+b.days_per_year >= 0)) fail(400, 'Name and days per year are required');
  const args = [b.name.trim(), +b.days_per_year, b.paid !== false, !!b.requires_attachment, !!b.calendar_days, b.active !== false];
  const r = b.id
    ? await q1('UPDATE leave_types SET name=$2, days_per_year=$3, paid=$4, requires_attachment=$5, calendar_days=$6, active=$7 WHERE id=$1 RETURNING id', [b.id, ...args])
    : await q1('INSERT INTO leave_types (name, days_per_year, paid, requires_attachment, calendar_days, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', args);
  await audit(req.user, b.id ? 'update' : 'create', 'leave-type', r.id, null, b);
  res.json(r);
}));
api.get('/settings', HR, wrap(async (req, res) => res.json(await getSettings())));
api.put('/settings', HR, wrap(async (req, res) => {
  const old = await getSettings();
  for (const [k, v] of Object.entries(req.body)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    if (k !== 'annual_extra_day_every_2_years' && !(+v >= 0)) fail(400, `${k} must be a number`);
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, String(v)]);
  }
  await audit(req.user, 'update', 'settings', null, old, req.body);
  res.json(await getSettings());
}));
api.get('/devices', HR, wrap(async (req, res) => res.json(await q('SELECT d.*, b.name AS branch FROM devices d LEFT JOIN branches b ON b.id = d.branch_id ORDER BY d.name'))));
api.post('/devices', HR, wrap(async (req, res) => {
  const b = req.body; if (!b.name?.trim() || !b.serial_no?.trim()) fail(400, 'Name and serial number are required');
  const r = await q1('INSERT INTO devices (name, serial_no, branch_id, api_key) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.name.trim(), b.serial_no.trim(), b.branch_id || null, crypto.randomBytes(18).toString('base64url')]);
  await audit(req.user, 'create', 'device', r.id, null, { name: r.name, serial_no: r.serial_no });
  res.json(r);
}));
api.delete('/devices/:id', HR, wrap(async (req, res) => {
  await q('UPDATE punches SET device_id=NULL WHERE device_id=$1', [req.params.id]);
  await q('DELETE FROM devices WHERE id=$1', [req.params.id]);
  await audit(req.user, 'delete', 'device', req.params.id);
  res.json({ ok: true });
}));

// ---------- Punches ----------
// Import a file exported from the device: one punch per line, "fingerprint_id,YYYY-MM-DD HH:MM:SS" (comma or tab).
api.post('/punches/import', HR, wrap(async (req, res) => {
  const list = String(req.body.csv || '').split(/\r?\n/).map(l => l.split(/[,\t;]/)).filter(c => c.length >= 2)
    .map(c => ({ fingerprint_id: c[0].trim(), at: parseLocal(c[1]) })).filter(p => p.at);
  if (!list.length) fail(400, 'No valid lines found. Each line needs: fingerprint ID, date and time');
  const r = await ingestPunches(list, { source: 'import' });
  await audit(req.user, 'import', 'punches', null, null, r);
  res.json(r);
}));
api.get('/punches/unknown', HR, wrap(async (req, res) => res.json(await q(
  `SELECT fingerprint_id, count(*)::int AS punches, max(punched_at) AS last_seen FROM punches
   WHERE employee_id IS NULL GROUP BY fingerprint_id ORDER BY last_seen DESC`))));

// Phone check-in: the fallback when a terminal is down, and for staff outside the office.
api.post('/checkin', wrap(async (req, res) => {
  const { latitude, longitude, note } = req.body;
  const br = await q1(`SELECT b.* FROM branches b JOIN departments d ON d.branch_id = b.id WHERE d.id=$1`, [req.user.department_id]);
  let inside = false;
  if (br?.latitude != null && latitude != null) {
    const rad = x => x * Math.PI / 180, R = 6371000;
    const a = Math.sin(rad(latitude - br.latitude) / 2) ** 2 +
      Math.cos(rad(br.latitude)) * Math.cos(rad(latitude)) * Math.sin(rad(longitude - br.longitude) / 2) ** 2;
    inside = 2 * R * Math.asin(Math.sqrt(a)) <= (br.radius_m || 100);
  }
  if (!inside && !note?.trim()) fail(400, 'You are outside the office area. Add a note saying where you are working.');
  const me = await q1('SELECT fingerprint_id FROM employees WHERE id=$1', [req.user.id]);
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await q(`INSERT INTO punches (fingerprint_id, employee_id, punched_at, source, note) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [me.fingerprint_id || 'E' + req.user.id, req.user.id, now, inside ? 'phone' : 'phone-field', note?.trim() || null]);
  res.json(await processDay(req.user.id, local(now).date));
}));

// ---------- Attendance ----------
const ATT = `a.*, e.full_name, e.employee_no, d.name AS department`;
api.get('/attendance', wrap(async (req, res) => {
  const id = +req.query.employee_id || req.user.id;
  if (!(await canSee(req.user, id))) fail(403, 'Not allowed');
  const to = isDate(req.query.to) ? req.query.to : today();
  const from = isDate(req.query.from) ? req.query.from : addDays(to, -30);
  res.json(await q('SELECT * FROM attendance WHERE employee_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date DESC', [id, from, to]));
}));
api.get('/attendance/today', allow('supervisor', 'hr', 'admin', 'management'), wrap(async (req, res) => {
  const depts = await visibleDepartments(req.user);
  const date = isDate(req.query.date) ? req.query.date : today();
  res.json(await q(`SELECT e.id AS employee_id, e.full_name, e.employee_no, d.name AS department,
      a.id, a.check_in, a.check_out, COALESCE(a.status, 'off') AS status, a.late_min, a.flag
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $2
    WHERE e.active AND ($1::int[] IS NULL OR e.department_id = ANY($1)) ORDER BY e.full_name`, [depts, date]));
}));
api.get('/attendance/exceptions', allow('supervisor', 'hr', 'admin'), wrap(async (req, res) => {
  const depts = await visibleDepartments(req.user);
  res.json(await q(`SELECT ${ATT} FROM attendance a JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE a.flag IS NOT NULL AND a.date >= $2 AND ($1::int[] IS NULL OR e.department_id = ANY($1))
    ORDER BY a.date DESC, e.full_name`, [depts, addDays(today(), -60)]));
}));

// One place for every manual change: HR edits, accepted exceptions and approved corrections.
async function setManual(user, empId, date, { check_in, check_out, status, note }, action) {
  const old = await q1('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2', [empId, date]);
  const inMin = hhmmToMin(check_in), outMin = hhmmToMin(check_out);
  let r;
  if (inMin != null) {
    if (outMin != null && outMin <= inMin) fail(400, 'Check-out must be after check-in');
    const sched = await scheduleFor(empId, date);
    r = computeRecord({ inAt: toUTC(date, inMin), outAt: outMin != null ? toUTC(date, outMin) : null,
      sched, holiday: false, leave: false, dayOver: false, s: await getSettings() });
    if (r.status === 'extra') r.status = 'present';
  } else {
    if (!['absent', 'leave', 'holiday', 'present'].includes(status)) fail(400, 'Give a check-in time or a status');
    r = { check_in: null, check_out: null, status, late_min: 0, early_min: 0, worked_min: 0, overtime_min: 0 };
  }
  const row = await q1(`INSERT INTO attendance (employee_id, date, check_in, check_out, status, late_min, early_min, worked_min, overtime_min, flag, manual, note)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,true,$10)
    ON CONFLICT (employee_id, date) DO UPDATE SET check_in=$3, check_out=$4, status=$5, late_min=$6, early_min=$7,
      worked_min=$8, overtime_min=$9, flag=NULL, manual=true, note=$10 RETURNING *`,
    [empId, date, r.check_in, r.check_out, r.status, r.late_min, r.early_min, r.worked_min, r.overtime_min, note]);
  await audit(user, action, 'attendance', row.id, old, row);
  return row;
}
api.post('/attendance', HR, wrap(async (req, res) => {
  const b = req.body;
  if (!b.employee_id || !isDate(b.date) || b.date > today()) fail(400, 'Choose an employee and a date that is not in the future');
  if (!b.note?.trim()) fail(400, 'A reason is required for a manual change');
  res.json(await setManual(req.user, +b.employee_id, b.date, { ...b, note: b.note.trim() }, 'manual-edit'));
}));
// Accept a flagged record as it is (for example a valid field check-in or an extra working day).
api.post('/attendance/:id/accept', allow('supervisor', 'hr', 'admin'), wrap(async (req, res) => {
  const a = await q1('SELECT * FROM attendance WHERE id=$1', [req.params.id]);
  if (!a || !(await canSee(req.user, a.employee_id)) || a.employee_id === req.user.id) fail(403, 'Not allowed');
  if (a.flag === 'missing_out') fail(400, 'A missing check-out needs a time. Use Fix instead.');
  const row = await q1('UPDATE attendance SET flag=NULL, manual=true, note=$2 WHERE id=$1 RETURNING *', [a.id, req.body.note || 'Accepted']);
  await audit(req.user, 'accept', 'attendance', a.id, a, row);
  res.json(row);
}));
api.post('/attendance/reprocess', HR, wrap(async (req, res) => {
  if (!isDate(req.body.from) || !isDate(req.body.to) || req.body.to < req.body.from) fail(400, 'Choose a valid date range');
  if (Date.parse(req.body.to) - Date.parse(req.body.from) > 62 * 864e5) fail(400, 'Recalculate at most two months at a time');
  await processRange(req.body.from, req.body.to);
  await audit(req.user, 'reprocess', 'attendance', null, null, req.body);
  res.json({ ok: true });
}));

// ---------- Corrections ----------
const approversFor = async empId => {
  const sup = await q1('SELECT d.supervisor_id AS id FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id=$1', [empId]);
  if (sup?.id && sup.id !== empId) return [sup.id];
  return (await q("SELECT id FROM employees WHERE role IN ('hr','admin') AND active AND id <> $1", [empId])).map(r => r.id);
};
api.post('/corrections', wrap(async (req, res) => {
  const b = req.body, s = await getSettings();
  if (!isDate(b.date) || b.date > today()) fail(400, 'Choose a date that is not in the future');
  if (b.date < addDays(today(), -(+s.correction_window_days + 2))) fail(400, `Corrections are accepted only within ${s.correction_window_days} working days`);
  if (hhmmToMin(b.requested_in) == null && hhmmToMin(b.requested_out) == null) fail(400, 'Give the correct check-in or check-out time');
  if (!b.reason?.trim()) fail(400, 'A reason is required');
  const r = await q1('INSERT INTO corrections (employee_id, date, requested_in, requested_out, reason) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.user.id, b.date, b.requested_in || null, b.requested_out || null, b.reason.trim()]);
  for (const id of await approversFor(req.user.id)) await notify(id, 'Attendance correction to review', `${req.user.full_name}, ${b.date}`);
  res.json(r);
}));
api.get('/corrections', wrap(async (req, res) => {
  const mine = req.query.scope !== 'pending';
  const depts = mine ? null : await visibleDepartments(req.user);
  res.json(await q(`SELECT c.*, e.full_name, d.name AS department FROM corrections c JOIN employees e ON e.id = c.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE ${mine ? 'c.employee_id = $2 AND $1::int[] IS NULL' : "c.status = 'pending' AND c.employee_id <> $2 AND ($1::int[] IS NULL OR e.department_id = ANY($1))"}
    ORDER BY c.created_at DESC LIMIT 200`, [depts, req.user.id]));
}));
api.post('/corrections/:id/decide', allow('supervisor', 'hr', 'admin'), wrap(async (req, res) => {
  const c = await q1("SELECT * FROM corrections WHERE id=$1 AND status='pending'", [req.params.id]);
  if (!c || c.employee_id === req.user.id || !(await canSee(req.user, c.employee_id))) fail(403, 'Not allowed');
  if (req.body.approve) {
    const a = await q1('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2', [c.employee_id, c.date]);
    const fmt = t => { if (!t) return null; const m = local(t).min; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
    await setManual(req.user, c.employee_id, c.date, {
      check_in: c.requested_in || fmt(a?.check_in), check_out: c.requested_out || fmt(a?.check_out),
      note: 'Correction: ' + c.reason }, 'correction-approved');
  }
  await q('UPDATE corrections SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1',
    [c.id, req.body.approve ? 'approved' : 'rejected', req.user.id, req.body.note || null]);
  await notify(c.employee_id, `Correction ${req.body.approve ? 'approved' : 'rejected'}`, `${c.date}${req.body.note ? ': ' + req.body.note : ''}`);
  res.json({ ok: true });
}));

// ---------- Leave ----------
api.get('/leave/balances', wrap(async (req, res) => {
  const id = +req.query.employee_id || req.user.id;
  if (!(await canSee(req.user, id))) fail(403, 'Not allowed');
  const year = +req.query.year || +today().slice(0, 4);
  const out = [];
  for (const t of await q('SELECT * FROM leave_types WHERE active ORDER BY id')) {
    const b = await getBalance(id, t, year);
    const p = await q1(`SELECT COALESCE(sum(days),0) AS n FROM leave_requests WHERE employee_id=$1 AND leave_type_id=$2
                        AND status='pending' AND EXTRACT(year FROM start_date) = $3`, [id, t.id, year]);
    out.push({ leave_type_id: t.id, name: t.name, paid: t.paid, entitled: b.entitled, used: b.used, pending: p.n, remaining: b.entitled - b.used - p.n });
  }
  res.json(out);
}));
api.put('/leave/balances', HR, wrap(async (req, res) => {
  const b = req.body;
  if (!(+b.entitled >= 0)) fail(400, 'Entitled days must be a number');
  const t = await q1('SELECT * FROM leave_types WHERE id=$1', [b.leave_type_id]);
  if (!t) fail(404, 'Leave type not found');
  const old = await getBalance(b.employee_id, t, +b.year);
  await q('UPDATE leave_balances SET entitled=$4 WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3', [b.employee_id, t.id, +b.year, +b.entitled]);
  await audit(req.user, 'update', 'leave-balance', b.employee_id, old, b);
  res.json({ ok: true });
}));
api.post('/leave/requests', wrap(async (req, res) => {
  const b = req.body;
  const empId = isHr(req.user) && b.employee_id ? +b.employee_id : req.user.id;
  if (!isDate(b.start_date) || !isDate(b.end_date) || b.end_date < b.start_date) fail(400, 'Choose a valid start and end date');
  if (Date.parse(b.end_date) - Date.parse(b.start_date) > 366 * 864e5) fail(400, 'The leave is too long');
  const t = await q1('SELECT * FROM leave_types WHERE id=$1 AND active', [b.leave_type_id]);
  if (!t) fail(400, 'Choose a leave type');
  if (await q1(`SELECT 1 FROM leave_requests WHERE employee_id=$1 AND status IN ('pending','approved')
                AND start_date <= $3 AND end_date >= $2`, [empId, b.start_date, b.end_date]))
    fail(400, 'These dates overlap another leave request');
  const days = await countLeaveDays(empId, b.start_date, b.end_date, t.calendar_days);
  if (!days) fail(400, 'There are no working days in this range');
  const year = +b.start_date.slice(0, 4);
  const bal = await getBalance(empId, t, year);
  const pending = (await q1(`SELECT COALESCE(sum(days),0) AS n FROM leave_requests WHERE employee_id=$1 AND leave_type_id=$2
                             AND status='pending' AND EXTRACT(year FROM start_date) = $3`, [empId, t.id, year])).n;
  const remaining = bal.entitled - bal.used - pending;
  if (days > remaining) fail(400, `Not enough ${t.name} leave: ${days} days requested, ${remaining} remaining`);
  const r = await q1('INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, days',
    [empId, t.id, b.start_date, b.end_date, days, b.reason?.trim() || null]);
  const who = await q1('SELECT full_name FROM employees WHERE id=$1', [empId]);
  for (const id of await approversFor(empId)) await notify(id, 'Leave request to review', `${who.full_name}: ${t.name}, ${b.start_date} to ${b.end_date} (${days} days)`);
  res.json(r);
}));
api.get('/leave/requests', wrap(async (req, res) => {
  const scope = req.query.scope || 'mine';
  const depts = scope === 'mine' ? null : await visibleDepartments(req.user);
  if (scope !== 'mine' && req.user.role === 'employee') fail(403, 'Not allowed');
  const where = scope === 'mine' ? 'r.employee_id = $2 AND $1::int[] IS NULL'
    : `($1::int[] IS NULL OR e.department_id = ANY($1)) ${scope === 'pending' ? "AND r.status = 'pending' AND r.employee_id <> $2" : 'AND $2 = $2'}`;
  res.json(await q(`SELECT r.*, e.full_name, d.name AS department, t.name AS leave_type, x.full_name AS decided_by_name
    FROM leave_requests r JOIN employees e ON e.id = r.employee_id JOIN leave_types t ON t.id = r.leave_type_id
    LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN employees x ON x.id = r.decided_by
    WHERE ${where} ORDER BY r.created_at DESC LIMIT 300`, [depts, req.user.id]));
}));
api.post('/leave/requests/:id/decide', allow('supervisor', 'hr', 'admin'), wrap(async (req, res) => {
  const r = await q1("SELECT * FROM leave_requests WHERE id=$1 AND status='pending'", [req.params.id]);
  if (!r || r.employee_id === req.user.id || !(await canSee(req.user, r.employee_id))) fail(403, 'Not allowed');
  const approve = !!req.body.approve;
  await q('UPDATE leave_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1',
    [r.id, approve ? 'approved' : 'rejected', req.user.id, req.body.note || null]);
  if (approve) {
    await q('UPDATE leave_balances SET used = used + $4 WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3',
      [r.employee_id, r.leave_type_id, +r.start_date.slice(0, 4), r.days]);
    await processRange(r.start_date, r.end_date, [r.employee_id]);
  }
  await audit(req.user, approve ? 'approve' : 'reject', 'leave-request', r.id, r, req.body);
  await notify(r.employee_id, `Leave ${approve ? 'approved' : 'rejected'}`, `${r.start_date} to ${r.end_date}${req.body.note ? ': ' + req.body.note : ''}`);
  res.json({ ok: true });
}));
api.post('/leave/requests/:id/cancel', wrap(async (req, res) => {
  const r = await q1('SELECT * FROM leave_requests WHERE id=$1', [req.params.id]);
  if (!r) fail(404, 'Not found');
  const own = r.employee_id === req.user.id && r.status === 'pending';
  if (!own && !(isHr(req.user) && ['pending', 'approved'].includes(r.status))) fail(403, 'Only a pending request can be cancelled');
  await q("UPDATE leave_requests SET status='cancelled' WHERE id=$1", [r.id]);
  if (r.status === 'approved') {
    await q('UPDATE leave_balances SET used = used - $4 WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3',
      [r.employee_id, r.leave_type_id, +r.start_date.slice(0, 4), r.days]);
    await processRange(r.start_date, r.end_date, [r.employee_id]);
  }
  await audit(req.user, 'cancel', 'leave-request', r.id, r);
  res.json({ ok: true });
}));
api.get('/leave/calendar', allow('supervisor', 'hr', 'admin', 'management'), wrap(async (req, res) => {
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const depts = await visibleDepartments(req.user);
  res.json(await q(`SELECT r.id, r.start_date, r.end_date, r.status, e.full_name, d.name AS department, t.name AS leave_type
    FROM leave_requests r JOIN employees e ON e.id = r.employee_id JOIN leave_types t ON t.id = r.leave_type_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE r.status IN ('approved','pending') AND r.start_date <= ($2::text || '-01')::date + interval '1 month' - interval '1 day'
      AND r.end_date >= ($2::text || '-01')::date AND ($1::int[] IS NULL OR e.department_id = ANY($1))
    ORDER BY r.start_date`, [depts, m]));
}));

// ---------- Dashboards and reports ----------
api.get('/dashboard/me', wrap(async (req, res) => {
  const t = today();
  res.json({
    date: t,
    today: await processDay(req.user.id, t),
    schedule: await scheduleFor(req.user.id, t),
    month: await q1(`SELECT count(*) FILTER (WHERE status IN ('present','late','half_day','extra'))::int AS worked,
        count(*) FILTER (WHERE status IN ('late','half_day'))::int AS late, count(*) FILTER (WHERE status='absent')::int AS absent,
        count(*) FILTER (WHERE status='leave')::int AS leave, COALESCE(sum(worked_min),0)::int AS worked_min
      FROM attendance WHERE employee_id=$1 AND date >= $2 AND date <= $3`, [req.user.id, t.slice(0, 8) + '01', t]),
    unread: (await q1('SELECT count(*)::int AS n FROM notifications WHERE employee_id=$1 AND read_at IS NULL', [req.user.id])).n,
  });
}));
async function monthlyRows(user, query) {
  const depts = await visibleDepartments(user);
  const to = isDate(query.to) ? query.to : today();
  const from = isDate(query.from) ? query.from : to.slice(0, 8) + '01';
  const rows = await q(`SELECT e.employee_no, e.full_name, d.name AS department,
      count(a.id) FILTER (WHERE a.status IN ('present','late','half_day','extra'))::int AS days_worked,
      count(a.id) FILTER (WHERE a.status = 'late')::int AS late_days,
      count(a.id) FILTER (WHERE a.status = 'half_day')::int AS half_days,
      count(a.id) FILTER (WHERE a.status = 'absent')::int AS absent_days,
      count(a.id) FILTER (WHERE a.status = 'leave')::int AS leave_days,
      COALESCE(sum(a.late_min),0)::int AS late_min, COALESCE(sum(a.early_min),0)::int AS early_min,
      COALESCE(sum(a.worked_min),0)::int AS worked_min, COALESCE(sum(a.overtime_min),0)::int AS overtime_min,
      count(a.id) FILTER (WHERE a.flag IS NOT NULL)::int AS open_exceptions
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.date BETWEEN $2 AND $3
    WHERE e.active AND ($1::int[] IS NULL OR e.department_id = ANY($1)) AND ($4::int IS NULL OR e.department_id = $4)
    GROUP BY e.id, d.name ORDER BY d.name NULLS LAST, e.full_name`, [depts, from, to, +query.department_id || null]);
  const unpaid = await q(`SELECT e.employee_no, COALESCE(sum(r.days),0) AS n FROM leave_requests r JOIN employees e ON e.id = r.employee_id
    JOIN leave_types t ON t.id = r.leave_type_id WHERE r.status='approved' AND NOT t.paid AND r.start_date BETWEEN $1 AND $2
    GROUP BY e.employee_no`, [from, to]);
  const u = Object.fromEntries(unpaid.map(r => [r.employee_no, r.n]));
  return { from, to, rows: rows.map(r => ({ ...r, unpaid_leave_days: u[r.employee_no] || 0 })) };
}
const REPORT = allow('supervisor', 'hr', 'admin', 'management');
api.get('/reports/monthly', REPORT, wrap(async (req, res) => res.json(await monthlyRows(req.user, req.query))));
api.get('/reports/monthly.xlsx', REPORT, wrap(async (req, res) => {
  const { from, to, rows } = await monthlyRows(req.user, req.query);
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Attendance');
  const hours = m => Math.round(m / 6) / 10;
  ws.columns = [
    ['Employee ID', 'employee_no', 14], ['Name', 'full_name', 28], ['Department', 'department', 22],
    ['Days worked', 'days_worked', 12], ['Late days', 'late_days', 10], ['Half days', 'half_days', 10],
    ['Absent days', 'absent_days', 12], ['Leave days', 'leave_days', 11], ['Unpaid leave days', 'unpaid_leave_days', 16],
    ['Late minutes', 'late_min', 13], ['Early-leave minutes', 'early_min', 18], ['Hours worked', 'worked_h', 13], ['Overtime hours', 'overtime_h', 14],
  ].map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow({ ...r, worked_h: hours(r.worked_min), overtime_h: hours(r.overtime_min) });
  ws.addRow([]); ws.addRow([`Period: ${from} to ${to}`]);
  await audit(req.user, 'export', 'report', null, null, { from, to });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

// Small numbers shown beside the menu items, so people see at a glance where work is waiting.
api.get('/counts', wrap(async (req, res) => {
  if (req.user.role === 'employee' || req.user.role === 'management') return res.json({ exceptions: 0, approvals: 0 });
  const depts = await visibleDepartments(req.user);
  const one = async (sql, extra = []) => (await q1(sql, [depts, ...extra])).n;
  res.json({
    exceptions: await one(`SELECT count(*)::int AS n FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.flag IS NOT NULL AND a.date >= $2 AND ($1::int[] IS NULL OR e.department_id = ANY($1))`, [addDays(today(), -60)]),
    approvals: await one(`SELECT (SELECT count(*) FROM leave_requests r JOIN employees e ON e.id = r.employee_id
        WHERE r.status = 'pending' AND r.employee_id <> $2 AND ($1::int[] IS NULL OR e.department_id = ANY($1)))::int
      + (SELECT count(*) FROM corrections c JOIN employees e ON e.id = c.employee_id
        WHERE c.status = 'pending' AND c.employee_id <> $2 AND ($1::int[] IS NULL OR e.department_id = ANY($1)))::int AS n`, [req.user.id]),
  });
}));

// ---------- Notifications and audit ----------
api.get('/notifications', wrap(async (req, res) => res.json(await q('SELECT * FROM notifications WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]))));
api.post('/notifications/read', wrap(async (req, res) => { await q('UPDATE notifications SET read_at = now() WHERE employee_id=$1 AND read_at IS NULL', [req.user.id]); res.json({ ok: true }); }));
api.get('/audit', HR, wrap(async (req, res) => res.json(await q(`SELECT a.*, e.full_name AS user_name FROM audit_log a
  LEFT JOIN employees e ON e.id = a.user_id ORDER BY a.id DESC LIMIT 300`))));
