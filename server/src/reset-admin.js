// Forgot the administrator password? Run:  node --env-file=.env src/reset-admin.js
// It sets the ADMIN account's password back to ADMIN_PASSWORD from .env and unlocks it.
import bcrypt from 'bcryptjs';
import { pool, q1 } from './db.js';

const password = process.env.ADMIN_PASSWORD;
if (!password) { console.error('Set ADMIN_PASSWORD in .env first.'); process.exit(1); }
const row = await q1(`UPDATE employees SET password_hash=$1, must_change_password=true, failed_logins=0, locked_until=NULL, active=true
                      WHERE employee_no='ADMIN' RETURNING id`, [await bcrypt.hash(password, 10)]);
console.log(row ? 'Done. Log in as ADMIN with the ADMIN_PASSWORD from .env.' : 'No ADMIN account found.');
await pool.end();
