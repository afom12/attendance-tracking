# Trade Ethiopia Attendance System

Fingerprint-based attendance, leave and reporting. Built from the SRS (version 0.1).

- `server/` Node.js + Express API, PostgreSQL, the attendance rules engine
- `client/` React app (employees, supervisors, HR), English and Amharic, Ethiopian date and time

## Run it on your computer

You need Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Database
createdb attendance

# 2. Server
cd server
npm install
cp .env.example .env          # then edit DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
node --env-file=.env src/index.js

# 3. Screens (second terminal)
cd client
npm install
npm run dev                   # open http://localhost:5173
```

The tables are created on first start. Log in as **ADMIN** with the `ADMIN_PASSWORD` from `.env`;
you are asked to choose a new password.

## First setup (as ADMIN)

1. **Settings > Departments**: add the departments.
2. **Employees**: add each employee with the **fingerprint ID** they have on the device.
   Give them the temporary password that is shown once.
3. **Employees > Schedule**: for instructors and other part-time staff choose "Own days".
4. **Settings > Departments**: choose a supervisor per department (role Supervisor or higher).
5. **Settings > Holidays**: enter this year's public holidays.
6. **Settings > Leave types**: check the days for each type. Annual is 16 as confirmed.
7. **Settings > Devices**: register the fingerprint device (see below).

## Put it in the cloud

One server runs everything: build the screens, then the API serves them.

```bash
cd client && npm install && npm run build
cd ../server && npm install && node src/index.js      # serves the app on PORT
```

Any host with Node.js and PostgreSQL works (a Linux VPS, Render, Railway). Set `DATABASE_URL`,
`JWT_SECRET`, `ADMIN_PASSWORD` and `PORT` as environment variables and put it behind HTTPS.

## Connecting the fingerprint device

**Hikvision (the device Trade Ethiopia is believed to have):** register the device in Settings > Devices,
then open the device's own web page (type its IP address in a browser on the same Wi-Fi), go to
Configuration > Network > Advanced > HTTP Listening and enter: the server's address, port 443 (HTTPS) or 80,
and the URL `/hik/<key>` shown in the device's row. Each fingerprint then arrives within seconds.
Use the person's "Employee No." on the device as the Fingerprint ID in this system. Not every Hikvision
model has HTTP Listening, and **this has not been tested on the real device yet**. If the model lacks it,
export the attendance log (USB or iVMS-4200) and use the file import.

Other ways punches are accepted:

1. **Push over Wi-Fi (ZKTeco ADMS / "cloud server" protocol)**: register the device serial number in
   Settings > Devices, then on the device set the cloud server address to this system. The device calls
   `/iclock/cdata`. Many terminals sold in Ethiopia use this protocol, but **it has not been tested
   against Trade Ethiopia's actual device yet**; the brand and model are still unknown.
2. **Generic API** for any other integration: `POST /api/devices/push` with header `x-device-key: <key>`
   and body `{ "punches": [{ "fingerprint_id": "101", "time": "2026-11-12 08:44:00" }] }` (local time).
3. **File import**: Settings > Devices > Import punches. Paste lines of `fingerprint ID,date time`
   exported from the device. Importing the same lines twice is safe.

How punches become attendance: the first punch of the day is the check-in, the last is the check-out,
repeat punches within 2 minutes are ignored. Employees never choose in/out on the device, which is what
makes an unreliable device usable. Anything unclear goes to the **Exceptions** screen.

## Rules (all changeable in Settings > Rules and Schedule)

| Rule | Value |
| --- | --- |
| Working hours | Mon-Fri 8:45-17:30 (2:45-11:30 Ethiopian), lunch 12:30-13:30; Sat 8:45-12:30 |
| Grace period | 10 minutes (to confirm with HR) |
| Half day | late by 2 hours or more |
| Overtime | 30 minutes or more after end of day |
| Annual leave | 16 working days, pro-rated for part-time staff |

## Tests

```bash
cd server
DATABASE_URL=postgres://.../attendance_test NO_SCHEDULER=1 PORT=4100 node src/index.js   # empty database
node test/smoke.js      # about 50 end-to-end checks
```

## Not built yet (in the SRS, left for the next round)

- Email and Telegram notifications (in-app notifications work)
- Check-in reminders and the daily summary message to HR
- PDF export (use Print on the Reports screen; Excel export works)
- Leave attachments, short permission of a few hours
- Bulk import of employees from Excel
- Management trend charts
- Amharic covers the menu and main labels only, and should be reviewed by a native speaker
