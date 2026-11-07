import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'
import { createAuthService } from '../src/authService.js'
import { openDatabase } from '../src/db.js'

// Exercise the real Express routes over HTTP, including authentication and SQLite.
const db = openDatabase(':memory:')
const authService = createAuthService({ db })
const app = createApp({ authService, db })
let server
let baseUrl
let userOne
let userTwo

function listen(expressApp) {
  const instance = expressApp.listen(0, '127.0.0.1')
  return new Promise((resolve) => instance.once('listening', () => resolve(instance)))
}

function request(path, { token, json, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    options.body = JSON.stringify(json)
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${baseUrl}${path}`, { ...options, headers })
}

async function register(email) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { email, password: 'valid-password' },
  })
  assert.equal(response.status, 201)
  return response.json()
}

before(async () => {
  server = await listen(app)
  baseUrl = `http://127.0.0.1:${server.address().port}`
  userOne = await register('notifications-one@example.com')
  userTwo = await register('notifications-two@example.com')

  // The activity endpoint stores a service reference, so create a valid service row.
  db.prepare(`INSERT INTO Service (service_id, name, description, duration, priority, status)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run('clinic-1', 'Clinic', 'General clinic service', 15, 'medium', 'open')
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
})

test('notification and history endpoints reject requests without authentication', async () => {
  for (const [path, method] of [
    ['/api/notifications', 'GET'],
    ['/api/notifications/read-all', 'PATCH'],
    ['/api/notifications/1/read', 'PATCH'],
    ['/api/history', 'GET'],
    ['/api/activity', 'POST'],
  ]) {
    const response = await request(path, { method, json: method === 'POST' ? {} : undefined })
    assert.equal(response.status, 401, `${method} ${path} should require a token`)
  }
})

test('GET notifications returns an empty list and zero unread count initially', async () => {
  const response = await request('/api/notifications', { token: userOne.token })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { notifications: [], unreadCount: 0 })
})

test('queue activity creates a notification and history entry for queue_joined', async () => {
  const response = await request('/api/activity', {
    method: 'POST',
    token: userOne.token,
    json: { type: 'queue_joined', serviceId: 'clinic-1', serviceName: 'Clinic', position: 2 },
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.notification.type, 'queue_joined')
  assert.equal(body.notification.message, 'You joined Clinic. Your position is #2.')
  assert.equal(body.notification.read, false)
  assert.equal(body.notification.serviceId, 'clinic-1')
  assert.equal(body.history.length, 1)
  assert.equal(body.history[0].outcome, 'Joined queue')
  assert.equal(body.history[0].serviceName, 'Clinic')

  const notifications = await request('/api/notifications', { token: userOne.token })
  const notificationBody = await notifications.json()
  assert.equal(notificationBody.notifications.length, 1)
  assert.equal(notificationBody.unreadCount, 1)
})

test('GET history returns only the authenticated user activity', async () => {
  const response = await request('/api/history', { token: userOne.token })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.history.length, 1)
  assert.equal(body.history[0].userId, userOne.user.id)
  assert.equal(body.history[0].outcome, 'Joined queue')

  const otherUser = await request('/api/history', { token: userTwo.token })
  assert.deepEqual((await otherUser.json()).history, [])
})

test('a user cannot read or mark another user notification as read', async () => {
  const created = await request('/api/activity', {
    method: 'POST',
    token: userOne.token,
    json: { type: 'next_in_line', serviceId: 'clinic-1', serviceName: 'Clinic' },
  })
  const { notification } = await created.json()

  const forbiddenRead = await request(`/api/notifications/${notification.id}/read`, {
    method: 'PATCH', token: userTwo.token,
  })
  assert.equal(forbiddenRead.status, 404)
  assert.equal((await forbiddenRead.json()).message, 'Notification not found.')

  const ownNotifications = await request('/api/notifications', { token: userTwo.token })
  assert.deepEqual((await ownNotifications.json()).notifications, [])
})

test('PATCH notification read marks one notification as read and updates unread count', async () => {
  const created = await request('/api/activity', {
    method: 'POST', token: userTwo.token,
    json: { type: 'next_in_line', serviceId: 'clinic-1', serviceName: 'Clinic' },
  })
  const { notification } = await created.json()

  const marked = await request(`/api/notifications/${notification.id}/read`, {
    method: 'PATCH', token: userTwo.token,
  })
  assert.equal(marked.status, 200)
  assert.equal((await marked.json()).notification.read, true)

  const listed = await request('/api/notifications', { token: userTwo.token })
  assert.equal((await listed.json()).unreadCount, 0)
})

test('PATCH read-all marks every notification for the current user only', async () => {
  // Create unread notifications for both users here so this test does not depend on
  // what earlier tests left behind (user two's earlier notification is already read).
  for (const token of [userOne.token, userTwo.token]) {
    const created = await request('/api/activity', {
      method: 'POST', token,
      json: { type: 'next_in_line', serviceId: 'clinic-1', serviceName: 'Clinic' },
    })
    assert.equal(created.status, 201)
  }
  const response = await request('/api/notifications/read-all', {
    method: 'PATCH', token: userOne.token,
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.unreadCount, 0)
  assert.equal(body.notifications.every((item) => item.read), true)

  // Reading all notifications for user one must not change user two's unread count.
  const other = await request('/api/notifications', { token: userTwo.token })
  assert.equal((await other.json()).unreadCount, 1)
})

test('activity endpoint validates type, service details, and queue position', async () => {
  const invalidType = await request('/api/activity', {
    method: 'POST', token: userOne.token,
    json: { type: 'unknown', serviceId: 'clinic-1', serviceName: 'Clinic' },
  })
  assert.equal(invalidType.status, 400)
  assert.equal((await invalidType.json()).message, 'Unsupported queue activity type.')

  for (const json of [
    { type: 'served', serviceId: null, serviceName: 'Clinic' },
    { type: 'served', serviceId: '', serviceName: 'Clinic' },
    { type: 'served', serviceId: 'clinic-1' },
    { type: 'served', serviceId: 'clinic-1', serviceName: '   ' },
    { type: 'served', serviceId: 'clinic-1', serviceName: 'x'.repeat(101) },
  ]) {
    const response = await request('/api/activity', { method: 'POST', token: userOne.token, json })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).message, 'A valid serviceId and serviceName are required.')
  }

  for (const position of [undefined, 0, -1, 1.5, '1']) {
    const json = { type: 'queue_joined', serviceId: 'clinic-1', serviceName: 'Clinic' }
    if (position !== undefined) json.position = position
    const response = await request('/api/activity', { method: 'POST', token: userOne.token, json })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).message, 'A valid queue position is required for queue_joined.')
  }
})

test('queue_left and served activities add history with the matching outcome', async () => {
  for (const [type, outcome] of [['queue_left', 'Left queue'], ['served', 'Served']]) {
    const response = await request('/api/activity', {
      method: 'POST', token: userTwo.token,
      json: { type, serviceId: 'clinic-1', serviceName: 'Clinic' },
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.notification.type, type)
    assert.equal(body.history[0].outcome, outcome)
  }
})

test('next_in_line creates a notification but does not add a history entry', async () => {
  const beforeHistory = await request('/api/history', { token: userTwo.token })
  const beforeCount = (await beforeHistory.json()).history.length

  const response = await request('/api/activity', {
    method: 'POST', token: userTwo.token,
    json: { type: 'next_in_line', serviceId: 'clinic-1', serviceName: 'Clinic' },
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.match(body.notification.message, /You're next in line/)
  assert.equal(body.history.length, beforeCount)
})

test('marking a nonexistent notification as read returns 404', async () => {
  const response = await request('/api/notifications/999999/read', {
    method: 'PATCH', token: userOne.token,
  })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).message, 'Notification not found.')
})
