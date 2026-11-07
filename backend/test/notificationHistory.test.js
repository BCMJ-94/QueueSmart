import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../src/db.js'
import { createNotificationService } from '../src/notificationService.js'
import { createHistoryService } from '../src/historyService.js'

function seedUser(db, id, email) {
  db.prepare(`INSERT INTO UserCredentials (user_id,email,password_salt,password_hash,role)
    VALUES (?,?,?,?,'User')`).run(id,email,'salt','hash')
}

test('notification CRUD, read state, ordering, and user isolation use SQLite', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'u1', 'one@example.com'); seedUser(db, 'u2', 'two@example.com')
  const service = createNotificationService({ db, now: () => '2026-11-06T10:00:00.000Z' })
  const one = service.create({ userId:'u1', type:'queue_joined', message:'Joined queue' })
  service.create({ userId:'u2', type:'queue_joined', message:'Private message' })
  assert.equal(one.read, false)
  assert.equal(service.list('u1').length, 1)
  assert.equal(service.unreadCount('u1'), 1)
  assert.equal(service.markRead('u2', one.id), null, 'another user cannot mark this notification')
  assert.equal(service.markRead('u1', one.id).read, true)
  assert.equal(service.unreadCount('u1'), 0)
  service.create({ userId:'u1', type:'next_in_line', message:'You are next' })
  assert.equal(service.markAllRead('u1').every((n) => n.read), true)
  assert.throws(() => service.create({ userId:'missing', type:'x', message:'x' }), /FOREIGN KEY/)
  db.close()
})

test('history CRUD is ordered and scoped to the signed-in user', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'u1', 'one@example.com'); seedUser(db, 'u2', 'two@example.com')
  const service = createHistoryService({ db, now: () => '2026-11-06T10:00:00.000Z' })
  service.record({ userId:'u1', serviceName:'Clinic', outcome:'Joined queue' })
  service.record({ userId:'u2', serviceName:'Private', outcome:'Served' })
  const rows = service.list('u1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].outcome, 'Joined queue')
  assert.equal(rows[0].serviceName, 'Clinic')
  assert.equal(rows[0].userId, 'u1')
  db.close()
})

test('notifications and history survive closing and reopening the database file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'queuesmart-notifications-'))
  const file = join(dir, 'queuesmart.db')
  try {
    let db = openDatabase(file)
    seedUser(db, 'persist-user', 'persist@example.com')
    createNotificationService({ db }).create({ userId:'persist-user', type:'served', message:'You were served.' })
    createHistoryService({ db }).record({ userId:'persist-user', serviceName:'Clinic', outcome:'Served' })
    db.close()
    db = openDatabase(file)
    assert.equal(createNotificationService({ db }).list('persist-user').length, 1)
    assert.equal(createNotificationService({ db }).unreadCount('persist-user'), 1)
    assert.equal(createHistoryService({ db }).list('persist-user')[0].outcome, 'Served')
    db.close()
  } finally { rmSync(dir, { recursive:true, force:true }) }
})

test('queue join records a Joined queue history event', async () => {
  const { createQueueService } = await import('../src/queueService.js')
  const history = []
  const queue = createQueueService({
    getService: (id) => ({ id: String(id), name: 'Clinic', duration: 10, open: true }),
    recordHistory: (event) => history.push(event),
    getUserEmail: () => 'person@example.com',
  })
  queue.join('person-1', 'clinic-1')
  assert.equal(history.length, 1)
  assert.equal(history[0].outcome, 'Joined queue')
  assert.equal(history[0].userId, 'person-1')
})

test('notification service requires a db, a userId, and a type and message', () => {
  assert.throws(() => createNotificationService(), TypeError)

  const db = openDatabase(':memory:')
  const notifications = createNotificationService({ db })
  assert.throws(() => notifications.list(), /userId is required/)
  assert.throws(() => notifications.create({ type: 'served', message: 'x' }), /userId is required/)
  assert.throws(() => notifications.create({ userId: 'u', message: 'x' }), /type and message are required/)
  assert.throws(() => notifications.create({ userId: 'u', type: 'served' }), /type and message are required/)
  db.close()
})

test('notifications without a service have a null serviceId, and unreadCount tracks reads', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'user-1', 'one@example.com')
  const notifications = createNotificationService({ db })

  const first = notifications.create({ userId: 'user-1', type: 'served', message: 'Served' })
  assert.equal(first.serviceId, null)
  assert.equal(notifications.unreadCount('user-1'), 1)

  notifications.markRead('user-1', first.id)
  assert.equal(notifications.unreadCount('user-1'), 0)
  assert.equal(notifications.markRead('user-1', 999999), null)
  db.close()
})

test('history service requires a db, a userId, and an outcome', () => {
  assert.throws(() => createHistoryService(), TypeError)

  const db = openDatabase(':memory:')
  const history = createHistoryService({ db })
  assert.throws(() => history.list(), /userId is required/)
  assert.throws(() => history.record({ outcome: 'Served' }), /userId and outcome are required/)
  assert.throws(() => history.record({ userId: 'u' }), /userId and outcome are required/)
  db.close()
})

test('history records without a service keep null service fields, and an explicit time is used', () => {
  const db = openDatabase(':memory:')
  seedUser(db, 'user-1', 'one@example.com')
  const history = createHistoryService({ db })

  const entry = history.record({ userId: 'user-1', outcome: 'Served', occurredAt: '2026-01-01T00:00:00.000Z' })
  assert.equal(entry.serviceId, null)
  assert.equal(entry.serviceName, null)
  assert.equal(entry.occurredAt, '2026-01-01T00:00:00.000Z')

  const [listed] = history.list('user-1')
  assert.equal(listed.serviceId, null)
  assert.equal(listed.occurredAt, '2026-01-01T00:00:00.000Z')
  db.close()
})
