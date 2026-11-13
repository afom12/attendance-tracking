import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useLoad, usePrefs, Page, Empty } from '../lib.jsx';

// One list for everything the system told this person: approvals, leave balances, probation, absences.
export function NoteList({ notes, onChanged, limit }) {
  const { fmtStamp } = usePrefs();
  const go = useNavigate();
  const openNote = async n => {
    if (!n.read_at) { await api('/notifications/read', { method: 'POST', body: { id: n.id } }).catch(() => {}); onChanged?.(); }
    if (n.link) go(n.link);
  };
  return (
    <ul className="list notes">
      {notes.slice(0, limit).map(n => (
        <li key={n.id} className={(n.link ? 'click' : '') + (n.read_at ? ' read' : ' unread')} onClick={() => openNote(n)}
          onKeyDown={e => e.key === 'Enter' && openNote(n)} tabIndex={0} role={n.link ? 'link' : undefined}>
          <span className="dot" aria-hidden="true" />
          <div className="grow"><strong>{n.title}</strong><small>{n.body}</small></div>
          <div className="side"><span className="time">{fmtStamp(n.created_at)}</span>{n.link && <span className="chev" aria-hidden="true">›</span>}</div>
        </li>))}
    </ul>
  );
}

export default function Notifications({ onRead }) {
  const { t } = usePrefs();
  const [notes, reload] = useLoad('/notifications');
  const [only, setOnly] = useState(false);
  const unread = notes?.filter(n => !n.read_at).length || 0;
  const shown = notes?.filter(n => !only || !n.read_at) || [];
  const readAll = async () => { await api('/notifications/read', { method: 'POST' }); reload(); onRead?.(); };
  return (
    <Page title={t('Notifications')} hint={notes ? (unread ? `${unread} new.` : 'You are up to date.') + ' Choose one to open what it is about.' : undefined}
      actions={unread > 0 && <button onClick={readAll}>Mark all as read</button>}>
      <div className="filters">
        <button className={!only ? 'on' : ''} onClick={() => setOnly(false)}>All</button>
        <button className={only ? 'on' : ''} onClick={() => setOnly(true)}>New only</button>
      </div>
      {shown.length ? <NoteList notes={shown} onChanged={() => { reload(); onRead?.(); }} /> : notes && <Empty>{only ? 'Nothing new.' : 'No notifications yet.'}</Empty>}
    </Page>
  );
}
