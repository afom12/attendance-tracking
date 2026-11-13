import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useLoad, usePrefs, Page, Modal, Field, ErrorNote, useAction, hours, nowMin, minOf } from '../lib.jsx';

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

export default function Home({ user }) {
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
  return (
    <section className="page">
      <p className="hint">{fmtDate(d.date)}</p>
      <h1 className={'now ' + tone}>{text}</h1>
      {d.schedule && <DayLine schedule={d.schedule} record={d.today} />}

      <p className="summary">
        This month you worked <b>{m.worked} {m.worked === 1 ? 'day' : 'days'}</b> ({hours(m.worked_min)} hours)
        {m.late > 0 && <>, arrived late <b>{m.late} {m.late === 1 ? 'time' : 'times'}</b></>}
        {m.absent > 0 && <>, and were absent <b>{m.absent} {m.absent === 1 ? 'day' : 'days'}</b></>}.
        {annual && <> You have <b>{annual.remaining} days</b> of annual leave left.</>}
      </p>
      <div className="home-actions">
        <Link className="button primary" to="/leave">{t('Request leave')}</Link>
        <Link className="button" to="/attendance">{t('My attendance')}</Link>
        <button className="quiet" onClick={() => setCheckin(true)}>Fingerprint reader not working?</button>
      </div>

      {unread.length > 0 && <>
        <h2 className="section">New for you</h2>
        <ul className="list">
          {unread.slice(0, 5).map(n => <li key={n.id}><div className="grow"><strong>{n.title}</strong><small>{n.body}</small></div></li>)}
        </ul>
        <div className="row-end"><button className="quiet" onClick={async () => { await api('/notifications/read', { method: 'POST' }); reloadNotes(); }}>Mark as read</button></div>
      </>}
      {checkin && <PhoneCheckIn onClose={() => setCheckin(false)} onDone={() => { setCheckin(false); reload(); }} />}
    </section>
  );
}
