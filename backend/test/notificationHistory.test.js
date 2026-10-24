import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'
import { createAuthService } from '../src/authService.js'
import { createNotificationService } from '../src/notificationService.js'
import { createHistoryService } from '../src/historyService.js'
import { createQueueService } from '../src/queueService.js'

const authService = createAuthService()
const notificationService = createNotificationService({ now: () => '2026-10-01T10:00:00.000Z' })
const historyService = createHistoryService({ now: () => '2026-10-01T10:00:00.000Z' })
const app = createApp({ authService, notificationService, historyService })
let server, baseUrl, userA, userB
const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1'); s.once('listening', () => resolve(s)) })
before(async () => {
  server = await listen(app); baseUrl = `http://127.0.0.1:${server.address().port}`
  userA = await (await fetch(`${baseUrl}/api/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:'notify-a@example.com',password:'valid-password'}) })).json()
  userB = await (await fetch(`${baseUrl}/api/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:'notify-b@example.com',password:'valid-password'}) })).json()
})
after(async () => { await new Promise((resolve) => server.close(resolve)) })
function req(path, { token, method = 'GET', body } = {}) { return fetch(baseUrl + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }) }

test('notification and history endpoints require authentication', async () => {
  assert.equal((await req('/api/notifications')).status, 401)
  assert.equal((await req('/api/history')).status, 401)
})
test('notification API lists only the signed-in user notifications and supports read states', async () => {
  notificationService.create({ userId: userA.user.id, type:'queue_joined', message:'Joined queue' })
  notificationService.create({ userId: userB.user.id, type:'queue_joined', message:'Private notification' })
  const response = await req('/api/notifications', { token:userA.token })
  const body = await response.json()
  assert.equal(response.status, 200); assert.equal(body.notifications.length, 1); assert.equal(body.unreadCount, 1)
  const id = body.notifications[0].id
  assert.equal((await req(`/api/notifications/${id}/read`, { token:userA.token, method:'PATCH' })).status, 200)
  assert.equal((await (await req('/api/notifications', { token:userA.token })).json()).unreadCount, 0)
  assert.equal((await req('/api/notifications/999/read', { token:userA.token, method:'PATCH' })).status, 404)
  notificationService.create({ userId:userA.user.id, type:'next_in_line', message:'You are next' })
  assert.equal((await req('/api/notifications/read-all', { token:userA.token, method:'PATCH' })).status, 200)
})
test('history API returns only the signed-in user history', async () => {
  historyService.record({ userId:userA.user.id, serviceId:'1', serviceName:'General Consultation', outcome:'Left queue' })
  historyService.record({ userId:userB.user.id, serviceId:'2', serviceName:'Private', outcome:'Served' })
  const body = await (await req('/api/history', { token:userA.token })).json()
  assert.equal(body.history.length, 1); assert.equal(body.history[0].outcome, 'Left queue')
})
test('queue join and serve events trigger notifications and history', () => {
  const notifications = [], history = []
  const queue = createQueueService({ getService: (id) => ({ id:String(id), name:'Consultation', duration:10, open:true }), recordHistory: (event) => history.push(event), getUserEmail: () => 'user@example.com', notify: (event) => notifications.push(event) })
  queue.join('first-user', '1'); queue.join('second-user', '1')
  assert.equal(notifications[0].type, 'queue_joined')
  queue.serveNext('1')
  assert.ok(notifications.some((n) => n.userId === 'first-user' && n.type === 'served'))
  assert.ok(notifications.some((n) => n.userId === 'second-user' && n.type === 'next_in_line'))
  assert.equal(history[0].outcome, 'Served'); assert.equal(history[0].serviceName, 'Consultation')
})


test('frontend queue activity creates API notifications and history for the signed-in user', async () => {
  const event = { type: 'queue_joined', serviceId: '42', serviceName: 'Demo Clinic', position: 2 }
  const response = await req('/api/activity', { token: userA.token, method: 'POST', body: event })
  const result = await response.json()
  assert.equal(response.status, 201)
  assert.equal(result.notification.type, 'queue_joined')
  assert.match(result.notification.message, /Demo Clinic.*#2/)
  const notifications = await (await req('/api/notifications', { token: userA.token })).json()
  assert.ok(notifications.notifications.some((item) => item.message === result.notification.message))
  const history = await (await req('/api/history', { token: userA.token })).json()
  assert.ok(history.history.some((item) => item.serviceId === '42' && item.outcome === 'Joined queue'))
})

test('queue activity rejects unauthenticated or invalid events', async () => {
  assert.equal((await req('/api/activity', { method: 'POST', body: { type: 'served', serviceId: '1', serviceName: 'Clinic' } })).status, 401)
  const response = await req('/api/activity', { token: userA.token, method: 'POST', body: { type: 'arbitrary', serviceId: '1', serviceName: 'Clinic' } })
  assert.equal(response.status, 400)
})
