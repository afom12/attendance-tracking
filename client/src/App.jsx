import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, store, getToken, usePrefs, Field, ErrorNote, useAction, Avatar, Modal, Icon, Brand, PasswordInput, ThemePicker } from './lib.jsx';
import Home from './pages/Home.jsx';
import { MyAttendance, MyLeave } from './pages/Mine.jsx';
import { TeamToday, Approvals, Exceptions } from './pages/Team.jsx';
import Employees from './pages/Employees.jsx';
import { Reports, LeaveCalendar } from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Notifications from './pages/Notifications.jsx';
import Dashboard from './pages/Dashboard.jsx';

const TEAM = ['supervisor', 'hr', 'admin', 'management'], DECIDE = ['supervisor', 'hr', 'admin', 'management'], HR = ['hr', 'admin'];
const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'grid', roles: TEAM }] },
  { group: 'Me', items: [
    { to: '/', label: 'Home', icon: 'home', notRoles: TEAM, personal: true },
    { to: '/me', label: 'My day', icon: 'home', roles: TEAM, personal: true },
    { to: '/attendance', label: 'My attendance', icon: 'clock', personal: true },
    { to: '/leave', label: 'My leave', icon: 'plane', personal: true },
    { to: '/notifications', label: 'Notifications', icon: 'bell', count: 'notifications' }] },
  { group: 'Team', items: [
    { to: '/team', label: 'Team today', icon: 'users', roles: TEAM },
    { to: '/approvals', label: 'Approvals', icon: 'check', roles: DECIDE, count: 'approvals' },
    { to: '/leave-calendar', label: 'Leave calendar', icon: 'calendar', roles: TEAM }] },
  { group: 'HR', items: [
    { to: '/exceptions', label: 'Exceptions', icon: 'alert', roles: HR, count: 'exceptions' },
    { to: '/employees', label: 'Employees', icon: 'id', roles: HR, count: 'people' },
    { to: '/reports', label: 'Reports', icon: 'chart', roles: TEAM },
    { to: '/settings', label: 'Settings', icon: 'sliders', roles: HR }] },
];
const ROLE = { employee: 'Employee', supervisor: 'Supervisor', hr: 'HR officer', admin: 'Administrator', management: 'Management' };

function PrefSwitches({ menu }) {
  const { lang, setLang, eth, setEth } = usePrefs();
  const items = [
    ['globe', lang === 'en' ? 'አማርኛ' : 'English', () => setLang(lang === 'en' ? 'am' : 'en')],
    ['calendar', eth ? 'International date and time' : 'Ethiopian date and time', () => setEth(!eth)],
  ];
  return items.map(([icon, label, fn]) => <button key={icon} className="link" onClick={fn}>{menu && <Icon name={icon} />}{label}</button>);
}

function ThemeToggle() {
  const { isDark, toggleTheme } = usePrefs();
  return <button className="icon" onClick={toggleTheme} aria-label={isDark ? 'Switch to light screen' : 'Switch to dark screen'}><Icon name={isDark ? 'sun' : 'moon'} /></button>;
}

function Login({ onDone }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ username: '', password: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { const r = await api('/auth/login', { method: 'POST', body: f }); store.set('token', r.token); onDone(); }); };
  return (
    <main className="login">
      <div className="pitch">
        <Brand />
        <h1>Your working day, <em>recorded for you.</em></h1>
        <div className="points">
          <span><Icon name="finger" />Touch the reader when you arrive and when you leave</span>
          <span><Icon name="plane" />Ask for leave and see your balance at any time</span>
          <span><Icon name="bell" />Hear back from your supervisor the moment they decide</span>
        </div>
      </div>
      <form onSubmit={submit}>
        <div><h2>{t('Log in')}</h2><p className="hint">Welcome back. Use the employee ID HR gave you.</p></div>
        <Field label={t('Employee ID or email')}><input autoFocus autoComplete="username" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} required /></Field>
        <Field label={t('Password')}><PasswordInput autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required /></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <button className="primary" disabled={act.busy}>{act.busy ? 'Logging in…' : t('Log in')}</button>
        <small style={{ textAlign: 'center' }}>Forgot your password? Ask HR to set a new one for you.</small>
        <div className="switches"><PrefSwitches /></div>
        <ThemePicker />
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
  const strength = f.next.length >= 12 ? 3 : f.next.length >= 8 ? 2 : f.next ? 1 : 0;
  return (
    <form onSubmit={submit} className="form">
      {forced && <><Brand /><div><h2>Choose your own password</h2><p className="hint">You logged in with a temporary password. Pick one only you know, with at least 8 characters.</p></div></>}
      <Field label={forced ? 'Temporary password' : 'Current password'}><PasswordInput autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} required /></Field>
      <Field label="New password"><PasswordInput autoComplete="new-password" minLength={8} value={f.next} onChange={e => setF({ ...f, next: e.target.value })} required />
        {strength > 0 && <div className="meter" style={{ maxWidth: 'none', marginTop: '.4rem' }}><i className={strength === 1 ? 'bad' : strength === 2 ? 'warn' : ''} style={{ width: `${strength * 33.4}%` }} /></div>}
        <small>{['', 'Too short', 'Good', 'Strong'][strength]}</small></Field>
      <Field label="New password again"><PasswordInput autoComplete="new-password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} required /></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <button className="primary" disabled={act.busy}>{t('Save')} password</button>
    </form>
  );
}

export default function App() {
  const { t } = usePrefs();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const [password, setPassword] = useState(false);
  const [counts, setCounts] = useState({});
  const location = useLocation();
  const load = () => getToken() ? api('/me').then(setUser).catch(() => setUser(null)).finally(() => setReady(true)) : (setUser(null), setReady(true));
  useEffect(() => { load(); }, []);
  const loadCounts = () => api('/counts').then(setCounts).catch(() => {});
  useEffect(() => { if (user && !user.must_change_password) loadCounts(); setMenu(false); setMeOpen(false); }, [user, location.pathname]);
  // New notifications arrive while the app is open (reminders run every 10 minutes), so check now and then.
  useEffect(() => { if (!user || user.must_change_password) return; const id = setInterval(loadCounts, 120000); return () => clearInterval(id); }, [user]);
  if (!ready) return null;
  if (!user) return <Login onDone={load} />;
  if (user.must_change_password) return <main className="login single"><ChangePassword forced onDone={load} /></main>;

  // A login that is not a person at work (the built-in administrator) has nothing personal to show.
  const tracked = user.track_attendance !== false;
  const groups = NAV.map(g => ({ ...g, items: g.items.filter(n => (!n.roles || n.roles.includes(user.role)) && !n.notRoles?.includes(user.role) && (!n.personal || tracked)) })).filter(g => g.items.length);
  const can = path => groups.some(g => g.items.some(n => n.to === path));
  const logout = () => { store.set('token', null); setUser(null); };
  const waiting = (counts.notifications || 0) + (counts.approvals || 0);
  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <span className="top-actions"><ThemeToggle /><span className="menu-wrap"><button className="icon" onClick={() => setMenu(true)} aria-label="Menu"><Icon name="menu" /></button>
        {waiting > 0 && <span className="count">{waiting}</span>}</span></span>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <aside className={menu ? 'open' : ''}>
        <Brand />
        <nav>
          {groups.map(g => (
            <section key={g.group}>
              {groups.length > 1 && <h3>{g.group}</h3>}
              {g.items.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{t(n.label)}{counts[n.count] > 0 && <span className="count">{counts[n.count]}</span>}</NavLink>)}
            </section>
          ))}
        </nav>
        <div className="me">
          {meOpen && <div className="me-menu">
            <p className="menu-label">Screen</p>
            <ThemePicker />
            <hr />
            <PrefSwitches menu />
            <hr />
            <button className="link" onClick={() => { setPassword(true); setMeOpen(false); }}><Icon name="key" />{t('Change password')}</button>
            <button className="link" onClick={logout}><Icon name="logout" />{t('Log out')}</button>
          </div>}
          <button onClick={() => setMeOpen(!meOpen)} aria-expanded={meOpen}>
            <Avatar name={user.full_name} /><span className="who"><strong>{user.full_name}</strong><small>{tracked ? ROLE[user.role] : 'System account'}</small></span><span className="chev" aria-hidden="true">⋯</span>
          </button>
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={TEAM.includes(user.role) ? <Dashboard user={user} /> : tracked ? <Home user={user} onRead={loadCounts} /> : <Navigate to="/notifications" replace />} />
          {tracked && <Route path="/me" element={<Home user={user} onRead={loadCounts} />} />}
          <Route path="/notifications" element={<Notifications onRead={loadCounts} />} />
          {tracked && <Route path="/attendance" element={<MyAttendance />} />}
          {tracked && <Route path="/leave" element={<MyLeave />} />}
          {can('/team') && <Route path="/team" element={<TeamToday />} />}
          {can('/approvals') && <Route path="/approvals" element={<Approvals />} />}
          {can('/exceptions') && <Route path="/exceptions" element={<Exceptions />} />}
          {can('/employees') && <Route path="/employees" element={<Employees user={user} />} />}
          {can('/leave-calendar') && <Route path="/leave-calendar" element={<LeaveCalendar />} />}
          {can('/reports') && <Route path="/reports" element={<Reports />} />}
          {can('/settings') && <Route path="/settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {password && <Modal title={t('Change password')} onClose={() => setPassword(false)}><ChangePassword onDone={() => setPassword(false)} /></Modal>}
    </div>
  );
}
