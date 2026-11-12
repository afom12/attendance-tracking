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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
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
  return <Prefs.Provider value={{ lang, setLang, eth, setEth, t, fmtDate, fmtTime, fmtStamp, clock }}>{children}</Prefs.Provider>;
}
export const usePrefs = () => useContext(Prefs);
export const todayISO = () => eat(Date.now()).toISOString().slice(0, 10);

// ---------- Small shared pieces ----------
export const STATUS = {
  present: 'Present', late: 'Late', half_day: 'Half day', absent: 'Absent', leave: 'On leave', holiday: 'Holiday',
  not_in: 'Not in yet', off: 'Day off', extra: 'Extra day',
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};
export function Chip({ status }) {
  const { t } = usePrefs();
  return <span className={'chip chip-' + status}>{t(STATUS[status] || status)}</span>;
}
export function Page({ title, hint, actions, children }) {
  return (
    <section className="page">
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
        <header><h2>{title}</h2><button className="ghost" onClick={onClose} aria-label="Close">✕</button></header>
        {children}
      </div>
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
