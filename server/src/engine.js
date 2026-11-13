// Attendance rules: turns raw fingerprint punches into one attendance record per employee per day.
import { q, q1, getSettings } from './db.js';
import { local, toUTC, weekdayOf, addDays, today } from './util.js';

// The schedule row for an employee on a date, or null when it is not a working day for them.
// An employee with any personal days (part-time staff) uses only those days.
export async function scheduleFor(empId, date) {
  const wd = weekdayOf(date);
  const custom = await q('SELECT * FROM employee_days WHERE employee_id=$1', [empId]);
  if (custom.length) return custom.find(r => r.weekday === wd) || null;
  return q1(`SELECT sd.* FROM shift_days sd JOIN employees e ON e.shift_id = sd.shift_id
             WHERE e.id=$1 AND sd.weekday=$2`, [empId, wd]);
}

// Pure calculation, shared by automatic processing and HR manual edits.
export function computeRecord({ inAt, outAt, sched, holiday, leave, dayOver, s }) {
  const r = { check_in: inAt, check_out: outAt, status: 'present', late_min: 0, early_min: 0, worked_min: 0, overtime_min: 0, flag: null };
  const inMin = local(inAt).min;
  if (!sched || holiday || leave) { r.status = 'extra'; r.flag = 'unscheduled'; }
  else {
    const late = inMin - sched.start_min;
    if (late > +s.grace_min) { r.late_min = late; r.status = late >= +s.half_day_min ? 'half_day' : 'late'; }
  }
  if (outAt) {
    const outMin = local(outAt).date === local(inAt).date ? local(outAt).min : 1440;
    let worked = outMin - inMin;
    if (sched && sched.break_start != null)
      worked -= Math.max(0, Math.min(outMin, sched.break_end) - Math.max(inMin, sched.break_start));
    r.worked_min = Math.max(0, worked);
    if (sched && r.status !== 'extra') {
      const early = sched.end_min - outMin;
      if (early > +s.early_tolerance_min) r.early_min = early;
      const ot = outMin - sched.end_min;
      if (ot >= +s.overtime_min) r.overtime_min = ot;
    }
  } else if (dayOver) r.flag = r.flag || 'missing_out';
  return r;
}

export async function processDay(empId, date, s) {
  s = s || await getSettings();
  const emp = await q1('SELECT id, hire_date, active, left_on, track_attendance FROM employees WHERE id=$1', [empId]);
  if (!emp) return null;
  const existing = await q1('SELECT * FROM attendance WHERE employee_id=$1 AND date=$2', [empId, date]);
  if (existing?.manual) return existing;           // HR edits are never overwritten
  const nowL = local(new Date());
  const sched = await scheduleFor(empId, date);
  const rows = await q('SELECT punched_at, source FROM punches WHERE employee_id=$1 AND punched_at >= $2 AND punched_at < $3 ORDER BY punched_at',
    [empId, toUTC(date, 0), toUTC(date, 1440)]);
  // Ignore repeat punches: keep a punch only if it is far enough from the last kept one.
  const times = [];
  for (const { punched_at } of rows)
    if (!times.length || punched_at - times.at(-1) >= +s.dedupe_min * 60000) times.push(punched_at);
  const holiday = !!(await q1('SELECT 1 FROM holidays WHERE date=$1', [date]));
  const leave = !!(await q1(`SELECT 1 FROM leave_requests WHERE employee_id=$1 AND status='approved'
                             AND start_date <= $2 AND end_date >= $2`, [empId, date]));
  const dayOver = date < nowL.date || (date === nowL.date && nowL.min >= (sched ? sched.end_min : 1440));

  let r;
  if (times.length) {
    r = computeRecord({ inAt: times[0], outAt: times.length > 1 ? times.at(-1) : null, sched, holiday, leave, dayOver, s });
    // A phone check-in made outside the office is shown to HR for review.
    if (!r.flag && rows.some(p => p.source === 'phone-field')) r.flag = 'field';
  } else {
    let status;
    if (leave) status = 'leave';
    else if (holiday) status = 'holiday';
    // Someone who has left keeps their record up to their last day; nothing is added after it.
    else if (!sched || date > nowL.date || (emp.hire_date && date < emp.hire_date) ||
             (!emp.active && (!emp.left_on || date > emp.left_on)) || !emp.track_attendance) status = null;
    else status = dayOver ? 'absent' : 'not_in';
    if (!status) { if (existing) await q('DELETE FROM attendance WHERE id=$1', [existing.id]); return null; }
    r = { check_in: null, check_out: null, status, late_min: 0, early_min: 0, worked_min: 0, overtime_min: 0, flag: null };
  }
  return q1(`INSERT INTO attendance (employee_id, date, check_in, check_out, status, late_min, early_min, worked_min, overtime_min, flag)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (employee_id, date) DO UPDATE SET check_in=$3, check_out=$4, status=$5, late_min=$6,
               early_min=$7, worked_min=$8, overtime_min=$9, flag=$10 RETURNING *`,
    [empId, date, r.check_in, r.check_out, r.status, r.late_min, r.early_min, r.worked_min, r.overtime_min, r.flag]);
}

export async function processRange(from, to, empIds) {
  const s = await getSettings();
  const ids = empIds || (await q('SELECT id FROM employees WHERE active AND track_attendance')).map(r => r.id);
  const last = to > today() ? today() : to;
  for (let d = from; d <= last; d = addDays(d, 1))
    for (const id of ids) await processDay(id, d, s);
}

// Store punches (skipping exact duplicates), link them to employees, and recalculate the affected days.
export async function ingestPunches(list, { deviceId = null, source = 'device', note = null } = {}) {
  let saved = 0, unknown = 0;
  const touched = new Set();
  for (const p of list) {
    if (!p.fingerprint_id || !(p.at instanceof Date) || isNaN(p.at)) continue;
    const emp = await q1('SELECT id FROM employees WHERE fingerprint_id=$1', [String(p.fingerprint_id)]);
    const row = await q1(`INSERT INTO punches (device_id, fingerprint_id, employee_id, punched_at, source, note)
                          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (fingerprint_id, punched_at) DO NOTHING RETURNING id`,
      [deviceId, String(p.fingerprint_id), emp?.id ?? null, p.at, source, note]);
    if (!row) continue;
    saved++;
    if (emp) touched.add(emp.id + '|' + local(p.at).date); else unknown++;
  }
  const s = await getSettings();
  for (const key of touched) { const [id, date] = key.split('|'); await processDay(+id, date, s); }
  if (deviceId) await q('UPDATE devices SET last_sync_at = now() WHERE id=$1', [deviceId]);
  return { received: list.length, saved, unknown };
}

// Working days in a range for one employee (their scheduled days, minus holidays).
export async function countLeaveDays(empId, start, end, calendarDays) {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (calendarDays) { n++; continue; }
    if (await q1('SELECT 1 FROM holidays WHERE date=$1', [d])) continue;
    if (await scheduleFor(empId, d)) n++;
  }
  return n;
}

// Leave balance for a year, created on first use. Annual leave is pro-rated for part-time staff.
export async function getBalance(empId, type, year) {
  const found = await q1('SELECT * FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3', [empId, type.id, year]);
  if (found) return found;
  let entitled = type.days_per_year;
  if (type.is_annual) {
    const s = await getSettings();
    const emp = await q1('SELECT hire_date, shift_id FROM employees WHERE id=$1', [empId]);
    if (s.annual_extra_day_every_2_years === 'true' && emp.hire_date) {
      const years = year - +emp.hire_date.slice(0, 4);
      if (years > 1) entitled += Math.floor((years - 1) / 2);
    }
    const own = (await q1('SELECT count(*)::int AS n FROM employee_days WHERE employee_id=$1', [empId])).n;
    const full = (await q1('SELECT count(*)::int AS n FROM shift_days WHERE shift_id=$1', [emp.shift_id])).n;
    if (own && full && own < full) entitled = Math.round(entitled * own / full * 2) / 2;
    // Starting part-way through a year earns that share of the year (the month of starting counts).
    if (s.annual_prorate_first_year === 'true' && emp.hire_date && +emp.hire_date.slice(0, 4) === year)
      entitled = Math.round(entitled * (13 - +emp.hire_date.slice(5, 7)) / 12 * 2) / 2;
    // Unused days from last year move over, up to the limit HR has set.
    const carry = +s.carry_over_max_days;
    if (carry > 0) {
      const last = await q1('SELECT entitled, used FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3', [empId, type.id, year - 1]);
      if (last) entitled += Math.min(carry, Math.max(0, last.entitled - last.used));
    }
  }
  // Two requests can ask for the same new balance at once; the second one reads what the first wrote.
  return (await q1(`INSERT INTO leave_balances (employee_id, leave_type_id, year, entitled) VALUES ($1,$2,$3,$4)
                    ON CONFLICT DO NOTHING RETURNING *`, [empId, type.id, year, entitled]))
    || q1('SELECT * FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3', [empId, type.id, year]);
}
