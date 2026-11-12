import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useLoad, usePrefs, Page, Chip, Modal, Field, ErrorNote, Empty, useAction, hours } from '../lib.jsx';
import { ChangePassword } from '../App.jsx';

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
    <Modal title="Check in by phone" onClose={onClose}>
      <p className="hint">Use this only when the fingerprint device is not working or you are working outside the office. Your first punch of the day is your check-in and your last is your check-out.</p>
      <Field label="Note (required outside the office)"><input value={note} onChange={e => setNote(e.target.value)} placeholder="Where are you working?" /></Field>
      <ErrorNote>{act.error}</ErrorNote>
      <div className="row-end"><button className="primary" onClick={send} disabled={act.busy}>Record now</button></div>
    </Modal>
  );
}

export default function Home({ user }) {
  const { t, fmtDate, fmtTime, fmtStamp, clock } = usePrefs();
  const [d, reload, error] = useLoad('/dashboard/me');
  const [bal] = useLoad('/leave/balances');
  const [notes, reloadNotes] = useLoad('/notifications');
  const [dialog, setDialog] = useState('');
  if (error) return <Page title={t('Home')}><ErrorNote>{error}</ErrorNote></Page>;
  if (!d) return null;
  const a = d.today, s = d.schedule;
  const annual = bal?.[0];
  return (
    <Page title={`${t('Today')}, ${fmtDate(d.date)}`}
      hint={s ? `Your hours today: ${clock(s.start_min)} to ${clock(s.end_min)}` : 'Today is not a working day for you.'}
      actions={<button onClick={() => setDialog('checkin')}>{t('Check in by phone')}</button>}>
      <div className="today card">
        <Chip status={a?.status || 'off'} />
        <dl>
          <div><dt>{t('Check-in')}</dt><dd>{fmtTime(a?.check_in)}</dd></div>
          <div><dt>{t('Check-out')}</dt><dd>{fmtTime(a?.check_out)}</dd></div>
          {a?.late_min > 0 && <div><dt>{t('Late')}</dt><dd>{a.late_min} min</dd></div>}
        </dl>
      </div>

      <h2>{t('This month')}</h2>
      <div className="stats">
        <div><strong>{d.month.worked}</strong><span>{t('Days worked')}</span></div>
        <div><strong>{d.month.late}</strong><span>{t('Late')}</span></div>
        <div><strong>{d.month.absent}</strong><span>{t('Absent')}</span></div>
        <div><strong>{hours(d.month.worked_min)}</strong><span>{t('Hours worked')}</span></div>
        {annual && <div><strong>{annual.remaining}</strong><span>{annual.name} {t('Leave balance').toLowerCase()}</span></div>}
      </div>
      <p className="links"><Link to="/attendance">{t('My attendance')} →</Link><Link to="/leave">{t('Request leave')} →</Link>
        <button className="link" onClick={() => setDialog('password')}>{t('Change password')}</button></p>

      <h2>{t('Notifications')}</h2>
      {notes?.length ? (
        <>
          <ul className="notes">
            {notes.slice(0, 8).map(n => <li key={n.id} className={n.read_at ? '' : 'unread'}><strong>{n.title}</strong><span>{n.body}</span><time>{fmtStamp(n.created_at)}</time></li>)}
          </ul>
          {d.unread > 0 && <button className="link" onClick={async () => { await api('/notifications/read', { method: 'POST' }); reloadNotes(); reload(); }}>Mark all as read</button>}
        </>
      ) : <Empty>Nothing new.</Empty>}

      {dialog === 'checkin' && <PhoneCheckIn onClose={() => setDialog('')} onDone={() => { setDialog(''); reload(); }} />}
      {dialog === 'password' && <Modal title={t('Change password')} onClose={() => setDialog('')}><ChangePassword onDone={() => setDialog('')} /></Modal>}
    </Page>
  );
}
