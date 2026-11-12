import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb, q } from './db.js';
import { api, iclock, hik } from './routes.js';
import { processRange } from './engine.js';
import { today, addDays } from './util.js';

const app = express();
app.use('/iclock', express.text({ type: '*/*', limit: '5mb' }), iclock);
app.use('/hik', express.text({ type: '*/*', limit: '10mb' }), hik);
app.use('/api', express.json({ limit: '5mb' }), api);

// In production the built React app is served from the same server.
const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(dist + '/index.html'));
}
app.use((err, req, res, next) => {
  if (err.code === '23505') return res.status(400).json({ error: 'That value is already used (employee ID, email, fingerprint ID or name must be unique)' });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on the server' });
});

await initDb();
// Keep today's records current (absences, missing check-outs) and close yesterday.
let busy = false;
const tick = async () => {
  if (busy) return; busy = true;
  try { await processRange(addDays(today(), -1), today()); } catch (e) { console.error('processing failed', e); }
  busy = false;
};
if (process.env.NO_SCHEDULER !== '1') { tick(); setInterval(tick, 10 * 60000); }
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Attendance server on http://localhost:${port}`));
