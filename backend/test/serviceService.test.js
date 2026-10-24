
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServiceService } from '../src/serviceService.js'

function validService(overrides = {}) {
  return {
    name: 'Passport Service',
    description: 'Passport application assistance',
    duration: 30,
    priority: 'medium',
    ...overrides,
  }
}

test('creates a service with an ID, timestamps, and closed status', () => {
  const serviceService = createServiceService()

  const service = serviceService.create(validService())

  assert.ok(service.id)
  assert.equal(service.name, 'Passport Service')
  assert.equal(service.status, 'closed')
  assert.ok(service.createdAt)
  assert.ok(service.updatedAt)
  assert.deepEqual(serviceService.list(), [service])
})

test('trims name and description when creating a service', () => {
  const serviceService = createServiceService()

  const service = serviceService.create(validService({
    name: '  Passport Service  ',
    description: '  Help with applications  ',
  }))

  assert.equal(service.name, 'Passport Service')
  assert.equal(service.description, 'Help with applications')
})

test('creates services with unique IDs', () => {
  const serviceService = createServiceService()

  const first = serviceService.create(validService())
  const second = serviceService.create(validService({
    name: 'Driving Licence Service',
  }))

  assert.notEqual(first.id, second.id)
  assert.equal(serviceService.list().length, 2)
})

test('returns null for an unknown service ID', () => {
  const serviceService = createServiceService()

  assert.equal(serviceService.getById('missing-id'), null)
  assert.equal(serviceService.update('missing-id', { name: 'New' }), null)
  assert.equal(serviceService.setStatus('missing-id', 'open'), null)
})

test('updates supplied fields while preserving other fields', () => {
  const serviceService = createServiceService()
  const original = serviceService.create(validService())

  const updated = serviceService.update(original.id, {
    name: '  Updated Service  ',
    duration: 45,
  })

  assert.equal(updated.name, 'Updated Service')
  assert.equal(updated.duration, 45)
  assert.equal(updated.description, original.description)
  assert.equal(updated.priority, original.priority)
  assert.equal(updated.status, 'closed')
})

test('opens and closes a service', () => {
  const serviceService = createServiceService()
  const service = serviceService.create(validService())

  const opened = serviceService.setStatus(service.id, 'open')
  assert.equal(opened.status, 'open')

  const closed = serviceService.setStatus(service.id, 'closed')
  assert.equal(closed.status, 'closed')
})

test('rejects invalid service statuses', () => {
  const serviceService = createServiceService()

  assert.throws(
    () => serviceService.setStatus('any-id', 'pending'),
    { name: 'TypeError' },
  )
})

test('returned objects cannot mutate stored services', () => {
  const serviceService = createServiceService()
  const service = serviceService.create(validService())

  service.name = 'Tampered'
  assert.equal(serviceService.getById(service.id).name, 'Passport Service')

  const listed = serviceService.list()
  listed[0].name = 'Also Tampered'
  assert.equal(serviceService.getById(service.id).name, 'Passport Service')
})
