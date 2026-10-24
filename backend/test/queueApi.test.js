import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'
import { createAuthService } from '../src/authService.js'
//import service module here
//note: this test will not run until the service module is added and the appropriate calls are modified accordingly
//however, tests using dummy functions did pass
import { createQueueService } from '../src/queueService.js'

// Real HTTP requests against the app running on a random local port.
// The queue service is wired the way server.js will wire it: it reads services from the
// catalog, records history into an array, and looks up emails from the users made here.
const authService = createAuthService()
const catalogService = createCatalogService()
const emails = new Map()   // user id -> email
const history = []

const queueService = createQueueService({
  getService: (id) => { try { return catalogService.get(id) } catch { return undefined } },
  recordHistory: (event) => history.push(event),
  getUserEmail: (userId) => emails.get(userId),
})
const app = createApp({ authService, catalogService, queueService })
const appWithoutQueues = createApp({ authService })

let server
let serverWithoutQueues
let baseUrl
let baseUrlWithoutQueues
let adminToken
let counter = 0

function listen(expressApp) {
  const s = expressApp.listen(0, '127.0.0.1')
  return new Promise((resolve) => s.once('listening', () => resolve(s)))
}

before(async () => {
  await authService.seedAdministrator({ email: 'admin@example.com', password: 'admin-password' })
  server = await listen(app)
  serverWithoutQueues = await listen(appWithoutQueues)
  baseUrl = `http://127.0.0.1:${server.address().port}`
  baseUrlWithoutQueues = `http://127.0.0.1:${serverWithoutQueues.address().port}`
  adminToken = (await authService.login({ email: 'admin@example.com', password: 'admin-password' })).token
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => serverWithoutQueues.close(resolve))
})

function request(path, { token, json, base = baseUrl, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    options.body = JSON.stringify(json)
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(`${base}${path}`, { ...options, headers })
}

// Every test makes its own users and services, so tests never share a queue
async function signUp() {
  const email = `user${++counter}@example.com`
  const session = await authService.register({ email, password: 'valid-password' })
  emails.set(session.user.id, email)
  return { token: session.token, id: session.user.id, email }
}

async function newService(changes = {}) {
  const response = await request('/api/services', {
    method: 'POST',
    token: adminToken,
    json: { name: `Service ${++counter}`, description: 'Test service', duration: 10, priority: 'medium', ...changes },
  })
  return (await response.json()).service
}

const join = (user, service) => request(`/api/queues/${service.id}/join`, { method: 'POST', token: user.token })
const list = (service) => request(`/api/queues/${service.id}`, { token: adminToken })
const historyFor = (user) => history.filter((event) => event.userId === user.id).map((event) => event.outcome)

// ---------- access ----------

test('every queue route requires a signed-in user', async () => {
  const routes = [
    ['GET', '/api/queues/me'],
    ['DELETE', '/api/queues/me'],
    ['POST', '/api/queues/1/join'],
    ['GET', '/api/queues/1'],
    ['POST', '/api/queues/1/serve-next'],
    ['DELETE', '/api/queues/1/entries/1'],
    ['POST', '/api/queues/1/entries/1/move'],
  ]
  for (const [method, path] of routes) {
    const response = await request(path, { method })
    assert.equal(response.status, 401, `${method} ${path}`)
  }
})

test('administrator routes reject normal users with 403', async () => {
  const user = await signUp()
  const service = await newService()
  await join(user, service)
  const { entryId } = (await (await list(service)).json()).entries[0]

  const attempts = [
    ['GET', `/api/queues/${service.id}`],
    ['POST', `/api/queues/${service.id}/serve-next`],
    ['DELETE', `/api/queues/${service.id}/entries/${entryId}`],
    ['POST', `/api/queues/${service.id}/entries/${entryId}/move`],
  ]
  for (const [method, path] of attempts) {
    const response = await request(path, { method, token: user.token, json: method === 'POST' ? { direction: 'down' } : undefined })
    assert.equal(response.status, 403, `${method} ${path}`)
  }
  assert.equal((await (await list(service)).json()).entries.length, 1)   // nothing changed
})

test('queue routes do not exist when the app is built without a queue service', async () => {
  const user = await signUp()
  const response = await request('/api/queues/me', { token: user.token, base: baseUrlWithoutQueues })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).message, 'Not found.')
})

// ---------- join and my queue ----------

test('GET /me is { entry: null } when the user is not in a queue, even for an administrator', async () => {
  const user = await signUp()
  for (const token of [user.token, adminToken]) {
    const response = await request('/api/queues/me', { token })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { entry: null })   // "me" must not be read as a service id
  }
})

test('joining returns 201 with the position, wait and status, and GET /me agrees', async () => {
  const user = await signUp()
  const service = await newService({ name: 'Urgent Care', duration: 12 })

  const response = await join(user, service)
  assert.equal(response.status, 201)
  const { entry } = await response.json()
  assert.deepEqual(entry, {
    serviceId: service.id,
    serviceName: 'Urgent Care',
    position: 1,
    estimatedWaitMinutes: 12,
    status: 'almost-ready',
  })

  const me = await request('/api/queues/me', { token: user.token })
  assert.deepEqual((await me.json()).entry, entry)
})

test('people queue in the order they join', async () => {
  const [first, second] = [await signUp(), await signUp()]
  const service = await newService({ duration: 10 })

  await join(first, service)
  const { entry } = await (await join(second, service)).json()
  assert.equal(entry.position, 2)
  assert.equal(entry.estimatedWaitMinutes, 20)
  assert.equal(entry.status, 'waiting')
})

test('join returns 404 for an unknown service and 409 when closed or already queued', async () => {
  const user = await signUp()

  const unknown = await request('/api/queues/99999/join', { method: 'POST', token: user.token })
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).message, 'Service not found.')
  assert.equal((await request('/api/queues/abc/join', { method: 'POST', token: user.token })).status, 404)

  const closed = await newService()
  await request(`/api/services/${closed.id}`, { method: 'PATCH', token: adminToken, json: { open: false } })
  const closedJoin = await join(user, closed)
  assert.equal(closedJoin.status, 409)
  assert.equal((await closedJoin.json()).message, 'This queue is closed.')

  const open = await newService()
  assert.equal((await join(user, open)).status, 201)
  const again = await join(user, await newService())
  assert.equal(again.status, 409)
  assert.equal((await again.json()).message, 'You are already in a queue.')
})

// ---------- leave ----------

test('leaving returns 204, frees the user, and records history; leaving again is a 409', async () => {
  const user = await signUp()
  const service = await newService()
  await join(user, service)

  const left = await request('/api/queues/me', { method: 'DELETE', token: user.token })
  assert.equal(left.status, 204)
  assert.deepEqual(await (await request('/api/queues/me', { token: user.token })).json(), { entry: null })
  assert.deepEqual(historyFor(user), ['Left queue'])

  const again = await request('/api/queues/me', { method: 'DELETE', token: user.token })
  assert.equal(again.status, 409)
  assert.equal((await again.json()).message, 'You are not in a queue.')
  assert.equal((await join(user, service)).status, 201)   // free to join again
})

// ---------- administrator: list, serve, remove, move ----------

test('administrator lists a queue in order, with emails and entry ids', async () => {
  const [first, second] = [await signUp(), await signUp()]
  const service = await newService()
  await join(first, service)
  await join(second, service)

  const response = await list(service)
  assert.equal(response.status, 200)
  const { entries } = await response.json()
  assert.deepEqual(entries.map((entry) => [entry.position, entry.email]), [[1, first.email], [2, second.email]])
  assert.ok(entries.every((entry) => Number.isInteger(entry.entryId) && entry.joinedAt))

  assert.equal((await request('/api/queues/99999', { token: adminToken })).status, 404)
})

test('serve-next serves the first person, moves the next up, and records history', async () => {
  const [first, second] = [await signUp(), await signUp()]
  const service = await newService()
  await join(first, service)
  await join(second, service)

  const response = await request(`/api/queues/${service.id}/serve-next`, { method: 'POST', token: adminToken })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).served.userId, first.id)

  assert.deepEqual(await (await request('/api/queues/me', { token: first.token })).json(), { entry: null })
  assert.equal((await (await request('/api/queues/me', { token: second.token })).json()).entry.position, 1)
  assert.deepEqual(historyFor(first), ['Served'])
})

test('serve-next returns 409 for an empty queue and 404 for an unknown service', async () => {
  const service = await newService()
  const empty = await request(`/api/queues/${service.id}/serve-next`, { method: 'POST', token: adminToken })
  assert.equal(empty.status, 409)
  assert.equal((await empty.json()).message, 'The queue is empty.')

  const unknown = await request('/api/queues/99999/serve-next', { method: 'POST', token: adminToken })
  assert.equal(unknown.status, 404)
})

test('remove takes someone out with 204, shifts the rest up, and records "Removed"', async () => {
  const [first, second, third] = [await signUp(), await signUp(), await signUp()]
  const service = await newService()
  for (const user of [first, second, third]) await join(user, service)
  const middle = (await (await list(service)).json()).entries[1].entryId

  const removed = await request(`/api/queues/${service.id}/entries/${middle}`, { method: 'DELETE', token: adminToken })
  assert.equal(removed.status, 204)

  const { entries } = await (await list(service)).json()
  assert.deepEqual(entries.map((entry) => entry.email), [first.email, third.email])
  assert.equal((await (await request('/api/queues/me', { token: third.token })).json()).entry.position, 2)
  assert.deepEqual(historyFor(second), ['Removed'])
})

test('remove returns 404 for an unknown entry, or for an entry in a different service', async () => {
  const user = await signUp()
  const service = await newService()
  const other = await newService()
  await join(user, service)
  const { entryId } = (await (await list(service)).json()).entries[0]

  const unknown = await request(`/api/queues/${service.id}/entries/99999`, { method: 'DELETE', token: adminToken })
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).message, 'Queue entry not found.')
  const wrongQueue = await request(`/api/queues/${other.id}/entries/${entryId}`, { method: 'DELETE', token: adminToken })
  assert.equal(wrongQueue.status, 404)
  assert.equal((await (await list(service)).json()).entries.length, 1)
})

test('move reorders the queue and returns the new order', async () => {
  const users = [await signUp(), await signUp(), await signUp()]
  const service = await newService()
  for (const user of users) await join(user, service)
  const last = (await (await list(service)).json()).entries[2].entryId

  const up = await request(`/api/queues/${service.id}/entries/${last}/move`, { method: 'POST', token: adminToken, json: { direction: 'up' } })
  assert.equal(up.status, 200)
  const { entries } = await up.json()
  assert.deepEqual(entries.map((entry) => entry.email), [users[0].email, users[2].email, users[1].email])
  assert.equal((await (await request('/api/queues/me', { token: users[2].token })).json()).entry.position, 2)

  const down = await request(`/api/queues/${service.id}/entries/${last}/move`, { method: 'POST', token: adminToken, json: { direction: 'down' } })
  assert.deepEqual((await down.json()).entries.map((entry) => entry.email), users.map((user) => user.email))
})

test('move returns 409 at the ends, 400 for a bad or missing direction, and 404 for an unknown entry', async () => {
  const [first, second] = [await signUp(), await signUp()]
  const service = await newService()
  await join(first, service)
  await join(second, service)
  const [top, bottom] = (await (await list(service)).json()).entries.map((entry) => entry.entryId)
  const move = (entryId, json) => request(`/api/queues/${service.id}/entries/${entryId}/move`, { method: 'POST', token: adminToken, json })

  assert.equal((await move(top, { direction: 'up' })).status, 409)
  assert.equal((await move(bottom, { direction: 'down' })).status, 409)

  const badDirection = await move(top, { direction: 'sideways' })
  assert.equal(badDirection.status, 400)
  assert.ok((await badDirection.json()).errors.direction)

  const noBody = await request(`/api/queues/${service.id}/entries/${top}/move`, { method: 'POST', token: adminToken })
  assert.equal(noBody.status, 400)

  assert.equal((await move(99999, { direction: 'up' })).status, 404)
  const { entries } = await (await list(service)).json()
  assert.deepEqual(entries.map((entry) => entry.email), [first.email, second.email])   // order unchanged
})

test('closing a service blocks new joins but the people waiting can still be served', async () => {
  const [waiting, late] = [await signUp(), await signUp()]
  const service = await newService()
  await join(waiting, service)

  await request(`/api/services/${service.id}`, { method: 'PATCH', token: adminToken, json: { open: false } })
  assert.equal((await join(late, service)).status, 409)
  const served = await request(`/api/queues/${service.id}/serve-next`, { method: 'POST', token: adminToken })
  assert.equal(served.status, 200)
  assert.equal((await served.json()).served.userId, waiting.id)
})