import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
export const getToken = () => store.get('token');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && getToken()) { store.set('token', null); window.location.reload(); }
  const json = (res.headers.get('content-type') || '').includes('application/json');
  const data = json ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new Error(data.error || (res.status === 404
    ? 'The server does not know this request. If the system was just updated, restart the server.'
    : res.status >= 500 || res.status === 0 ? 'The server could not be reached. Check that it is running.' : `Request failed (${res.status})`));
  // An HTML page instead of data means the request never reached the API (an old server or a wrong address).
  if (!json) throw new Error('The server answered with a web page instead of data. Restart the server so it has the latest version.');
  return data;
}
// Load data for a page; returns [data, reload, error].
export function useLoad(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null });
  const reload = useCallback(() => {
    if (!path) return;
    api(path).then(data => setState({ data, error: null })).catch(e => setState({ data: null, error: e.message }));
  }, [path]);
  useEffect(reload, [reload, ...deps]);
  return [state.data, reload, state.error];
}

// ---------- Language, Ethiopian calendar and Ethiopian clock ----------
const AM = {
  'Home': 'መነሻ', 'My attendance': 'የእኔ መገኘት', 'My leave': 'የእኔ ፈቃድ', 'Team today': 'የዛሬ ቡድን',
  'Approvals': 'ማጽደቂያዎች', 'Exceptions': 'ልዩ ሁኔታዎች', 'Employees': 'ሠራተኞች', 'Leave calendar': 'የፈቃድ ቀን መቁጠሪያ',
  'Reports': 'ሪፖርቶች', 'Settings': 'ቅንብሮች', 'Log out': 'ውጣ', 'Log in': 'ግባ', 'Password': 'የይለፍ ቃል',
  'Employee ID or email': 'የሠራተኛ መለያ ወይም ኢሜይል', 'Present': 'ተገኝቷል', 'Late': 'ዘግይቷል', 'Absent': 'ቀሪ',
  'On leave': 'በፈቃድ ላይ', 'Holiday': 'በዓል', 'Half day': 'ግማሽ ቀን', 'Not in yet': 'ገና አልገባም', 'Day off': 'የዕረፍት ቀን',
  'Extra day': 'ተጨማሪ ቀን', 'Check-in': 'መግቢያ', 'Check-out': 'መውጫ', 'Date': 'ቀን', 'Status': 'ሁኔታ',
  'Request leave': 'ፈቃድ ጠይቅ', 'Approve': 'አጽድቅ', 'Reject': 'ውድቅ አድርግ', 'Save': 'አስቀምጥ', 'Cancel': 'ሰርዝ',
  'Reason': 'ምክንያት', 'Department': 'ክፍል', 'Name': 'ስም', 'Today': 'ዛሬ', 'Remaining': 'የቀረ', 'Days': 'ቀናት',
  'This month': 'በዚህ ወር', 'Days worked': 'የሠሩ ቀናት', 'Leave balance': 'የፈቃድ ቀሪ', 'Notifications': 'ማሳወቂያዎች',
  'Hours worked': 'የሥራ ሰዓት', 'From': 'ከ', 'To': 'እስከ', 'Leave type': 'የፈቃድ ዓይነት', 'Request correction': 'እርማት ጠይቅ',
  'Check in by phone': 'በስልክ ግባ', 'Change password': 'የይለፍ ቃል ቀይር', 'Pending': 'በመጠባበቅ ላይ',
  'Approved': 'ጸድቋል', 'Rejected': 'ውድቅ ተደርጓል', 'Cancelled': 'ተሰርዟል', 'Audit log': 'የኦዲት መዝገብ',
};
const ET_MONTHS = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'];
const ET_MONTHS_AM = ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜን'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Gregorian 'YYYY-MM-DD' -> Ethiopian { year, month (1-13), day }
export function toEthiopian(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  const r = (jdn - 1723856) % 1461, n = (r % 365) + 365 * Math.floor(r / 1460);
  return { year: 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460), month: Math.floor(n / 30) + 1, day: (n % 30) + 1 };
}
// A timestamp shown in East Africa Time, whatever the device's own time zone is.
const eat = ts => new Date(new Date(ts).getTime() + 3 * 36e5);
export const minToHHMM = m => m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const hours = min => (Math.round(min / 6) / 10).toFixed(1);

const Prefs = createContext(null);
export function PrefsProvider({ children }) {
  const [lang, setLangState] = useState(store.get('lang', 'en'));
  const [eth, setEthState] = useState(store.get('eth', '0') === '1');
  const setLang = v => { store.set('lang', v); setLangState(v); };
  const setEth = v => { store.set('eth', v ? '1' : '0'); setEthState(v); };
  // Theme: 'light' or 'dark' when chosen, otherwise follow the device.
  const [theme, setThemeState] = useState(store.get('theme', ''));
  useEffect(() => { if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme; }, [theme]);
  // Follow the device live when no theme is chosen (for example when the phone switches to dark at night).
  const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [deviceDark, setDeviceDark] = useState(!!media?.matches);
  useEffect(() => { if (!media) return; const on = e => setDeviceDark(e.matches); media.addEventListener('change', on); return () => media.removeEventListener('change', on); }, []);
  const isDark = theme ? theme === 'dark' : deviceDark;
  const setTheme = v => { store.set('theme', v || null); setThemeState(v || ''); };   // 'light', 'dark' or '' for the device
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');
  const t = s => (lang === 'am' && AM[s]) || s;
  const fmtDate = iso => {
    if (!iso) return '';
    iso = String(iso).slice(0, 10);
    const wd = t(WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()]).slice(0, 3);
    if (eth) { const e = toEthiopian(iso); return `${wd} ${e.day} ${(lang === 'am' ? ET_MONTHS_AM : ET_MONTHS)[e.month - 1]} ${e.year}`; }
    const [y, m, d] = iso.split('-').map(Number);
    return `${wd} ${d} ${EN_MONTHS[m - 1]} ${y}`;
  };
  const clock = min => {
    if (min == null) return '—';
    const h = Math.floor(min / 60), mm = String(min % 60).padStart(2, '0');
    if (!eth) return `${String(h).padStart(2, '0')}:${mm}`;
    const night = h < 6 || h >= 18;                       // Ethiopian clock: 6:00 international = 12:00
    return `${((h + 6) % 12) || 12}:${mm} ${night ? (lang === 'am' ? 'ማታ' : 'night') : (lang === 'am' ? 'ቀን' : 'day')}`;
  };
  const fmtTime = ts => { if (!ts) return '—'; const d = eat(ts); return clock(d.getUTCHours() * 60 + d.getUTCMinutes()); };
  const fmtStamp = ts => ts ? `${fmtDate(eat(ts).toISOString())} ${fmtTime(ts)}` : '—';
  return <Prefs.Provider value={{ lang, setLang, eth, setEth, theme, setTheme, isDark, toggleTheme, t, fmtDate, fmtTime, fmtStamp, clock }}>{children}</Prefs.Provider>;
}
export const usePrefs = () => useContext(Prefs);
export const todayISO = () => eat(Date.now()).toISOString().slice(0, 10);
export const nowMin = () => { const d = eat(Date.now()); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const minOf = ts => { if (!ts) return null; const d = eat(ts); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

// ---------- Small shared pieces ----------
export const STATUS = {
  present: 'Present', late: 'Late', half_day: 'Half day', absent: 'Absent', leave: 'On leave', holiday: 'Holiday',
  not_in: 'Not in yet', off: 'Day off', extra: 'Extra day',
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};
export function Chip({ status }) {
  const { t } = usePrefs();
  return <span className={'status status-' + status}>{t(STATUS[status] || status)}</span>;
}
export function Avatar({ name = '' }) {
  const parts = name.trim().split(/\s+/);
  const hue = [...name].reduce((n, c, i) => n + c.charCodeAt(0) * (i + 3), 0) % 5;
  return <span className={'avatar hue-' + hue} aria-hidden="true">{(parts[0]?.[0] || '') + (parts[1]?.[0] || '')}</span>;
}
// Line icons, drawn on a 24px grid. One stroke weight everywhere so the set reads as one family.
const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z" />,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>,
  alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  id: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10.5" r="2.5" /><path d="M5.5 16.5a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M8 17v-5M12.5 17V8M17 17v-8" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  download: <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  phone: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18h2" /></>,
  plane: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  hourglass: <><path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4" /></>,
  finger: <><path d="M12 11v3a8 8 0 0 1-1.6 4.8" /><path d="M8.5 7.6A5 5 0 0 1 17 11v1.5" /><path d="M7 11a5 5 0 0 1 .3-1.7" /><path d="M7 14.5c0 1.6-.4 3-1.2 4.2" /><path d="M15.2 15.5a13 13 0 0 1-1.1 4.3" /><path d="M4.6 8.4a9 9 0 0 1 15.6.6" /><path d="M20.6 13a14 14 0 0 1-.4 3" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5" rx="2" /><rect x="13.5" y="11" width="7.5" height="10" rx="2" /><rect x="3" y="15" width="7.5" height="6" rx="2" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></>,
  monitor: <><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};
export const Icon = ({ name }) => <svg className="i" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
// A number with a label, for dashboards. Pass onClick to make it a filter.
export function Stat({ label, value, unit, sub, icon, tone, on, onClick }) {
  const body = <>
    <span className="top">{label}{icon && <span className="ic"><Icon name={icon} /></span>}</span>
    <span className="value">{value}{unit && <small>{unit}</small>}</span>
    {sub && <span className="sub">{sub}</span>}
  </>;
  const cls = 'stat' + (tone ? ' ' + tone : '') + (on ? ' on' : '');
  return onClick ? <button className={cls} onClick={onClick} aria-pressed={!!on}>{body}</button> : <div className={cls}>{body}</div>;
}
export const Brand = () => (
  <div className="brand"><span className="mark"><Icon name="finger" /></span><span><b>Trade Ethiopia</b><span>Attendance</span></span></div>
);

// A panel that slides in from the right: one task at a time, the list stays visible behind it.
export function Drawer({ title, subtitle, avatar, onClose, children }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay side" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header><div className="who">{avatar && <Avatar name={avatar} />}<div><h2>{title}</h2>{subtitle && <p className="hint">{subtitle}</p>}</div></div><button className="icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
        {children}
      </div>
    </div>
  );
}
export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">{tabs.map(x => <button key={x} role="tab" aria-selected={value === x} className={value === x ? 'on' : ''} onClick={() => onChange(x)}>{x}</button>)}</div>
);
export function Page({ title, hint, actions, wide, children }) {
  return (
    <section className={'page' + (wide ? ' wide' : '')}>
      <header className="page-head">
        <div><h1>{title}</h1>{hint && <p className="hint">{hint}</p>}</div>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
        {children}
      </div>
    </div>
  );
}
// A password box with an eye button to show or hide what is typed.
export function PasswordInput({ value, onChange, ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="pw">
      <input {...rest} type={shown ? 'text' : 'password'} value={value} onChange={onChange} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw-eye" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} title={shown ? 'Hide password' : 'Show password'}>
        <Icon name={shown ? 'eyeOff' : 'eye'} />
      </button>
    </span>
  );
}
// Light, dark, or whatever the device uses.
export function ThemePicker() {
  const { theme, setTheme } = usePrefs();
  const opts = [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['', 'monitor', 'Device']];
  return (
    <div className="theme-pick" role="radiogroup" aria-label="Screen theme">
      {opts.map(([v, icon, label]) => <button key={label} type="button" role="radio" aria-checked={theme === v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}><Icon name={icon} />{label}</button>)}
    </div>
  );
}
export const Field = ({ label, children, wide }) => <label className={'field' + (wide ? ' wide' : '')}><span>{label}</span>{children}</label>;
export const ErrorNote = ({ children }) => children ? <p className="error" role="alert">{children}</p> : null;
export const Empty = ({ children }) => <p className="empty">{children}</p>;
// Runs an action, shows its error, and tells the caller when it worked.
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async fn => {
    setError(''); setBusy(true);
    try { await fn(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  return { error, busy, run, setError };
}
