-- QueueSmart database schema (SQLite).
-- db.js runs this file every time the server starts. Every statement uses
-- IF NOT EXISTS, so it is safe to run on a database that already has data.
--
-- Ownership (Assignment 4 split):
--   UserCredentials, UserProfile .......... Member 1
--   Service ............................... Member 2
--   Queue, QueueEntry ..................... Member 3
--   Notification, History ................. Member 4
-- Tell the owner before changing another member's table.

PRAGMA foreign_keys = ON;

-- 1. UserCredentials: authentication data. Passwords are stored only as a
--    salted scrypt hash (never in plain text).
CREATE TABLE IF NOT EXISTS UserCredentials (
  user_id        TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
  password_salt  TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('User', 'Administrator')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. UserProfile: one row per user, linked to UserCredentials by email.
CREATE TABLE IF NOT EXISTS UserProfile (
  email          TEXT PRIMARY KEY
                 REFERENCES UserCredentials(email) ON UPDATE CASCADE ON DELETE CASCADE,
  full_name      TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 100),
  phone          TEXT CHECK (phone IS NULL OR length(phone) <= 20),
  preferences    TEXT CHECK (preferences IS NULL OR length(preferences) <= 500),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Service: services the organization offers.
CREATE TABLE IF NOT EXISTS Service (
  service_id     TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 100),
  description    TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  duration       INTEGER NOT NULL CHECK (duration BETWEEN 1 AND 480),   -- expected minutes per person
  priority       TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  status         TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. Queue: the active queue for a service.
CREATE TABLE IF NOT EXISTS Queue (
  queue_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id     TEXT NOT NULL REFERENCES Service(service_id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. QueueEntry: users waiting in (or finished with) a queue.
CREATE TABLE IF NOT EXISTS QueueEntry (
  entry_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id       INTEGER NOT NULL REFERENCES Queue(queue_id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES UserCredentials(user_id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 1),
  join_time      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'served', 'canceled'))
);
-- A user can be waiting in only one queue at a time.
CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_entry_per_user
  ON QueueEntry(user_id) WHERE status = 'waiting';

-- 6a. Notification: messages sent to a user.
CREATE TABLE IF NOT EXISTS Notification (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES UserCredentials(user_id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 50),
  message        TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  service_id     TEXT REFERENCES Service(service_id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6b. History: a user's queue activity (served, left queue, removed).
CREATE TABLE IF NOT EXISTS History (
  history_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES UserCredentials(user_id) ON DELETE CASCADE,
  service_id     TEXT REFERENCES Service(service_id) ON DELETE SET NULL,
  service_name   TEXT,
  outcome        TEXT NOT NULL CHECK (length(outcome) BETWEEN 1 AND 50),
  occurred_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
