import { useState } from 'react';
import { useLoad, usePrefs, Page, Empty, hours, todayISO, getToken } from '../lib.jsx';

const monthRange = offset => {
  const [y, m] = todayISO().split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1)), last = new Date(Date.UTC(y, m + offset, 0));
  const iso = d => d.toISOString().slice(0, 10);
  return { from: iso(first), to: offset === 0 ? todayISO() : iso(last) };
};

export function Reports() {
  const { t, fmtDate } = usePrefs();
  const [period, setPeriod] = useState('this');
  const [custom, setCustom] = useState(monthRange(0));
  const [dept, setDept] = useState('');
  const [setup] = useLoad('/setup');
  const { from, to } = period === 'this' ? monthRange(0) : period === 'last' ? monthRange(-1) : custom;
  const qs = `from=${from}&to=${to}&department_id=${dept}`;
  const [data] = useLoad(`/reports/monthly?${qs}`);
  const rows = data?.rows;
  const open = rows?.reduce((n, r) => n + r.open_exceptions, 0) || 0;
  return (
    <Page wide title={t('Reports')} hint={`${fmtDate(from)} to ${fmtDate(to)}. The Excel file adds late minutes, half days and unpaid leave for payroll.`}
      actions={<a className="button primary" href={`/api/reports/monthly.xlsx?${qs}&token=${getToken()}`}>Download Excel</a>}>
      <div className="filters">
        <button className={period === 'this' ? 'on' : ''} onClick={() => setPeriod('this')}>This month</button>
        <button className={period === 'last' ? 'on' : ''} onClick={() => setPeriod('last')}>Last month</button>
        <button className={period === 'custom' ? 'on' : ''} onClick={() => setPeriod('custom')}>Other dates</button>
        {period === 'custom' && <>
          <input type="date" value={custom.from} max={custom.to} onChange={e => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="From" />
          <input type="date" value={custom.to} min={custom.from} max={todayISO()} onChange={e => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="To" />
        </>}
        <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{setup?.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </div>
      {open > 0 && <p className="notice" style={{ marginBottom: '1.5rem' }}>{open} {open === 1 ? 'day still has' : 'days still have'} an open exception in this period. Clear them before using these numbers for payroll.</p>}
      {rows?.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>{t('Name')}</th><th className="num">Days worked</th><th className="num">Late</th><th className="num">Absent</th><th className="num">On leave</th><th className="num">Hours</th><th className="num">Overtime</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.employee_no}><td><strong>{r.full_name}</strong><small>{r.department}</small></td><td className="num">{r.days_worked}</td><td className="num">{r.late_days + r.half_days || '–'}</td>
            <td className="num">{r.absent_days || '–'}</td><td className="num">{r.leave_days || '–'}</td><td className="num">{hours(r.worked_min)}</td><td className="num">{r.overtime_min ? hours(r.overtime_min) : '–'}</td></tr>)}</tbody>
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
    <Page wide title={t('Leave calendar')} hint="Who is away on each day. Paler bars are still waiting for approval."
      actions={<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" />}>
      {rows?.length ? (
        <div className="table-wrap"><table className="cal">
          <thead><tr><th></th>{days.map(d => <th key={d} className={new Date(d).getUTCDay() === 0 ? 'rest' : ''}>{+d.slice(8)}</th>)}</tr></thead>
          <tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.full_name}</strong><small>{r.leave_type}</small></td>
            {days.map(d => { const on = d >= r.start_date && d <= r.end_date; return <td key={d} className={on ? `on ${r.status}${d === r.start_date || d === days[0] ? ' first' : ''}${d === r.end_date || d === days.at(-1) ? ' last' : ''}` : ''} title={on ? `${r.full_name}: ${r.leave_type}, ${fmtDate(r.start_date)} to ${fmtDate(r.end_date)}` : undefined}></td>; })}</tr>)}</tbody>
        </table></div>
      ) : rows && <Empty>Nobody is away in this month.</Empty>}
    </Page>
  );
}
