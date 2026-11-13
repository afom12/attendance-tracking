# Progress

**What works**

- Everything marked Built in SRS v1.0; smoke tests pass (server/test/smoke.js).
- 2026-11-13: FR-02 now enforced by the API (temporary password blocks every call except /me and /auth/change-password); new password must differ from the old one.

- 2026-11-13: FR-39 Settings > Offices (name, address, location via "Use my current location", area radius); server validates location and audits old values; department office choice shown when >1 office.

- 2026-11-13: Employment lifecycle + notifications (95 smoke checks pass):
  - Probation (setting `probation_months`, default 2): new staff start on probation; HR confirms (permanent) or does not confirm (inactive, reason kept). "Still on probation" for pre-existing staff. Employee sees a countdown on Home.
  - Active/inactive: `POST /employees/:id/status` with date + reason (LEAVING_REASONS); cancels untaken leave, stops absences after `left_on`, keeps all records; "Coming back to work" re-activates. History in `employment_events`. PUT /employees no longer changes `active`.
  - Reminders (server/src/alerts.js, run by the 10-min scheduler, one-off via `notifications.key`): probation ending/overdue, N working days absent in a row (`absence_alert_days`).
  - Leave notifications include taken/left; per-employee leave history; Reports > Leave balances (+ Excel).
  - Notifications page with unread count, clickable links; Employees list groups (Working here / On probation / Needs attention / No longer here).

- 2026-11-13: UI redesign: tokenised styles.css (light + dark via `data-theme`, toggle in the user menu), dark-green icon sidebar, card lists/tables, `Icon`/`Stat`/`Brand` in lib.jsx, Home dashboard (greeting, Today card, stat tiles, panels), Team today stat-tile filters, My leave ring, mobile top bar. Checked with headless-Edge screenshots (scratchpad/shots/shoot.mjs).

- 2026-11-13: Team Dashboard (`/` for supervisor/hr/admin/management; personal page moved to `/me`): KPIs with change vs last working day, per-day stacked chart (+table view), today donut, 5-min arrival histogram, needs-attention list, departments, latest check-ins, most-often-late, reader status; auto-refresh 60s. API `GET /dashboard/team`, `GET /attendance/week` (Team today > This week grid). SVG charts in client/src/charts.jsx; chart colours validated with the dataviz checker (dashboard.css `--s-*`). 101 smoke checks pass. Demo seeder: scratchpad/shots/seed.mjs.

- 2026-11-13: Logic pass (126 smoke checks pass):
  - `employees.track_attendance` (false = system account: built-in ADMIN, an owner who does not punch). Not in team list, reports, dashboard, headcount; no absences, no leave; no "Me" pages. One-time upgrade step in db.js (`system_account_done`).
  - Approval chain in server/src/approvals.js (`approversOf`, `canDecide`): supervisor > HR when supervisor is self/missing/away > management + other HR for HR/admin > management. No approver = refused on submit with the reason. Management can decide (only what is theirs). `GET /approvers`; names shown on leave form, My leave, Home "Your place".
  - Leave rules: no annual leave on probation (setting), first-year pro-rata (setting), carry-over cap (setting), no requests across two years, HR-recorded leave is approved at once, rejecting needs a reason, one pending correction per day, HR cannot edit own attendance.
  - Approver sees balance after the request, who else is away, days waiting; requests waiting > `approval_reminder_days` are chased once and HR is told.

**Not started / backlog**

- Still missing for a "full" system (not built): half-day leave, attachments for sick/maternity, overtime approval, month close/payroll lock (FR-64), delegation while an approver is away for long, public-holiday import.

- SRS section 11 order: NFR-08 rate limiting, FR-60 HR start page, FR-59 bulk exceptions, FR-49 reader alert, FR-64 month close (needs table), FR-51, FR-63, FR-24, FR-56, FR-57, FR-38, FR-47, NFR-13.

**Known issues**

- Hikvision endpoint not tested on real hardware.
