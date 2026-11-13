import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, store, getToken, usePrefs, Field, ErrorNote, useAction, Avatar, Modal } from './lib.jsx';
import Home from './pages/Home.jsx';
import { MyAttendance, MyLeave } from './pages/Mine.jsx';
import { TeamToday, Approvals, Exceptions } from './pages/Team.jsx';
import Employees from './pages/Employees.jsx';
import { Reports, LeaveCalendar } from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const TEAM = ['supervisor', 'hr', 'admin', 'management'], DECIDE = ['supervisor', 'hr', 'admin'], HR = ['hr', 'admin'];
const NAV = [
  { group: 'Me', items: [{ to: '/', label: 'Home' }, { to: '/attendance', label: 'My attendance' }, { to: '/leave', label: 'My leave' }] },
  { group: 'Team', items: [{ to: '/team', label: 'Team today', roles: TEAM }, { to: '/approvals', label: 'Approvals', roles: DECIDE, count: 'approvals' }, { to: '/leave-calendar', label: 'Leave calendar', roles: TEAM }] },
  { group: 'HR', items: [{ to: '/exceptions', label: 'Exceptions', roles: HR, count: 'exceptions' }, { to: '/employees', label: 'Employees', roles: HR }, { to: '/reports', label: 'Reports', roles: TEAM }, { to: '/settings', label: 'Settings', roles: HR }] },
];
const ROLE = { employee: 'Employee', supervisor: 'Supervisor', hr: 'HR officer', admin: 'Administrator', management: 'Management' };

function PrefSwitches() {
  const { lang, setLang, eth, setEth } = usePrefs();
  return (<>
    <button className="link" onClick={() => setLang(lang === 'en' ? 'am' : 'en')}>{lang === 'en' ? 'አማርኛ' : 'English'}</button>
    <button className="link" onClick={() => setEth(!eth)}>{eth ? 'International date and time' : 'Ethiopian date and time'}</button>
  </>);
}

function Login({ onDone }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ username: '', password: '' });
  const act = useAction();
  const submit = e => { e.preventDefault(); act.run(async () => { const r = await api('/auth/login', { method: 'POST', body: f }); store.set('token', r.token); onDone(); }); };
  return (
    <main className="login">
      <div className="pitch">
        <p>Trade Ethiopia</p>
        <h1>Your working day, recorded for you.</h1>
        <small>Touch the fingerprint reader when you arrive and when you leave. The rest happens here.</small>
      </div>
      <form onSubmit={submit}>
        <h2>{t('Log in')}</h2>
        <Field label={t('Employee ID or email')}><input autoFocus autoComplete="username" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} required /></Field>
        <Field label={t('Password')}><input type="password" autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required /></Field>
        <ErrorNote>{act.error}</ErrorNote>
        <button className="primary" disabled={act.busy}>{t('Log in')}</button>
        <small>Forgot your password? Ask HR to set a new one for you.</small>
        <div className="switches"><PrefSwitches /></div>
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
    <form onSubmit={submit} className="form">
      {forced && <><h2>Choose your own password</h2><p className="hint">You logged in with a temporary password. Pick one only you know, with at least 8 characters.</p></>}
      <Field label={forced ? 'Temporary password' : 'Current password'}><input type="password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} required /></Field>
      <Field label="New password"><input type="password" minLength={8} value={f.next} onChange={e => setF({ ...f, next: e.target.value })} required /></Field>
      <Field label="New password again"><input type="password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} required /></Field>
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
  // Refresh the "work waiting" numbers whenever the person moves to another screen.
  useEffect(() => { if (user && !user.must_change_password) api('/counts').then(setCounts).catch(() => {}); setMenu(false); setMeOpen(false); }, [user, location.pathname]);
  if (!ready) return null;
  if (!user) return <Login onDone={load} />;
  if (user.must_change_password) return <main className="login single"><ChangePassword forced onDone={load} /></main>;

  const groups = NAV.map(g => ({ ...g, items: g.items.filter(n => !n.roles || n.roles.includes(user.role)) })).filter(g => g.items.length);
  const can = path => groups.some(g => g.items.some(n => n.to === path));
  const logout = () => { store.set('token', null); setUser(null); };
  return (
    <div className="shell">
      <aside className={menu ? 'open' : ''}>
        <p className="brand">Trade Ethiopia<span>Attendance</span></p>
        <nav>
          {groups.map(g => (
            <section key={g.group}>
              {groups.length > 1 && <h3>{g.group}</h3>}
              {g.items.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'}>{t(n.label)}{counts[n.count] > 0 && <span className="count">{counts[n.count]}</span>}</NavLink>)}
            </section>
          ))}
        </nav>
        <div className="me">
          {meOpen && <div className="me-menu">
            <PrefSwitches />
            <button className="link" onClick={() => { setPassword(true); setMeOpen(false); }}>{t('Change password')}</button>
            <button className="link" onClick={logout}>{t('Log out')}</button>
          </div>}
          <button onClick={() => setMeOpen(!meOpen)} aria-expanded={meOpen}>
            <Avatar name={user.full_name} /><span><strong>{user.full_name}</strong><small>{ROLE[user.role]}</small></span>
          </button>
        </div>
      </aside>
      <button className="menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
      <main>
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/attendance" element={<MyAttendance />} />
          <Route path="/leave" element={<MyLeave />} />
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
