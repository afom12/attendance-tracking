import jwt from 'jsonwebtoken';
import { q, q1 } from './db.js';

// All business dates and times are East Africa Time (UTC+3, no daylight saving).
const TZ_MIN = 180;
export const local = d => {
  const t = new Date(new Date(d).getTime() + TZ_MIN * 60000);
  return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes(), weekday: t.getUTCDay() };
};
export const toUTC = (date, min) => new Date(Date.parse(date + 'T00:00:00Z') + (min - TZ_MIN) * 60000);
export const today = () => local(new Date()).date;
export const weekdayOf = date => new Date(date + 'T00:00:00Z').getUTCDay();
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const hhmmToMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
// "YYYY-MM-DD HH:MM[:SS]" written in local (EAT) time -> Date
export const parseLocal = s => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec((s || '').trim());
  if (!m || !isDate(m[1])) return null;
  return new Date(toUTC(m[1], +m[2] * 60 + +m[3]).getTime() + (+(m[4] || 0)) * 1000);
};

export const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
export const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' });

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

export const auth = wrap(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  let id;
  try { id = jwt.verify(token, SECRET).id; } catch { fail(401, 'Please log in'); }
  const u = await q1('SELECT id, employee_no, full_name, role, department_id, shift_id, active, must_change_password, track_attendance FROM employees WHERE id=$1', [id]);
  if (!u || !u.active) fail(401, 'Account is not active');
  // FR-02: with a temporary password, the only thing a user may do is choose their own.
  if (u.must_change_password && !['/me', '/auth/change-password'].includes(req.path))
    fail(403, 'Choose your own password first');
  req.user = u;
  next();
});
export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission for this'));
export const isHr = u => u.role === 'hr' || u.role === 'admin';

// Departments a user may see: all for HR/admin/management, own supervised ones for supervisors.
export async function visibleDepartments(u) {
  if (isHr(u) || u.role === 'management') return null; // null = all
  const rows = await q('SELECT id FROM departments WHERE supervisor_id=$1', [u.id]);
  return rows.map(r => r.id);
}
export async function canSee(u, employeeId) {
  if (u.id === +employeeId) return true;
  const depts = await visibleDepartments(u);
  if (depts === null) return true;
  const e = await q1('SELECT department_id FROM employees WHERE id=$1', [employeeId]);
  return !!e && depts.includes(e.department_id);
}
export const audit = (user, action, entity, entityId, oldValue = null, newValue = null) =>
  q('INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6)',
    [user?.id ?? null, action, entity, entityId == null ? null : String(entityId),
     oldValue && JSON.stringify(oldValue), newValue && JSON.stringify(newValue)]);
// A key makes the notification one-off: the same key sent to the same person again does nothing.
// A link is the screen the notification opens.
export const notify = (employeeId, title, body = '', { key = null, link = null } = {}) =>
  q(`INSERT INTO notifications (employee_id, title, body, key, link) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (employee_id, key) WHERE key IS NOT NULL DO NOTHING`, [employeeId, title, body, key, link]);
// Calendar months, clamped to the month end: 31 Dec + 2 months = 28 (or 29) Feb.
export const addMonths = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
