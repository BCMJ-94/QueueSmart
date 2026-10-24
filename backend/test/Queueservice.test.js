import assert from 'node:assert/strict'
import test from 'node:test'
import { QueueError, createQueueService } from '../src/queueService.js'

// The queue service gets its collaborators as plain functions, so the tests use
// small fakes: no catalog, auth service or HTTP server is involved.
function setup() {
  const catalog = new Map([
    ['1', { id: 1, name: 'General Consultation', duration: 15, open: true }],
    ['2', { id: 2, name: 'Urgent Care', duration: 10, open: true }],
    ['3', { id: 3, name: 'Music Lesson', duration: 30, open: false }],
  ])
  const emails = new Map([['ava', 'ava@example.com'], ['ben', 'ben@example.com'], ['cleo', 'cleo@example.com']])
  const history = []

  const queue = createQueueService({
    getService: (id) => catalog.get(String(id)),   // like the real catalog: text ids from URLs work too
    recordHistory: (event) => history.push(event),
    getUserEmail: (userId) => emails.get(userId),
  })
  return { queue, catalog, history }
}

const isQueueError = (status) => (error) => {
  assert.ok(error instanceof QueueError, `expected a QueueError, got ${error}`)
  assert.equal(error.status, status)
  return true
}

const positions = (queue, serviceId) => queue.list(serviceId).map((entry) => `${entry.userId}:${entry.position}`)

// ---------- join and myQueue ----------

test('the first person to join is at position 1, almost ready, with a one-slot wait', () => {
  const { queue } = setup()
  const { entry } = queue.join('ava', 1)

  assert.deepEqual(entry, {
    serviceId: 1,
    serviceName: 'General Consultation',
    position: 1,
    estimatedWaitMinutes: 15,
    status: 'almost-ready',
  })
})

test('people are served in the order they joined, and wait grows with position', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  const { entry } = queue.join('ben', 1)

  assert.equal(entry.position, 2)
  assert.equal(entry.estimatedWaitMinutes, 30)
  assert.equal(entry.status, 'waiting')
  assert.deepEqual(positions(queue, 1), ['ava:1', 'ben:2'])
})

test('join accepts the service id as text, the way it arrives from a URL', () => {
  const { queue } = setup()
  queue.join('ava', '1')
  assert.equal(queue.queueLength(1), 1)
  assert.equal(queue.myQueue('ava').entry.serviceId, 1)
})

test('join returns 404 for an unknown service and does not queue the user', () => {
  const { queue } = setup()
  assert.throws(() => queue.join('ava', 99), isQueueError(404))
  assert.throws(() => queue.join('ava', 'abc'), isQueueError(404))
  assert.deepEqual(queue.myQueue('ava'), { entry: null })
})

test('join returns 409 for a closed service', () => {
  const { queue } = setup()
  assert.throws(() => queue.join('ava', 3), isQueueError(409))
  assert.equal(queue.queueLength(3), 0)
  assert.deepEqual(queue.myQueue('ava'), { entry: null })
})

test('a user can only be in one queue, in the same service or another', () => {
  const { queue } = setup()
  queue.join('ava', 1)

  assert.throws(() => queue.join('ava', 1), isQueueError(409))
  assert.throws(() => queue.join('ava', 2), isQueueError(409))
  assert.equal(queue.queueLength(1), 1)
  assert.equal(queue.queueLength(2), 0)
})

test('each service has its own independent queue', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 2)
  queue.join('cleo', 1)

  assert.deepEqual(positions(queue, 1), ['ava:1', 'cleo:2'])
  assert.deepEqual(positions(queue, 2), ['ben:1'])
  assert.equal(queue.myQueue('ben').entry.position, 1)
  assert.equal(queue.myQueue('ben').entry.serviceName, 'Urgent Care')
})

test('myQueue returns { entry: null } for someone who is not queued', () => {
  const { queue } = setup()
  assert.deepEqual(queue.myQueue('ava'), { entry: null })
})

test('wait estimates use the service duration as it is now', () => {
  const { queue, catalog } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)

  catalog.get('1').duration = 20
  assert.equal(queue.myQueue('ben').entry.estimatedWaitMinutes, 40)
})

// ---------- leave ----------

test('leave removes the user, moves everyone behind them up, and records history', () => {
  const { queue, history } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  queue.join('cleo', 1)

  queue.leave('ben')

  assert.deepEqual(positions(queue, 1), ['ava:1', 'cleo:2'])
  assert.equal(queue.myQueue('cleo').entry.position, 2)
  assert.deepEqual(queue.myQueue('ben'), { entry: null })
  assert.deepEqual(history, [{ userId: 'ben', serviceId: 1, outcome: 'Left queue' }])
})

test('someone who left can join again, at the back', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  queue.leave('ava')

  const { entry } = queue.join('ava', 1)
  assert.equal(entry.position, 2)
  assert.deepEqual(positions(queue, 1), ['ben:1', 'ava:2'])
})

test('leave returns 409 when the user is not in a queue, and records nothing', () => {
  const { queue, history } = setup()
  assert.throws(() => queue.leave('ava'), isQueueError(409))
  assert.equal(history.length, 0)
})

test('a user who left one queue can join a different one', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.leave('ava')
  assert.equal(queue.join('ava', 2).entry.serviceId, 2)
})

// ---------- serveNext ----------

test('serveNext serves the first person, records history, and moves the next person up', () => {
  const { queue, history } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)

  const { served } = queue.serveNext(1)

  assert.equal(served.userId, 'ava')
  assert.deepEqual(history, [{ userId: 'ava', serviceId: 1, outcome: 'Served' }])
  assert.deepEqual(queue.myQueue('ava'), { entry: null })
  assert.equal(queue.myQueue('ben').entry.position, 1)
  assert.equal(queue.myQueue('ben').entry.status, 'almost-ready')
})

test('a served user is free to join a queue again', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.serveNext(1)
  assert.equal(queue.join('ava', 2).entry.position, 1)
})

test('serveNext only affects the service it is called for', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 2)

  queue.serveNext(1)
  assert.equal(queue.queueLength(1), 0)
  assert.equal(queue.queueLength(2), 1)
})

test('serveNext returns 409 for an empty queue and 404 for an unknown service', () => {
  const { queue, history } = setup()
  assert.throws(() => queue.serveNext(1), isQueueError(409))
  assert.throws(() => queue.serveNext(99), isQueueError(404))
  assert.equal(history.length, 0)
})

test('closing a service stops new joins but the people already waiting can still be served', () => {
  const { queue, catalog } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)

  catalog.get('1').open = false
  assert.throws(() => queue.join('cleo', 1), isQueueError(409))
  assert.equal(queue.queueLength(1), 2)
  assert.equal(queue.serveNext(1).served.userId, 'ava')

  catalog.get('1').open = true
  assert.equal(queue.join('cleo', 1).entry.position, 2)
})

// ---------- list ----------

test('list shows position, email and entry id in queue order', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)

  const entries = queue.list(1)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((entry) => [entry.position, entry.userId, entry.email]), [
    [1, 'ava', 'ava@example.com'],
    [2, 'ben', 'ben@example.com'],
  ])
  assert.notEqual(entries[0].entryId, entries[1].entryId)
  assert.ok(!Number.isNaN(Date.parse(entries[0].joinedAt)))
})

test('list falls back to "unknown" when a user has no email, and is empty for an empty queue', () => {
  const { queue } = setup()
  assert.deepEqual(queue.list(1), [])

  queue.join('mystery', 1)
  assert.equal(queue.list(1)[0].email, 'unknown')
})

test('list returns 404 for an unknown service', () => {
  const { queue } = setup()
  assert.throws(() => queue.list(99), isQueueError(404))
})

test('changing a list returned by list() does not change the real queue', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)

  queue.list(1).reverse().pop()
  assert.deepEqual(positions(queue, 1), ['ava:1', 'ben:2'])
})

// ---------- remove ----------

test('remove takes a person out of the middle, shifts the rest up, and records "Removed"', () => {
  const { queue, history } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  queue.join('cleo', 1)
  const benEntry = queue.list(1).find((entry) => entry.userId === 'ben').entryId

  queue.remove(1, benEntry)

  assert.deepEqual(positions(queue, 1), ['ava:1', 'cleo:2'])
  assert.deepEqual(queue.myQueue('ben'), { entry: null })
  assert.deepEqual(history, [{ userId: 'ben', serviceId: 1, outcome: 'Removed' }])
})

test('remove accepts the entry id as text, and the removed user can join again', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  const { entryId } = queue.list(1)[0]

  queue.remove('1', String(entryId))
  assert.equal(queue.queueLength(1), 0)
  assert.equal(queue.join('ava', 1).entry.position, 1)
})

test('remove returns 404 for an unknown entry, an unknown service, or an entry from another service', () => {
  const { queue, history } = setup()
  queue.join('ava', 1)
  const { entryId } = queue.list(1)[0]

  assert.throws(() => queue.remove(1, 9999), isQueueError(404))
  assert.throws(() => queue.remove(1, 'abc'), isQueueError(404))
  assert.throws(() => queue.remove(99, entryId), isQueueError(404))
  assert.throws(() => queue.remove(2, entryId), isQueueError(404))   // right id, wrong queue
  assert.equal(queue.queueLength(1), 1)
  assert.equal(history.length, 0)
})

test('an entry cannot be removed twice', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  const { entryId } = queue.list(1)[0]

  queue.remove(1, entryId)
  assert.throws(() => queue.remove(1, entryId), isQueueError(404))
})

// ---------- move ----------

test('move up and move down swap a person with their neighbour and return the new order', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  queue.join('cleo', 1)
  const cleo = queue.list(1)[2].entryId

  const afterUp = queue.move(1, cleo, 'up')
  assert.deepEqual(afterUp.map((entry) => `${entry.userId}:${entry.position}`), ['ava:1', 'cleo:2', 'ben:3'])
  assert.equal(queue.myQueue('cleo').entry.position, 2)
  assert.equal(queue.myQueue('ben').entry.position, 3)

  const afterDown = queue.move(1, cleo, 'down')
  assert.deepEqual(afterDown.map((entry) => entry.userId), ['ava', 'ben', 'cleo'])
})

test('moving someone to the front makes them next to be served', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  const ben = queue.list(1)[1].entryId

  queue.move(1, ben, 'up')
  assert.equal(queue.serveNext(1).served.userId, 'ben')
})

test('move returns 409 at either end of the queue and leaves the order unchanged', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  const [first, last] = queue.list(1).map((entry) => entry.entryId)

  assert.throws(() => queue.move(1, first, 'up'), isQueueError(409))
  assert.throws(() => queue.move(1, last, 'down'), isQueueError(409))
  assert.deepEqual(positions(queue, 1), ['ava:1', 'ben:2'])
})

test('move rejects any direction other than up or down with a field error', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  const { entryId } = queue.list(1)[1]

  for (const direction of ['left', '', undefined, null, 1]) {
    assert.throws(() => queue.move(1, entryId, direction), (error) => {
      assert.ok(error instanceof QueueError)
      assert.equal(error.status, 400)
      assert.ok(error.errors.direction)
      return true
    })
  }
  assert.deepEqual(positions(queue, 1), ['ava:1', 'ben:2'])
})

test('move returns 404 for an unknown entry or service', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  assert.throws(() => queue.move(1, 9999, 'up'), isQueueError(404))
  assert.throws(() => queue.move(99, 1, 'up'), isQueueError(404))
})

// ---------- queueLength, ids and errors ----------

test('queueLength counts the waiting people, and is 0 for an unknown service', () => {
  const { queue } = setup()
  assert.equal(queue.queueLength(1), 0)
  queue.join('ava', 1)
  queue.join('ben', 1)
  assert.equal(queue.queueLength(1), 2)
  assert.equal(queue.queueLength('1'), 2)
  assert.equal(queue.queueLength(99), 0)
})

test('entry ids are unique across all services and never reused', () => {
  const { queue } = setup()
  queue.join('ava', 1)
  queue.join('ben', 2)
  queue.leave('ava')
  queue.join('ava', 1)

  const ids = [...queue.list(1), ...queue.list(2)].map((entry) => entry.entryId)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(!ids.includes(1))   // ava's first entry id is gone for good, not handed out again
})

test('a QueueError carries a status, a message, and optional field errors', () => {
  const error = new QueueError(400, 'Bad.', { field: 'Why.' })
  assert.ok(error instanceof Error)
  assert.equal(error.status, 400)
  assert.equal(error.message, 'Bad.')
  assert.deepEqual(error.errors, { field: 'Why.' })
  assert.equal(new QueueError(404, 'Gone.').errors, undefined)
})

test('a full session: join, reorder, remove, serve and leave leave the queue consistent', () => {
  const { queue, history } = setup()
  queue.join('ava', 1)
  queue.join('ben', 1)
  queue.join('cleo', 1)

  const [, benEntry, cleoEntry] = queue.list(1).map((entry) => entry.entryId)
  queue.move(1, cleoEntry, 'up')          // ava, cleo, ben
  queue.remove(1, benEntry)               // ava, cleo
  assert.equal(queue.serveNext(1).served.userId, 'ava')
  queue.leave('cleo')

  assert.equal(queue.queueLength(1), 0)
  assert.deepEqual(history.map((event) => `${event.userId}:${event.outcome}`), [
    'ben:Removed', 'ava:Served', 'cleo:Left queue',
  ])
  for (const userId of ['ava', 'ben', 'cleo']) {
    assert.deepEqual(queue.myQueue(userId), { entry: null })
  }
})