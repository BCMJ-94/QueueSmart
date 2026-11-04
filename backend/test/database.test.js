import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAuthService } from '../src/authService.js'
import { isUniqueViolation, openDatabase, transaction } from '../src/db.js'
import { createProfileService } from '../src/profileService.js'

test('openDatabase creates all of the required tables', () => {
  const db = openDatabase(':memory:')
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all().map((row) => row.name).sort()

  assert.deepEqual(tables, ['History', 'Notification', 'Queue', 'QueueEntry', 'Service', 'UserCredentials', 'UserProfile'])
})

test('accounts and profiles survive closing and reopening the database file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'queuesmart-'))
  const file = join(dir, 'nested', 'test.db')
  try {
    const firstDb = openDatabase(file)
    const firstAuth = createAuthService({ db: firstDb })
    const { user } = await firstAuth.register({ email: 'kai@example.com', password: 'valid-password', fullName: 'Kai Lee' })
    firstDb.close()

    // Same file, new connection: like restarting the server
    const secondDb = openDatabase(file)
    const secondAuth = createAuthService({ db: secondDb })
    const session = await secondAuth.login({ email: 'kai@example.com', password: 'valid-password' })
    assert.equal(session.user.id, user.id)
    assert.equal(createProfileService({ db: secondDb }).get('kai@example.com').fullName, 'Kai Lee')
    secondDb.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the database enforces unique emails, allowed roles, and foreign keys', () => {
  const db = openDatabase(':memory:')
  const insert = db.prepare('INSERT INTO UserCredentials (user_id, email, password_salt, password_hash, role) VALUES (?, ?, ?, ?, ?)')
  insert.run('u1', 'a@example.com', 'salt', 'hash', 'User')

  assert.throws(() => insert.run('u2', 'a@example.com', 'salt', 'hash', 'User'), (error) => isUniqueViolation(error))
  assert.throws(() => insert.run('u3', 'b@example.com', 'salt', 'hash', 'Owner'), /CHECK constraint failed/)
  assert.throws(
    () => db.prepare('INSERT INTO UserProfile (email, full_name) VALUES (?, ?)').run('nobody@example.com', 'No One'),
    /FOREIGN KEY constraint failed/,
  )
  assert.throws(
    () => db.prepare('INSERT INTO UserProfile (email, full_name) VALUES (?, ?)').run('a@example.com', 'x'.repeat(101)),
    /CHECK constraint failed/,
  )
})

test('transaction saves every write or none of them', () => {
  const db = openDatabase(':memory:')
  const insert = db.prepare('INSERT INTO UserCredentials (user_id, email, password_salt, password_hash) VALUES (?, ?, ?, ?)')

  assert.equal(transaction(db, () => insert.run('u1', 'a@example.com', 's', 'h').changes), 1)
  assert.throws(() => transaction(db, () => {
    insert.run('u2', 'b@example.com', 's', 'h')
    insert.run('u3', 'a@example.com', 's', 'h')   // duplicate email fails
  }), /UNIQUE/)

  const emails = db.prepare('SELECT email FROM UserCredentials ORDER BY email').all().map((row) => row.email)
  assert.deepEqual(emails, ['a@example.com'])
})

test('isUniqueViolation only matches UNIQUE errors', () => {
  assert.equal(isUniqueViolation(new Error('UNIQUE constraint failed: UserCredentials.email')), true)
  assert.equal(isUniqueViolation(new Error('something else')), false)
  assert.equal(isUniqueViolation(undefined), false)
})
