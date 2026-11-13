// Automatic reminders, run by the scheduler. Each has a key, so a person gets it once only.
import { q } from './db.js';
import { today, addDays, daysBetween, notify } from './util.js';
import { approversOf } from './approvals.js';

// Working days absent in a row, up to now, with no leave (holidays and days off do not break the run).
// `e` is the employees alias in the surrounding query.
export const ABSENT_STREAK = e => `(SELECT count(*)::int FROM attendance a WHERE a.employee_id = ${e}.id AND a.status = 'absent'
  AND a.date > COALESCE((SELECT max(b.date) FROM attendance b WHERE b.employee_id = ${e}.id
                         AND b.status NOT IN ('absent', 'not_in', 'holiday')), '1900-01-01'))`;

// The people who look after an employee: their supervisor, and HR. HR opens the employee; a supervisor opens Team today.
async function caretakers(empId) {
  const rows = await q(`SELECT d.supervisor_id AS id, 'supervisor' AS role FROM employees e JOIN departments d ON d.id = e.department_id
      WHERE e.id = $1 AND d.supervisor_id IS NOT NULL
    UNION SELECT id, role FROM employees WHERE role IN ('hr', 'admin') AND active`, [empId]);
  const seen = new Map();
  for (const r of rows) if (r.id !== empId && (!seen.has(r.id) || r.role !== 'supervisor')) seen.set(r.id, r.role);
  return [...seen].map(([id, role]) => ({ id, link: role === 'supervisor' ? '/team' : `/employees?open=${empId}` }));
}
export async function tellCaretakers(empId, title, body, key = null) {
  for (const c of await caretakers(empId)) await notify(c.id, title, body, { key, link: c.link });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function probationAlerts(s) {
  const t = today();
  const rows = await q(`SELECT id, full_name, probation_end FROM employees
    WHERE active AND employment_status = 'probation' AND probation_end IS NOT NULL AND probation_end <= $1`,
    [addDays(t, +s.probation_alert_days)]);
  for (const e of rows) {
    const left = daysBetween(t, e.probation_end);
    // Only the most urgent stage, so a first run on an overdue probation does not send three messages.
    const stage = left <= 0 ? 'due' : left <= 3 ? 'final' : 'soon';
    const when = left < 0 ? `ended ${plural(-left, 'day')} ago` : left === 0 ? 'ends today' : `ends in ${plural(left, 'day')}`;
    await tellCaretakers(e.id, left <= 0 ? 'Probation decision needed' : 'Probation ending soon',
      `${e.full_name}: probation ${when} (${e.probation_end}). Confirm them as permanent, or end the employment.`,
      `probation-${stage}-${e.probation_end}-${e.id}`);
    if (stage === 'soon') await notify(e.id, 'Your probation ends soon',
      `Your probation period ends on ${e.probation_end}. HR will let you know their decision.`, { key: `probation-own-${e.probation_end}`, link: '/' });
  }
}

export async function absenceAlerts(s) {
  const n = +s.absence_alert_days;
  if (!(n > 0)) return;
  const rows = await q(`SELECT * FROM (SELECT e.id, e.full_name, ${ABSENT_STREAK('e')} AS days FROM employees e WHERE e.active AND e.track_attendance) x WHERE days >= $1`, [n]);
  for (const e of rows) {
    const first = (await q(`SELECT min(date) AS d FROM (SELECT date FROM attendance WHERE employee_id = $1 AND status = 'absent'
      ORDER BY date DESC LIMIT $2) x`, [e.id, e.days]))[0].d;
    await tellCaretakers(e.id, 'Absent several days in a row',
      `${e.full_name} has been absent ${plural(e.days, 'working day')} in a row since ${first}, with no leave. Check on them, or mark them as no longer working here.`,
      `absent-${first}-${e.id}`);
  }
}

// A request nobody has decided after a few days is chased: the approvers are reminded, and HR is
// told too so it can step in (the approver may be away or simply not looking).
export async function waitingAlerts(s) {
  const days = +s.approval_reminder_days;
  if (!(days > 0)) return;
  const cutoff = new Date(Date.now() - days * 864e5);
  const waiting = [
    ...(await q(`SELECT 'leave' AS kind, r.id, r.employee_id, e.full_name, t.name || ' leave, ' || r.start_date || ' to ' || r.end_date AS what
      FROM leave_requests r JOIN employees e ON e.id = r.employee_id JOIN leave_types t ON t.id = r.leave_type_id
      WHERE r.status = 'pending' AND r.created_at < $1`, [cutoff])),
    ...(await q(`SELECT 'correction' AS kind, c.id, c.employee_id, e.full_name, 'attendance correction for ' || c.date AS what
      FROM corrections c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'pending' AND c.created_at < $1`, [cutoff])),
  ];
  const hr = await q(`SELECT id FROM employees WHERE active AND role IN ('hr', 'admin')`);
  for (const w of waiting) {
    const approvers = (await approversOf(w.employee_id)).list;
    const key = `waiting-${w.kind}-${w.id}`, body = `${w.full_name}: ${w.what}. Waiting more than ${plural(days, 'day')}.`;
    for (const a of approvers) await notify(a.id, 'A request is still waiting for you', body, { key, link: '/approvals' });
    for (const h of hr) if (h.id !== w.employee_id && !approvers.some(a => a.id === h.id))
      await notify(h.id, 'A request has had no decision', `${body} It is with ${approvers.map(a => a.full_name).join(', ') || 'nobody'}; HR can decide it instead.`, { key, link: '/approvals' });
  }
}

export async function runAlerts(s) {
  await probationAlerts(s);
  await absenceAlerts(s);
  await waitingAlerts(s);
}
