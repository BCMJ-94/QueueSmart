import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Database connection for every module.
// Uses SQLite through Node's built-in node:sqlite module (Node 22.13+), so there is
// nothing extra to install. Every service takes `db` as a parameter, and tests pass
// openDatabase(':memory:') to get a fresh, empty database.

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

export const DEFAULT_DATABASE_FILE = 'data/queuesmart.db'

export function openDatabase(file = DEFAULT_DATABASE_FILE) {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true })
  }

  const db = new DatabaseSync(file)
  db.exec(SCHEMA)
  return db
}

// True when SQLite rejected a write because of a UNIQUE constraint.
export function isUniqueViolation(error) {
  return /UNIQUE constraint failed/.test(error?.message ?? '')
}

// Runs fn inside a transaction: all of its writes are saved, or none are.
export function transaction(db, fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
