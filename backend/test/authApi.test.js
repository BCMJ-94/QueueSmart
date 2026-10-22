import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import express from 'express'
import { createApp } from '../src/app.js'
import { createAuthService } from '../src/authService.js'
import { requireAdministrator, requireAuthentication } from '../src/authMiddleware.js'

// Real HTTP requests against the app running on a random local port
const authService = createAuthService()
const app = createApp({ authService, frontendOrigin: 'https://queuesmart.example' })

// A small admin-only route, the way other modules will use the role middleware
const requireAuth = requireAuthentication(authService)
const roleApp = express()
roleApp.get('/admin-only', requireAuth, requireAdministrator, (request, response) => response.json({ ok: true }))

let server
let roleServer
let baseUrl
let roleUrl

function listen(expressApp) {
  const s = expressApp.listen(0, '127.0.0.1')
  return new Promise((resolve) => s.once('listening', () => resolve(s)))
}

before(async () => {
  await authService.seedAdministrator({ email: 'admin@example.com', password: 'admin-password' })
  server = await listen(app)
  roleServer = await listen(roleApp)
  baseUrl = `http://127.0.0.1:${server.address().port}`
  roleUrl = `http://127.0.0.1:${roleServer.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => roleServer.close(resolve))
})

function request(path, { token, json, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    options.body = JSON.stringify(json)
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers })
}

test('createApp requires an auth service', () => {
  assert.throws(() => createApp(), /authentication service is required/)
})

test('health endpoint confirms the API is running', async () => {
  const response = await request('/api/health')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('register, me, and logout work end to end', async () => {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'Sam@Example.com', password: 'valid-password', role: 'Administrator' },
  })
  assert.equal(registration.status, 201)
  const session = await registration.json()
  assert.equal(session.user.email, 'sam@example.com')
  assert.equal(session.user.role, 'User')
  assert.equal('passwordHash' in session.user, false)

  const me = await request('/api/auth/me', { token: session.token })
  assert.deepEqual((await me.json()).user, session.user)

  const logout = await request('/api/auth/logout', { method: 'POST', token: session.token })
  assert.equal(logout.status, 204)

  const afterLogout = await request('/api/auth/me', { token: session.token })
  assert.equal(afterLogout.status, 401)
  assert.equal((await afterLogout.json()).message, 'Session is invalid or expired.')
})

test('register returns 400 with field errors for invalid input', async () => {
  const response = await request('/api/auth/register', { method: 'POST', json: { email: 'nope', password: 'short' } })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.message, 'Check the registration details and try again.')
  assert.equal(body.errors.email, 'Enter a valid email address.')
  assert.equal(body.errors.password, 'Password must be at least 8 characters.')
})

test('register returns 409 for an existing email', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'admin@example.com', password: 'valid-password' },
  })
  assert.equal(response.status, 409)
})

test('login returns the role so the front end can show the right screens', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'admin@example.com', password: 'admin-password' },
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.role, 'Administrator')
})

test('login returns 401 for wrong credentials and 400 for missing ones', async () => {
  const wrong = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'admin@example.com', password: 'wrong-password' },
  })
  assert.equal(wrong.status, 401)

  const missing = await request('/api/auth/login', { method: 'POST', json: {} })
  assert.equal(missing.status, 400)
})

test('protected routes require a Bearer token', async () => {
  assert.equal((await request('/api/auth/me')).status, 401)
  const bad = await request('/api/auth/me', { token: 'made-up-token' })
  assert.equal(bad.status, 401)
})

test('administrator-only routes reject Users with 403', async () => {
  const user = await (await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'plain@example.com', password: 'valid-password' },
  })).json()
  const admin = await (await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'admin@example.com', password: 'admin-password' },
  })).json()

  const asUser = await fetch(`${roleUrl}/admin-only`, { headers: { Authorization: `Bearer ${user.token}` } })
  assert.equal(asUser.status, 403)

  const asAdmin = await fetch(`${roleUrl}/admin-only`, { headers: { Authorization: `Bearer ${admin.token}` } })
  assert.equal(asAdmin.status, 200)
})

test('unknown API routes return 404 JSON', async () => {
  const response = await request('/api/does-not-exist')
  assert.equal(response.status, 404)
  assert.equal((await response.json()).message, 'Not found.')
})

test('malformed and oversized JSON bodies are rejected', async () => {
  const malformed = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).message, 'Request body must be valid JSON.')

  const tooLarge = await request('/api/auth/login', { method: 'POST', json: { email: 'a'.repeat(20_000) } })
  assert.equal(tooLarge.status, 413)
})

test('CORS allows local front ends and the configured origin only', async () => {
  const local = await request('/api/health', { headers: { Origin: 'http://localhost:5500' } })
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5500')

  const configured = await request('/api/health', { headers: { Origin: 'https://queuesmart.example' } })
  assert.equal(configured.headers.get('access-control-allow-origin'), 'https://queuesmart.example')

  const other = await request('/api/health', { headers: { Origin: 'https://evil.example' } })
  assert.equal(other.status, 403)
})

test('unexpected errors return a generic 500 message', async (t) => {
  t.mock.method(console, 'error', () => {})
  t.mock.method(authService, 'login', async () => { throw new Error('boom') })
  const response = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'admin@example.com', password: 'admin-password' },
  })
  assert.equal(response.status, 500)
  assert.equal((await response.json()).message, 'An unexpected server error occurred.')
})
