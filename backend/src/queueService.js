// backend/src/queueService.js
//
// Queue module backed by the Queue and QueueEntry tables in schema.sql (SQLite).
// Every method is still synchronous (node:sqlite is synchronous), and every change that
// touches more than one row runs inside transaction() from db.js, so it is saved whole or not at all.
//
// How the tables are used:
//   Queue       one row per service, created the first time someone joins that service.
//   QueueEntry  one row per visit. status is 'waiting' while the person is in line, then
//               'served' (served by an administrator) or 'canceled' (left, or removed).
//               Entries are never deleted, so the table keeps a record of every visit.
//   position    1, 2, 3... among the WAITING entries of one queue. It is kept gap-free:
//               when someone stops waiting, everyone behind them moves up by one.
//
// The service itself still comes from the services module, and history, emails and
// notifications still come from the other modules, so they are passed in as functions:
//
//   db               an open database from openDatabase() in db.js
//   getService(id)   -> { id, name, duration, status } (or { open: true/false } instead of status),
//                       or undefined if there is no such service. `id` may be text (it comes from the URL).
//   recordHistory({ userId, serviceId, serviceName, outcome })
//                    -> stores a history entry. outcome is 'Served', 'Left queue' or 'Removed'.
//   getUserEmail(userId) -> the user's email, or undefined
//   notify({ userId, type, message, serviceId, serviceName })   (optional)
//
// History and notifications are written after the queue change has been saved, so a
// failure in one of them can never undo a join, leave or serve.

import { isUniqueViolation, transaction } from './db.js'

export class QueueError extends Error {
  constructor(status, message, errors) {
    super(message)
    this.status = status
    this.errors = errors
  }
}

export function createQueueService({ db, getService, recordHistory, getUserEmail, notify = () => {} }) {
  if (!db) {
    throw new TypeError('A database connection is required.')
  }

  // ---------- SQL, prepared once ----------

  const sql = {
    queueIdFor: db.prepare('SELECT queue_id FROM Queue WHERE service_id = ?'),
    createQueue: db.prepare('INSERT INTO Queue (service_id) VALUES (?)'),

    waitingForUser: db.prepare(`
      SELECT e.entry_id, e.position, q.queue_id, q.service_id
      FROM QueueEntry e
      JOIN Queue q ON q.queue_id = e.queue_id
      WHERE e.user_id = ? AND e.status = 'waiting'
    `),
    waitingInQueue: db.prepare(`
      SELECT entry_id, user_id, position, join_time
      FROM QueueEntry
      WHERE queue_id = ? AND status = 'waiting'
      ORDER BY position
    `),
    firstWaiting: db.prepare(`
      SELECT entry_id, user_id, position
      FROM QueueEntry
      WHERE queue_id = ? AND status = 'waiting'
      ORDER BY position
      LIMIT 1
    `),
    waitingEntry: db.prepare(`
      SELECT entry_id, user_id, position
      FROM QueueEntry
      WHERE queue_id = ? AND entry_id = ? AND status = 'waiting'
    `),
    waitingAtPosition: db.prepare(`
      SELECT entry_id, position
      FROM QueueEntry
      WHERE queue_id = ? AND position = ? AND status = 'waiting'
    `),
    nextPosition: db.prepare(`
      SELECT COALESCE(MAX(position), 0) + 1 AS position
      FROM QueueEntry
      WHERE queue_id = ? AND status = 'waiting'
    `),
    countWaiting: db.prepare(`
      SELECT COUNT(*) AS total FROM QueueEntry WHERE queue_id = ? AND status = 'waiting'
    `),

    addEntry: db.prepare('INSERT INTO QueueEntry (queue_id, user_id, position) VALUES (?, ?, ?)'),
    setEntryStatus: db.prepare('UPDATE QueueEntry SET status = ? WHERE entry_id = ?'),
    setEntryPosition: db.prepare('UPDATE QueueEntry SET position = ? WHERE entry_id = ?'),
    moveEveryoneBehindUp: db.prepare(`
      UPDATE QueueEntry SET position = position - 1
      WHERE queue_id = ? AND status = 'waiting' AND position > ?
    `),
  }

  // ---------- helpers ----------

  function requireService(id) {
    const service = getService(id)
    if (!service) throw new QueueError(404, 'Service not found.')
    return service
  }

  // Works with either shape: { open: true } or { status: 'open' }
  const isOpen = (service) => service.open ?? service.status === 'open'

  // Service.service_id is TEXT, so ids are always handed to SQL as text
  function queueIdFor(serviceId, { create = false } = {}) {
    const key = String(serviceId)
    const row = sql.queueIdFor.get(key)
    if (row) return row.queue_id
    return create ? Number(sql.createQueue.run(key).lastInsertRowid) : undefined
  }

  // Entry ids arrive as text from the URL; anything that is not a plain whole number cannot exist
  function findWaitingEntry(queueId, entryId) {
    const entry = queueId !== undefined && /^\d+$/.test(String(entryId))
      ? sql.waitingEntry.get(queueId, Number(entryId))
      : undefined
    if (!entry) throw new QueueError(404, 'Queue entry not found.')
    return entry
  }

  // Takes an entry out of the line and moves everyone behind it up by one
  function closeEntry(queueId, entry, status) {
    sql.setEntryStatus.run(status, entry.entry_id)
    sql.moveEveryoneBehindUp.run(queueId, entry.position)
  }

  function nextInLine(service, userId) {
    notify({
      userId,
      type: 'next_in_line',
      message: `You're next in line for ${service.name}. Please get ready.`,
      serviceId: service.id,
      serviceName: service.name,
    })
  }

  // ---------- user actions ----------

  function myQueue(userId) {
    const row = sql.waitingForUser.get(userId)
    if (!row) return { entry: null }

    const service = requireService(row.service_id)
    return {
      entry: {
        serviceId: service.id,
        serviceName: service.name,
        position: row.position,
        estimatedWaitMinutes: row.position * service.duration,
        status: row.position === 1 ? 'almost-ready' : 'waiting',
      },
    }
  }

  function join(userId, id) {
    const service = requireService(id)
    if (!isOpen(service)) throw new QueueError(409, 'This queue is closed.')

    transaction(db, () => {
      if (sql.waitingForUser.get(userId)) throw new QueueError(409, 'You are already in a queue.')

      const queueId = queueIdFor(service.id, { create: true })
      const { position } = sql.nextPosition.get(queueId)
      try {
        sql.addEntry.run(queueId, userId, position)
      } catch (error) {
        // The one_waiting_entry_per_user index is the last line of defence
        if (isUniqueViolation(error)) throw new QueueError(409, 'You are already in a queue.')
        throw error
      }
    })

    const result = myQueue(userId)
    recordHistory({ userId, serviceId: service.id, serviceName: service.name, outcome: 'Joined queue' })
    notify({
      userId,
      type: 'queue_joined',
      message: `You joined ${service.name}. Your position is #${result.entry.position}.`,
      serviceId: service.id,
      serviceName: service.name,
    })
    if (result.entry.position === 1) nextInLine(service, userId)
    return result
  }

  function leave(userId) {
    let row
    let next
    transaction(db, () => {
      row = sql.waitingForUser.get(userId)
      if (!row) throw new QueueError(409, 'You are not in a queue.')

      closeEntry(row.queue_id, row, 'canceled')
      if (row.position === 1) next = sql.firstWaiting.get(row.queue_id)
    })

    const service = getService(row.service_id)
    if (next && service) nextInLine(service, next.user_id)
    recordHistory({ userId, serviceId: service?.id ?? row.service_id, serviceName: service?.name ?? null, outcome: 'Left queue' })
  }

  // ---------- administrator actions ----------

  function list(id) {
    const service = requireService(id)
    const queueId = queueIdFor(service.id)
    if (queueId === undefined) return []

    return sql.waitingInQueue.all(queueId).map((entry) => ({
      entryId: entry.entry_id,
      userId: entry.user_id,
      email: getUserEmail(entry.user_id) ?? 'unknown',
      position: entry.position,
      joinedAt: entry.join_time,
    }))
  }

  function serveNext(id) {
    const service = requireService(id)
    let served
    let next
    transaction(db, () => {
      const queueId = queueIdFor(service.id)
      served = queueId === undefined ? undefined : sql.firstWaiting.get(queueId)
      if (!served) throw new QueueError(409, 'The queue is empty.')

      closeEntry(queueId, served, 'served')
      next = sql.firstWaiting.get(queueId)
    })

    recordHistory({ userId: served.user_id, serviceId: service.id, serviceName: service.name, outcome: 'Served' })
    notify({
      userId: served.user_id,
      type: 'served',
      message: `You've been served at ${service.name}.`,
      serviceId: service.id,
      serviceName: service.name,
    })
    if (next) nextInLine(service, next.user_id)
    return { served: { entryId: served.entry_id, userId: served.user_id } }
  }

  function remove(id, entryId) {
    const service = requireService(id)
    let removed
    let next
    transaction(db, () => {
      const queueId = queueIdFor(service.id)
      removed = findWaitingEntry(queueId, entryId)

      closeEntry(queueId, removed, 'canceled')
      if (removed.position === 1) next = sql.firstWaiting.get(queueId)
    })

    recordHistory({ userId: removed.user_id, serviceId: service.id, serviceName: service.name, outcome: 'Removed' })
    notify({
      userId: removed.user_id,
      type: 'removed',
      message: `You were removed from ${service.name}.`,
      serviceId: service.id,
      serviceName: service.name,
    })
    if (next) nextInLine(service, next.user_id)
  }

  // Relative moves ("up one") stay correct even if another admin changed the list meanwhile
  function move(id, entryId, direction) {
    if (direction !== 'up' && direction !== 'down') {
      throw new QueueError(400, 'Check the move and try again.', { direction: 'Direction must be up or down.' })
    }
    const service = requireService(id)

    transaction(db, () => {
      const queueId = queueIdFor(service.id)
      const entry = findWaitingEntry(queueId, entryId)
      const neighbour = sql.waitingAtPosition.get(queueId, direction === 'up' ? entry.position - 1 : entry.position + 1)
      if (!neighbour) {
        throw new QueueError(409, `Already ${direction === 'up' ? 'first' : 'last'} in the queue.`)
      }

      sql.setEntryPosition.run(neighbour.position, entry.entry_id)
      sql.setEntryPosition.run(entry.position, neighbour.entry_id)
    })
    return list(service.id)
  }

  return {
    myQueue, join, leave,
    list, serveNext, remove, move,
    queueLength: (id) => {
      const service = getService(id)
      const queueId = service ? queueIdFor(service.id) : undefined
      return queueId === undefined ? 0 : sql.countWaiting.get(queueId).total
    },
  }
}