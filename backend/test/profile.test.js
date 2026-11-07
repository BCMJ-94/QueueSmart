import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'
import { createAuthService } from '../src/authService.js'
import { openDatabase } from '../src/db.js'
import { createProfileService } from '../src/profileService.js'
import { validateProfile } from '../src/validation.js'

// ---------- profile service ----------

async function setup() {
  const db = openDatabase(':memory:')
  const auth = createAuthService({ db })
  const profiles = createProfileService({ db })
  return { db, auth, profiles }
}

test('get returns empty fields before a profile is saved', async () => {
  const { auth, profiles } = await setup()
  await auth.register({ email: 'sam@example.com', password: 'valid-password' })

  assert.deepEqual(profiles.get('sam@example.com'), {
    email: 'sam@example.com', fullName: '', phone: '', preferences: '', updatedAt: null,
  })
})

test('register with a full name creates the profile row', async () => {
  const { auth, profiles } = await setup()
  await auth.register({ email: 'sam@example.com', password: 'valid-password', fullName: '  Sam Rivera ' })
  assert.equal(profiles.get('sam@example.com').fullName, 'Sam Rivera')
})

test('update creates, then replaces, the profile and trims values', async () => {
  const { auth, profiles } = await setup()
  await auth.register({ email: 'sam@example.com', password: 'valid-password' })

  const created = profiles.update('sam@example.com', { fullName: ' Sam ', phone: ' 713-555-0100 ', preferences: 'Text me' })
  assert.equal(created.fullName, 'Sam')
  assert.equal(created.phone, '713-555-0100')
  assert.equal(created.preferences, 'Text me')
  assert.ok(created.updatedAt)

  const updated = profiles.update('sam@example.com', { fullName: 'Sam Rivera', phone: '', preferences: '   ' })
  assert.equal(updated.fullName, 'Sam Rivera')
  assert.equal(updated.phone, '')        // blank optional fields are cleared
  assert.equal(updated.preferences, '')
})

test('update rejects invalid input with 400 and field errors', async () => {
  const { auth, profiles } = await setup()
  await auth.register({ email: 'sam@example.com', password: 'valid-password' })

  assert.throws(() => profiles.update('sam@example.com', { fullName: '', phone: 'call me', preferences: 'x'.repeat(501) }), (error) => {
    assert.equal(error.status, 400)
    assert.deepEqual(Object.keys(error.errors).sort(), ['fullName', 'phone', 'preferences'])
    return true
  })
})

test('validateProfile checks types and length limits', () => {
  assert.deepEqual(validateProfile({ fullName: 'Sam' }), {})
  assert.deepEqual(validateProfile({ fullName: 'Sam', phone: '+1 (713) 555-0100' }), {})
  assert.equal(validateProfile({ fullName: 42 }).fullName, 'Full name must be text.')
  assert.equal(validateProfile({ fullName: 'x'.repeat(101) }).fullName, 'Full name must be 100 characters or fewer.')
  assert.equal(validateProfile({ fullName: 'Sam', phone: '12' }).phone, 'Enter a valid phone number.')
  assert.equal(validateProfile(null).fullName, 'Full name is required.')
})

// ---------- profile API ----------

const db = openDatabase(':memory:')
const authService = createAuthService({ db })
const app = createApp({ authService, db })   // profile and authentication share the same database
let server
let baseUrl

before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function request(path, { token, json, method = 'GET' } = {}) {
  const headers = {}
  if (json !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${baseUrl}${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) })
}

test('GET and PUT /api/profile save and return the signed-in user\'s profile', async () => {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'jo@example.com', password: 'valid-password', fullName: 'Jo Park' },
  })
  assert.equal(registration.status, 201)
  const { token } = await registration.json()

  const first = await request('/api/profile', { token })
  assert.equal(first.status, 200)
  assert.equal((await first.json()).profile.fullName, 'Jo Park')

  const saved = await request('/api/profile', { method: 'PUT', token, json: { fullName: 'Jo Park', phone: '7135550100' } })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).profile.phone, '7135550100')

  // A later request reads the same data back from the database
  const again = await request('/api/profile', { token })
  const { profile } = await again.json()
  assert.equal(profile.email, 'jo@example.com')
  assert.equal(profile.phone, '7135550100')
})

test('PUT /api/profile returns 400 with field errors for bad input', async () => {
  const { token } = await (await request('/api/auth/register', {
    method: 'POST', json: { email: 'lee@example.com', password: 'valid-password' },
  })).json()

  const response = await request('/api/profile', { method: 'PUT', token, json: { fullName: '' } })
  assert.equal(response.status, 400)
  assert.ok((await response.json()).errors.fullName)
})

test('profile routes require sign-in', async () => {
  assert.equal((await request('/api/profile')).status, 401)
  assert.equal((await request('/api/profile', { method: 'PUT', json: { fullName: 'X' } })).status, 401)
})
