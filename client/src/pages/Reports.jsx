import { useState } from 'react';
import { useLoad, usePrefs, Page, Empty, hours, todayISO, getToken } from '../lib.jsx';

export function Reports() {
  const { t, fmtDate } = usePrefs();
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01');
  const [to, setTo] = useState(todayISO());
  const [dept, setDept] = useState('');
  const [setup] = useLoad('/setup');
  const qs = `from=${from}&to=${to}&department_id=${dept}`;
  const [data] = useLoad(`/reports/monthly?${qs}`);
  const rows = data?.rows;
  const open = rows?.reduce((n, r) => n + r.open_exceptions, 0) || 0;
  return (
    <Page title={t('Reports')} hint={`${fmtDate(from)} – ${fmtDate(to)}. One line per employee, ready for payroll.`}
      actions={<>
        <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} aria-label="From" />
        <input type="date" value={to} min={from} max={todayISO()} onChange={e => e.target.value && setTo(e.target.value)} aria-label="To" />
        <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{setup?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <button onClick={() => window.print()}>Print</button>
        <a className="button primary" href={`/api/reports/monthly.xlsx?${qs}&token=${getToken()}`}>Excel</a>
      </>}>
      {open > 0 && <p className="notice">{open} day(s) in this period still have an open exception. Fix them before using these numbers for payroll.</p>}
      {rows?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>ID</th><th>{t('Name')}</th><th>{t('Department')}</th><th className="num">Worked</th><th className="num">Late</th><th className="num">Half</th><th className="num">Absent</th><th className="num">Leave</th><th className="num">Unpaid leave</th><th className="num">Late min</th><th className="num">Hours</th><th className="num">Overtime h</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.employee_no}><td>{r.employee_no}</td><td>{r.full_name}</td><td>{r.department}</td><td className="num">{r.days_worked}</td><td className="num">{r.late_days || ''}</td><td className="num">{r.half_days || ''}</td>
            <td className="num">{r.absent_days || ''}</td><td className="num">{r.leave_days || ''}</td><td className="num">{r.unpaid_leave_days || ''}</td><td className="num">{r.late_min || ''}</td><td className="num">{hours(r.worked_min)}</td><td className="num">{r.overtime_min ? hours(r.overtime_min) : ''}</td></tr>)}</tbody>
        </table></div>
      ) : rows && <Empty>No employees in this selection.</Empty>}
    </Page>
  );
}

export function LeaveCalendar() {
  const { t, fmtDate } = usePrefs();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [rows] = useLoad(`/leave/calendar?month=${month}`);
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return (
    <Page title={t('Leave calendar')} hint="Who is off on each day. Lighter cells are still waiting for approval."
      actions={<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" />}>
      {rows?.length ? (
        <div className="table-wrap"><table className="cal">
          <thead><tr><th>{t('Name')}</th>{days.map(d => <th key={d} className={[0].includes(new Date(d).getUTCDay()) ? 'rest' : ''}>{+d.slice(8)}</th>)}</tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td>{r.full_name}<small> {r.leave_type}</small></td>
            {days.map(d => { const on = d >= r.start_date && d <= r.end_date; return <td key={d} className={on ? 'on ' + r.status : ''} title={on ? `${r.full_name}: ${r.leave_type}, ${fmtDate(r.start_date)} – ${fmtDate(r.end_date)} (${r.status})` : undefined}></td>; })}</tr>)}</tbody>
        </table></div>
      ) : rows && <Empty>Nobody has leave in this month.</Empty>}
    </Page>
  );
}
