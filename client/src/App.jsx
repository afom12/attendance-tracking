import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, store, getToken, usePrefs, Field, ErrorNote, useAction } from './lib.jsx';
import Home from './pages/Home.jsx';
import { MyAttendance, MyLeave } from './pages/Mine.jsx';
import { TeamToday, Approvals, Exceptions } from './pages/Team.jsx';
import Employees from './pages/Employees.jsx';
import { Reports, LeaveCalendar } from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/exceptions', label: 'Exceptions', roles: ['hr', 'admin'] },
  { to: '/', label: 'Home' },
  { to: '/attendance', label: 'My attendance' },
  { to: '/leave', label: 'My leave' },
  { to: '/team', label: 'Team today', roles: ['supervisor', 'hr', 'admin', 'management'] },
  { to: '/approvals', label: 'Approvals', roles: ['supervisor', 'hr', 'admin'] },
  { to: '/employees', label: 'Employees', roles: ['hr', 'admin'] },
  { to: '/leave-calendar', label: 'Leave calendar', roles: ['supervisor', 'hr', 'admin', 'management'] },
  { to: '/reports', label: 'Reports', roles: ['supervisor', 'hr', 'admin', 'management'] },
  { to: '/settings', label: 'Settings', roles: ['hr', 'admin'] },
];

function PrefSwitches() {
  const { lang, setLang, eth, setEth } = usePrefs();
  return (
    <div className="switches">
      <button className="ghost" onClick={() => setLang(lang === 'en' ? 'am' : 'en')} title="Language">{lang === 'en' ? 'አማርኛ' : 'English'}</button>
      <button className="ghost" onClick={() => setEth(!eth)} title="Calendar and clock">{eth ? 'Ethiopian date & time ✓' : 'Ethiopian date & time'}</button>
    </div>
  );
}

function Login({ onDone }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ username: '', password: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { const r = await api('/auth/login', { method: 'POST', body: f }); store.set('token', r.token); onDone(); }); };
  return (
    <main className="login">
      <form onSubmit={submit} className="card">
        <p className="brand">Trade Ethiopia</p>
        <h1>Attendance</h1>
        <Field label={t('Employee ID or email')}><input autoFocus autoComplete="username" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} required /></Field>
        <Field label={t('Password')}><input type="password" autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required /></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <button className="primary" disabled={act.busy}>{t('Log in')}</button>
        <PrefSwitches />
      </form>
    </main>
  );
}

export function ChangePassword({ forced, onDone }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const act = useAction();
  const submit = e => {
    e.preventDefault();
    if (f.next !== f.again) return act.setError('The two new passwords do not match');
    act.run(async () => { await api('/auth/change-password', { method: 'POST', body: f }); onDone(); });
  };
  return (
    <form onSubmit={submit} className={forced ? 'card' : 'form'}>
      {forced && <><h1>{t('Change password')}</h1><p className="hint">Choose your own password before you continue. Use at least 8 characters.</p></>}
      <Field label="Current password"><input type="password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} required /></Field>
      <Field label="New password"><input type="password" minLength={8} value={f.next} onChange={e => setF({ ...f, next: e.target.value })} required /></Field>
      <Field label="New password again"><input type="password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} required /></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>{t('Save')}</button>
    </form>
  );
}

export default function App() {
  const { t } = usePrefs();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const load = () => getToken() ? api('/me').then(setUser).catch(() => setUser(null)).finally(() => setReady(true)) : (setUser(null), setReady(true));
  useEffect(() => { load(); }, []);
  if (!ready) return null;
  if (!user) return <Login onDone={load} />;
  if (user.must_change_password) return <main className="login"><ChangePassword forced onDone={load} /></main>;

  const links = NAV.filter(n => !n.roles || n.roles.includes(user.role));
  const can = path => links.some(n => n.to === path);
  const logout = () => { store.set('token', null); setUser(null); };
  const hr = user.role === 'hr' || user.role === 'admin';
  return (
    <div className="shell">
      <aside className={menu ? 'open' : ''}>
        <p className="brand">Trade Ethiopia<span>Attendance</span></p>
        <nav onClick={() => setMenu(false)}>
          {links.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'}>{t(n.label)}</NavLink>)}
        </nav>
        <div className="who">
          <strong>{user.full_name}</strong>
          <span>{user.employee_no} · {user.role}</span>
          <PrefSwitches />
          <button className="ghost" onClick={logout}>{t('Log out')}</button>
        </div>
      </aside>
      <button className="menu-btn ghost" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
      <main>
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/attendance" element={<MyAttendance />} />
          <Route path="/leave" element={<MyLeave user={user} />} />
          {can('/team') && <Route path="/team" element={<TeamToday />} />}
          {can('/approvals') && <Route path="/approvals" element={<Approvals />} />}
          {can('/exceptions') && <Route path="/exceptions" element={<Exceptions />} />}
          {can('/employees') && <Route path="/employees" element={<Employees user={user} />} />}
          {can('/leave-calendar') && <Route path="/leave-calendar" element={<LeaveCalendar />} />}
          {can('/reports') && <Route path="/reports" element={<Reports />} />}
          {can('/settings') && <Route path="/settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to={hr ? '/exceptions' : '/'} replace />} />
        </Routes>
      </main>
    </div>
  );
}
