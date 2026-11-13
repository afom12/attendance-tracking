// Who decides whose requests. One rule, used for leave and for attendance corrections,
// so the answer shown to the employee is always the one the server enforces.
//
//   1. The supervisor of the person's department decides.
//   2. If that supervisor is away on approved leave today, HR can decide as well.
//   3. Nobody decides for themselves. A supervisor's own requests, and those of people in a
//      department without a supervisor, go to HR.
//   4. Requests from HR officers and administrators go to management and to the other HR people.
//   5. If that leaves nobody, management decides. If there is still nobody, the request is refused
//      when it is sent, with the reason, instead of waiting for ever.
import { q, q1 } from './db.js';
import { today, isHr } from './util.js';

export async function approversOf(empId) {
  const e = await q1(`SELECT e.id, e.role, d.supervisor_id FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = $1`, [empId]);
  if (!e) return { list: [], via: 'none' };
  const people = (roles) => q(`SELECT id, full_name, role FROM employees WHERE active AND role = ANY($1) AND id <> $2 ORDER BY full_name`, [roles, e.id]);
  const sup = e.supervisor_id && e.supervisor_id !== e.id
    ? await q1(`SELECT s.id, s.full_name, s.role, EXISTS (SELECT 1 FROM leave_requests r WHERE r.employee_id = s.id AND r.status = 'approved'
          AND r.start_date <= $2 AND r.end_date >= $2) AS away FROM employees s WHERE s.id = $1 AND s.active`, [e.supervisor_id, today()])
    : null;
  const hr = await people(['hr', 'admin']), management = await people(['management']);
  const senior = ['hr', 'admin', 'management'].includes(e.role);
  let list, via;
  if (sup && !sup.away) { list = [sup]; via = 'supervisor'; }
  else if (sup) { list = [sup, ...hr.filter(x => x.id !== sup.id)]; via = 'supervisor_away'; }
  else if (senior) { list = [...management, ...hr]; via = 'senior'; }
  else { list = hr; via = 'hr'; }
  if (!list.length) { list = management; via = 'management'; }
  return { list: list.map(({ id, full_name }) => ({ id, full_name })), via: list.length ? via : 'none' };
}

// May this user decide a request from this employee? HR always can, except for their own.
export async function canDecide(user, empId) {
  if (user.id === +empId) return false;
  if (isHr(user)) return true;
  return (await approversOf(empId)).list.some(a => a.id === user.id);
}

export const NO_APPROVER = 'Nobody is set up to decide your requests yet. An administrator needs to choose a supervisor for your department, or add a manager or a second HR officer.';
