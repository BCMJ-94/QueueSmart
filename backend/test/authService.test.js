import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthError, ROLES, createAuthService } from '../src/authService.js'

test('register creates a User account, normalizes the email, and starts a session', async () => {
  const auth = createAuthService()
  const session = await auth.register({ email: '  Alex@Example.COM ', password: 'valid-password', role: 'Administrator' })

  assert.equal(session.user.email, 'alex@example.com')
  assert.equal(session.user.role, ROLES.USER)
  assert.ok(session.token)
  assert.deepEqual(Object.keys(session.user).sort(), ['email', 'id', 'role'])
  assert.deepEqual(auth.getUserForToken(session.token), session.user)
})

test('register rejects invalid input with 400 and field errors', async () => {
  const auth = createAuthService()
  await assert.rejects(auth.register({ email: 'bad', password: 'short' }), (error) => {
    assert.ok(error instanceof AuthError)
    assert.equal(error.status, 400)
    assert.ok(error.errors.email)
    assert.ok(error.errors.password)
    return true
  })
})

test('register rejects a duplicate email with 409', async () => {
  const auth = createAuthService()
  await auth.register({ email: 'alex@example.com', password: 'valid-password' })
  await assert.rejects(
    auth.register({ email: 'ALEX@example.com', password: 'other-password' }),
    { status: 409, message: 'An account with this email already exists.' },
  )
})

test('login succeeds with correct credentials and returns a new token', async () => {
  const auth = createAuthService()
  const first = await auth.register({ email: 'alex@example.com', password: 'valid-password' })
  const second = await auth.login({ email: 'Alex@example.com', password: 'valid-password' })

  assert.equal(second.user.id, first.user.id)
  assert.notEqual(second.token, first.token)
})

test('login gives the same 401 for a wrong password and an unknown email', async () => {
  const auth = createAuthService()
  await auth.register({ email: 'alex@example.com', password: 'valid-password' })
  const expected = { status: 401, message: 'Email or password is incorrect.' }

  await assert.rejects(auth.login({ email: 'alex@example.com', password: 'wrong-password' }), expected)
  await assert.rejects(auth.login({ email: 'nobody@example.com', password: 'valid-password' }), expected)
})

test('login rejects malformed input with 400', async () => {
  const auth = createAuthService()
  await assert.rejects(auth.login({ email: '', password: '' }), { status: 400 })
})

test('revokeToken ends the session', async () => {
  const auth = createAuthService()
  const { token } = await auth.register({ email: 'alex@example.com', password: 'valid-password' })
  auth.revokeToken(token)
  assert.equal(auth.getUserForToken(token), null)
  assert.equal(auth.getUserForToken('not-a-token'), null)
})

test('seedAdministrator creates an Administrator who can log in', async () => {
  const auth = createAuthService()
  const admin = await auth.seedAdministrator({ email: 'admin@example.com', password: 'admin-password' })
  assert.equal(admin.role, ROLES.ADMIN)

  const session = await auth.login({ email: 'admin@example.com', password: 'admin-password' })
  assert.equal(session.user.role, ROLES.ADMIN)
})

test('seedAdministrator rejects an invalid configuration', async () => {
  const auth = createAuthService()
  await assert.rejects(
    auth.seedAdministrator({ email: 'not-an-email', password: 'short' }),
    /Invalid administrator configuration/,
  )
})
