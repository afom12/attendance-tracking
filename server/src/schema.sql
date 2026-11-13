CREATE TABLE IF NOT EXISTS branches (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, address text,
  latitude double precision, longitude double precision, radius_m int DEFAULT 100);
CREATE TABLE IF NOT EXISTS shifts (id serial PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS shift_days (
  shift_id int REFERENCES shifts ON DELETE CASCADE, weekday int NOT NULL,
  start_min int NOT NULL, end_min int NOT NULL, break_start int, break_end int,
  PRIMARY KEY (shift_id, weekday));
CREATE TABLE IF NOT EXISTS departments (
  id serial PRIMARY KEY, branch_id int REFERENCES branches, name text NOT NULL UNIQUE, supervisor_id int);
CREATE TABLE IF NOT EXISTS employees (
  id serial PRIMARY KEY, employee_no text NOT NULL UNIQUE, full_name text NOT NULL,
  email text UNIQUE, phone text,
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','supervisor','hr','admin','management')),
  department_id int REFERENCES departments, shift_id int REFERENCES shifts,
  hire_date date, active boolean NOT NULL DEFAULT true, fingerprint_id text UNIQUE,
  password_hash text NOT NULL, must_change_password boolean NOT NULL DEFAULT true,
  failed_logins int NOT NULL DEFAULT 0, locked_until timestamptz);
CREATE TABLE IF NOT EXISTS employee_days (
  employee_id int REFERENCES employees ON DELETE CASCADE, weekday int NOT NULL,
  start_min int NOT NULL, end_min int NOT NULL, break_start int, break_end int,
  PRIMARY KEY (employee_id, weekday));
CREATE TABLE IF NOT EXISTS holidays (id serial PRIMARY KEY, date date NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
  id serial PRIMARY KEY, name text NOT NULL, serial_no text NOT NULL UNIQUE,
  branch_id int REFERENCES branches, api_key text NOT NULL, last_sync_at timestamptz);
CREATE TABLE IF NOT EXISTS punches (
  id bigserial PRIMARY KEY, device_id int REFERENCES devices, fingerprint_id text NOT NULL,
  employee_id int REFERENCES employees, punched_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'device', note text, received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint_id, punched_at));
CREATE INDEX IF NOT EXISTS punches_emp_time ON punches (employee_id, punched_at);
CREATE TABLE IF NOT EXISTS attendance (
  id serial PRIMARY KEY, employee_id int NOT NULL REFERENCES employees, date date NOT NULL,
  check_in timestamptz, check_out timestamptz, status text NOT NULL,
  late_min int NOT NULL DEFAULT 0, early_min int NOT NULL DEFAULT 0,
  worked_min int NOT NULL DEFAULT 0, overtime_min int NOT NULL DEFAULT 0,
  flag text, manual boolean NOT NULL DEFAULT false, note text,
  UNIQUE (employee_id, date));
CREATE INDEX IF NOT EXISTS attendance_date ON attendance (date);
CREATE TABLE IF NOT EXISTS leave_types (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, days_per_year numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT true, requires_attachment boolean NOT NULL DEFAULT false,
  calendar_days boolean NOT NULL DEFAULT false, is_annual boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS leave_balances (
  employee_id int REFERENCES employees ON DELETE CASCADE, leave_type_id int REFERENCES leave_types,
  year int NOT NULL, entitled numeric NOT NULL, used numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (employee_id, leave_type_id, year));
CREATE TABLE IF NOT EXISTS leave_requests (
  id serial PRIMARY KEY, employee_id int NOT NULL REFERENCES employees,
  leave_type_id int NOT NULL REFERENCES leave_types, start_date date NOT NULL, end_date date NOT NULL,
  days numeric NOT NULL, reason text, status text NOT NULL DEFAULT 'pending',
  decided_by int REFERENCES employees, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS corrections (
  id serial PRIMARY KEY, employee_id int NOT NULL REFERENCES employees, date date NOT NULL,
  requested_in text, requested_out text, reason text NOT NULL, status text NOT NULL DEFAULT 'pending',
  decided_by int REFERENCES employees, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY, employee_id int NOT NULL REFERENCES employees ON DELETE CASCADE,
  title text NOT NULL, body text, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, user_id int, action text NOT NULL, entity text NOT NULL, entity_id text,
  old_value jsonb, new_value jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);

-- Employment lifecycle: probation, confirmation, leaving and coming back. Records are never deleted.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status text NOT NULL DEFAULT 'permanent'; -- probation | permanent | not_confirmed
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS confirmed_on date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS left_on date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS left_reason text;
CREATE TABLE IF NOT EXISTS employment_events (
  id serial PRIMARY KEY, employee_id int NOT NULL REFERENCES employees ON DELETE CASCADE,
  event text NOT NULL, effective_date date NOT NULL, note text, by_id int REFERENCES employees,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS employment_events_emp ON employment_events (employee_id, created_at);
-- A notification with a key is sent once only (automatic reminders); link opens the related screen.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_key ON notifications (employee_id, key) WHERE key IS NOT NULL;

-- Accounts that are not people at work (the built-in administrator, an owner who does not punch):
-- no absences, no leave balance, not counted in headcount or reports.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS track_attendance boolean NOT NULL DEFAULT true;
