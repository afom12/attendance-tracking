import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useLoad, usePrefs, Page, Modal, Field, ErrorNote, useAction, hours, nowMin, minOf, Icon, Stat } from '../lib.jsx';
import { NoteList } from './Notifications.jsx';
import { approverLine } from './Mine.jsx';

// A new employee sees how far through their probation they are.
function Probation({ e }) {
  const { fmtDate } = usePrefs();
  if (e?.employment_status !== 'probation' || e.probation_days_left == null) return null;
  const left = e.probation_days_left;
  const total = e.hire_date ? Math.max(1, Math.round((Date.parse(e.probation_end) - Date.parse(e.hire_date)) / 864e5)) : 0;
  const done = total ? Math.min(total, Math.max(0, total - left)) : 0;
  return (
    <div className="status-card probation-home">
      <p className="label">Your probation</p>
      <p className="big">{left > 0 ? `${left} ${left === 1 ? 'day' : 'days'} left` : 'Complete, waiting for HR’s decision'}</p>
      {total > 0 && <div className="meter"><i style={{ width: `${done / total * 100}%` }} /></div>}
      <small>Ends on {fmtDate(e.probation_end)}. Good attendance helps. HR will tell you here when you are confirmed.</small>
    </div>
  );
}

function PhoneCheckIn({ onClose, onDone }) {
  const [note, setNote] = useState('');
  const act = useAction();
  const send = () => act.run(async () => {
    const pos = await new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(p => resolve(p.coords), () => resolve(null), { timeout: 10000 });
    });
    await api('/checkin', { method: 'POST', body: { latitude: pos?.latitude, longitude: pos?.longitude, note } });
    onDone();
  });
  return (
    <Modal title="Record my time by phone" onClose={onClose}>
      <p className="hint">Use this only when the fingerprint reader is not working, or you are working outside the office. Your first record of the day is your arrival and your last is your departure.</p>
      <Field label="Where are you working?"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Needed when you are outside the office" /></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <div className="row-end"><button className="primary" onClick={send} disabled={act.busy}>Record the time now</button></div>
    </Modal>
  );
}

// The working day as one line: scheduled hours, the lunch break, and the part already worked.
function DayLine({ schedule: s, record: a }) {
  const { clock } = usePrefs();
  const from = s.start_min - 45, to = s.end_min + 45, span = to - from;
  const x = m => `${Math.min(100, Math.max(0, (m - from) / span * 100))}%`;
  const w = (m1, m2) => `${Math.max(0, (Math.min(m2, to) - Math.max(m1, from)) / span * 100)}%`;
  const inMin = minOf(a?.check_in), outMin = minOf(a?.check_out), now = nowMin();
  const until = outMin ?? (now > from && now < to ? now : null);
  return (
    <div className="dayline">
      <div className="track" role="img" aria-label="Today's working hours">
        {s.break_start != null && <div className="band lunch" style={{ left: x(s.break_start), width: w(s.break_start, s.break_end) }} />}
        {inMin != null && a.late_min > 0 && <div className="band late-gap" style={{ left: x(s.start_min), width: w(s.start_min, inMin) }} />}
        {inMin != null && until != null && <div className="band worked" style={{ left: x(inMin), width: w(inMin, until) }} />}
        {outMin == null && now > from && now < to && <div className="nowmark" style={{ left: x(now) }} />}
      </div>
      <div className="ticks">
        <span style={{ left: x(s.start_min) }}><b>{clock(s.start_min)}</b>Start</span>
        {s.break_start != null && <span style={{ left: x((s.break_start + s.break_end) / 2) }}><b>{clock(s.break_start)}</b>Lunch</span>}
        <span style={{ left: x(s.end_min) }}><b>{clock(s.end_min)}</b>End</span>
      </div>
    </div>
  );
}

function headline(a, s, fmtTime) {
  if (!s && !a?.check_in) return ['Today is a day off for you.', ''];
  switch (a?.status) {
    case 'leave': return ['You are on leave today.', ''];
    case 'holiday': return ['Today is a holiday.', ''];
    case 'absent': return ['No arrival was recorded today.', 'absent'];
    case 'late': case 'half_day': return [a.check_out ? `You worked until ${fmtTime(a.check_out)}.` : `You arrived at ${fmtTime(a.check_in)}, ${a.late_min} minutes late.`, a.check_out ? '' : 'late'];
    case 'present': case 'extra': return [a.check_out ? `You worked until ${fmtTime(a.check_out)}. See you next time.` : `You arrived at ${fmtTime(a.check_in)}.`, ''];
    default: return ['You have not arrived yet.', ''];
  }
}

export default function Home({ user, onRead }) {
  const { t, fmtDate, fmtTime, fmtStamp } = usePrefs();
  const [d, reload, error] = useLoad('/dashboard/me');
  const [bal] = useLoad('/leave/balances');
  const [notes, reloadNotes] = useLoad('/notifications');
  const [checkin, setCheckin] = useState(false);
  if (error) return <Page title={t('Home')}><ErrorNote>{error}</ErrorNote></Page>;
  if (!d) return null;
  const [text, tone] = headline(d.today, d.schedule, fmtTime);
  const m = d.month, annual = bal?.[0];
  const unread = notes?.filter(n => !n.read_at) || [];
  const hour = Math.floor(nowMin() / 60);
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = user.full_name.split(/\s+/)[0];
  const onTime = m.worked ? Math.round((m.worked - m.late) / m.worked * 100) : null;
  const showProbation = d.employment?.employment_status === 'probation' && d.employment.probation_days_left != null;
  return (
    <section className="page wide">
      <div className="greet">
        <div><p className="eyebrow"><Icon name="calendar" />{fmtDate(d.date)}</p><h1>{hello}, {first}</h1></div>
        <div className="actions">
          <button className="quiet" onClick={() => setCheckin(true)}><Icon name="phone" />Reader not working?</button>
          <Link className="button primary" to="/leave"><Icon name="plane" />{t('Request leave')}</Link>
        </div>
      </div>

      <div className="card hero">
        <p className="label">Today</p>
        <p className={'now ' + tone}>{text}</p>
        {d.schedule && <DayLine schedule={d.schedule} record={d.today} />}
        {d.today?.check_in && <div className="home-actions">
          <Link className="button quiet" to="/attendance">See my attendance <Icon name="arrow" /></Link>
        </div>}
      </div>

      <div className="stats">
        <Stat label="Days worked" value={m.worked} sub="This month" icon="check" tone="green" />
        <Stat label="Hours worked" value={hours(m.worked_min)} unit="h" sub="This month" icon="clock" tone="blue" />
        <Stat label="On time" value={onTime == null ? '–' : onTime} unit={onTime == null ? '' : '%'} sub={m.late ? `Late ${m.late} ${m.late === 1 ? 'time' : 'times'}` : 'Never late this month'} icon="trend" tone={m.late ? 'gold' : 'green'} />
        {annual
          ? <Stat label="Annual leave left" value={annual.remaining} unit="days" sub={`of ${annual.entitled} this year`} icon="plane" tone="blue" />
          : <Stat label="Absent" value={m.absent} unit="days" sub="This month" icon="alert" tone={m.absent ? 'red' : 'green'} />}
      </div>

      <div className="home-grid">
        {showProbation && <Probation e={d.employment} />}
        <div className="panel">
          <header><h2><Icon name="id" />Your place</h2></header>
          <dl className="facts-list">
            <div><dt>Department</dt><dd>{d.place?.department || 'Not set'}{d.place?.office && ` · ${d.place.office}`}</dd></div>
            <div><dt>Supervisor</dt><dd>{d.place?.supervisor || 'None, HR looks after you'}</dd></div>
            <div><dt>Your requests</dt><dd>{approverLine(d.approvers)}</dd></div>
            <div><dt>Employment</dt><dd>{d.employment?.employment_status === 'probation' ? 'On probation' : 'Permanent'}{d.employment?.hire_date && ` · since ${fmtDate(d.employment.hire_date)}`}</dd></div>
          </dl>
        </div>
        <div className="panel">
          <header><h2><Icon name="bell" />New for you</h2>
            {unread.length > 0 && <button className="quiet" onClick={async () => { await api('/notifications/read', { method: 'POST' }); reloadNotes(); onRead?.(); }}>Mark all as read</button>}</header>
          {unread.length > 0
            ? <NoteList notes={unread} limit={5} onChanged={() => { reloadNotes(); onRead?.(); }} />
            : <p className="hint">You are up to date. Approvals and reminders will appear here.</p>}
          {unread.length > 5 && <div className="row-end"><Link className="button quiet" to="/notifications">See all {unread.length}</Link></div>}
        </div>
        {m.absent > 0 && <div className="panel">
          <header><h2><Icon name="alert" />Something wrong?</h2></header>
          <p className="hint">You have {m.absent} {m.absent === 1 ? 'day' : 'days'} marked absent this month. If you were at work, ask for a correction from My attendance.</p>
          <div className="home-actions"><Link className="button" to="/attendance">Review my days</Link></div>
        </div>}
      </div>
      {checkin && <PhoneCheckIn onClose={() => setCheckin(false)} onDone={() => { setCheckin(false); reload(); }} />}
    </section>
  );
}
