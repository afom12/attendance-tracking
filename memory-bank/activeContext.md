# Active context

**Current focus**: Working through SRS v1.0 (13 Nov 2026) section 11 build order, one requirement at a time.

**In progress**:

- [x] FR-02 enforced on the server (util.js `auth`)
- [x] FR-39 Offices screen (Settings > Offices)
- [x] Probation, active/inactive lifecycle, reminders, leave balance notifications (user request, outside SRS order)
- [ ] Next go-live blockers: rate limiting (NFR-08), reader model / IF-1 test, backups + HTTPS (deployment)

**Decisions (recent)**:

- Tests run against a throwaway DB `attendance_smoketest` on the same Postgres (port 5433), created and dropped per run.
- ZKTeco endpoints (IF-4) stay until HR confirms the reader is Hikvision only.

**Open questions**:

- SRS 3.4 list (reader model, grace period, approvers, etc.)
- HR to confirm: is 2 months calendar months (as built) or 60 working days? Can probation be extended? (not built)
- On upgrade, existing employees count as permanent; HR marks recent hires with "Still on probation".
- HR to confirm policy defaults: annual leave closed during probation; first-year annual leave pro-rated by month; no carry-over; who is "management" (needs at least one manager or second HR officer so HR/admin requests have an approver).
