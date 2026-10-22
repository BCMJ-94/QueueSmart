import test from 'node:test'
import assert from 'node:assert/strict'
import { validateFields, validateLogin, validateRegistration } from '../src/validation.js'

test('required fields: missing, null, and blank values are rejected', () => {
  const rules = { name: { label: 'Name', required: true } }
  assert.deepEqual(validateFields({}, rules), { name: 'Name is required.' })
  assert.deepEqual(validateFields({ name: null }, rules), { name: 'Name is required.' })
  assert.deepEqual(validateFields({ name: '   ' }, rules), { name: 'Name is required.' })
  assert.deepEqual(validateFields({ name: 'Ok' }, rules), {})
})

test('optional fields may be left out', () => {
  assert.deepEqual(validateFields({}, { note: { type: 'string', maxLength: 5 } }), {})
})

test('non-object input is treated as empty', () => {
  const rules = { name: { required: true } }
  assert.deepEqual(validateFields(null, rules), { name: 'name is required.' })
  assert.deepEqual(validateFields(['x'], rules), { name: 'name is required.' })
})

test('field types are checked', () => {
  assert.equal(validateFields({ a: 5 }, { a: { type: 'string' } }).a, 'a must be text.')
  assert.equal(validateFields({ a: '5' }, { a: { type: 'number' } }).a, 'a must be a number.')
  assert.equal(validateFields({ a: NaN }, { a: { type: 'number' } }).a, 'a must be a number.')
  assert.equal(validateFields({ a: 1.5 }, { a: { type: 'integer' } }).a, 'a must be a whole number.')
  assert.equal(validateFields({ a: 'yes' }, { a: { type: 'boolean' } }).a, 'a must be true or false.')
  assert.deepEqual(validateFields(
    { a: 'x', b: 2.5, c: 3, d: false },
    { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'integer' }, d: { type: 'boolean' } },
  ), {})
})

test('string length limits use the trimmed value', () => {
  const rules = { s: { label: 'S', type: 'string', minLength: 3, maxLength: 5 } }
  assert.equal(validateFields({ s: 'ab' }, rules).s, 'S must be at least 3 characters.')
  assert.equal(validateFields({ s: 'abcdef' }, rules).s, 'S must be 5 characters or fewer.')
  assert.deepEqual(validateFields({ s: '  abc  ' }, rules), {})
})

test('number range limits', () => {
  const rules = { n: { label: 'Duration', type: 'integer', min: 1, max: 480 } }
  assert.equal(validateFields({ n: 0 }, rules).n, 'Duration must be at least 1.')
  assert.equal(validateFields({ n: 481 }, rules).n, 'Duration must be 480 or less.')
  assert.deepEqual(validateFields({ n: 15 }, rules), {})
})

test('pattern with and without a custom message', () => {
  assert.equal(validateFields({ p: 'abc' }, { p: { pattern: /^\d+$/, patternMessage: 'Digits only.' } }).p, 'Digits only.')
  assert.equal(validateFields({ p: 'abc' }, { p: { pattern: /^\d+$/ } }).p, 'p is not in a valid format.')
})

test('oneOf limits a field to allowed values', () => {
  const rules = { priority: { oneOf: ['low', 'medium', 'high'] } }
  assert.equal(validateFields({ priority: 'urgent' }, rules).priority, 'priority must be one of: low, medium, high.')
  assert.deepEqual(validateFields({ priority: 'high' }, rules), {})
})

test('registration requires a valid email and an 8-128 character password', () => {
  assert.deepEqual(validateRegistration({ email: 'alex@example.com', password: 'valid-password' }), {})
  assert.deepEqual(validateRegistration({ email: 'not-an-email', password: 'short' }), {
    email: 'Enter a valid email address.',
    password: 'Password must be at least 8 characters.',
  })
  assert.deepEqual(validateRegistration({}), {
    email: 'Email is required.',
    password: 'Password is required.',
  })
  assert.deepEqual(validateRegistration({ email: 42, password: 12345678 }), {
    email: 'Email must be text.',
    password: 'Password must be text.',
  })
  assert.deepEqual(validateRegistration({ email: `${'a'.repeat(250)}@x.com`, password: 'p'.repeat(129) }), {
    email: 'Email must be 254 characters or fewer.',
    password: 'Password must be 128 characters or fewer.',
  })
})

test('login rejects malformed credentials', () => {
  assert.deepEqual(validateLogin({ email: 'alex@example.com', password: 'x' }), {})
  assert.deepEqual(validateLogin({ email: 'invalid', password: '' }), {
    email: 'Enter a valid email address.',
    password: 'Password is required.',
  })
})
