import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';

pg.types.setTypeParser(1082, v => v);            // date -> 'YYYY-MM-DD' string
pg.types.setTypeParser(1700, v => Number(v));    // numeric -> number

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = async (text, params = []) => (await pool.query(text, params)).rows;
export const q1 = async (text, params = []) => (await q(text, params))[0] || null;

// Default rules; HR changes them in Settings.
export const DEFAULT_SETTINGS = {
  grace_min: '10',            // minutes after start before a check-in is late
  half_day_min: '120',        // late by this much or more = half day
  early_tolerance_min: '10',
  overtime_min: '30',         // minimum minutes after end that count as overtime
  dedupe_min: '2',            // repeat punches inside this window are ignored
  correction_window_days: '3',
  annual_extra_day_every_2_years: 'false',
  device_alert_min: '30',
  probation_months: '2',      // new employees start on probation for this long
  probation_alert_days: '14', // HR is reminded this many days before a probation ends
  absence_alert_days: '3',    // absent this many working days in a row without leave: HR and supervisor are alerted
  annual_leave_during_probation: 'false', // annual leave opens once the probation is confirmed
  annual_prorate_first_year: 'true',      // someone who starts in October gets 3/12 of the year's annual leave
  carry_over_max_days: '0',               // unused annual leave days moved into the next year (0 = none)
  approval_reminder_days: '2',            // a request waiting this long is chased, and HR is told
};
// Settings that are yes/no rather than numbers.
export const BOOLEAN_SETTINGS = ['annual_extra_day_every_2_years', 'annual_leave_during_probation', 'annual_prorate_first_year'];

export async function getSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export async function initDb() {
  await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS))
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [k, v]);
  // Once, on upgrade: the built-in administrator is a login, not a person at work. Its empty days are removed.
  if (!(await q1("SELECT 1 FROM settings WHERE key = 'system_account_done'"))) {
    const sys = await q("UPDATE employees SET track_attendance = false WHERE employee_no = 'ADMIN' AND full_name = 'System Administrator' AND fingerprint_id IS NULL RETURNING id");
    for (const a of sys) await q("DELETE FROM attendance WHERE employee_id = $1 AND check_in IS NULL AND NOT manual AND status IN ('absent', 'not_in')", [a.id]);
    await q("INSERT INTO settings (key, value) VALUES ('system_account_done', '1') ON CONFLICT DO NOTHING");
  }
  if (await q1('SELECT 1 FROM employees LIMIT 1')) return;

  // First run: the confirmed Trade Ethiopia defaults.
  const branch = await q1("INSERT INTO branches (name) VALUES ('Head Office') RETURNING id");
  const shift = await q1("INSERT INTO shifts (name) VALUES ('Standard') RETURNING id");
  // 8:45-17:30 (2:45-11:30 Ethiopian time), lunch 12:30-13:30, Monday to Friday
  for (const wd of [1, 2, 3, 4, 5])
    await q('INSERT INTO shift_days VALUES ($1,$2,$3,$4,$5,$6)', [shift.id, wd, 525, 1050, 750, 810]);
  // Saturday half day 8:45-12:30
  await q('INSERT INTO shift_days VALUES ($1,6,525,750,NULL,NULL)', [shift.id]);
  const dept = await q1("INSERT INTO departments (branch_id, name) VALUES ($1, 'Human Resources') RETURNING id", [branch.id]);
  // Leave types: annual is confirmed (16 days). The others are starting values HR must confirm.
  const types = [
    ['Annual', 16, true, false, false, true], ['Sick', 180, true, true, true, false],
    ['Maternity', 120, true, true, true, false], ['Paternity', 3, true, false, false, false],
    ['Marriage', 3, true, false, false, false], ['Bereavement', 3, true, false, false, false],
    ['Unpaid', 10, false, false, false, false],
  ];
  for (const t of types)
    await q('INSERT INTO leave_types (name, days_per_year, paid, requires_attachment, calendar_days, is_annual) VALUES ($1,$2,$3,$4,$5,$6)', t);
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ChangeMe123', 10);
  await q(`INSERT INTO employees (employee_no, full_name, role, department_id, shift_id, hire_date, password_hash, track_attendance)
           VALUES ('ADMIN', 'System Administrator', 'admin', $1, $2, CURRENT_DATE, $3, false)`, [dept.id, shift.id, hash]);
  console.log('Database initialised. Log in as ADMIN with the ADMIN_PASSWORD value.');
}
