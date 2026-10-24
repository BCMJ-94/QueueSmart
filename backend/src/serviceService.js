
import { randomUUID } from 'node:crypto'

const VALID_STATUSES = ['open', 'closed']

export function createServiceService() {
  const services = new Map()

  function list() {
    return Array.from(services.values(), service => ({ ...service }))
  }

  function getById(id) {
    const service = services.get(id)
    return service ? { ...service } : null
  }

  function create(data) {
    const now = new Date().toISOString()

    const service = {
      id: randomUUID(),
      name: data.name.trim(),
      description: data.description.trim(),
      duration: data.duration,
      priority: data.priority,
      status: 'closed',
      createdAt: now,
      updatedAt: now,
    }

    services.set(service.id, service)
    return { ...service }
  }

  function update(id, changes) {
    const existing = services.get(id)
    if (!existing) return null

    const updated = { ...existing }

    for (const field of ['name', 'description', 'duration', 'priority']) {
      if (changes[field] !== undefined) {
        updated[field] =
          typeof changes[field] === 'string'
            ? changes[field].trim()
            : changes[field]
      }
    }

    updated.updatedAt = new Date().toISOString()
    services.set(id, updated)

    return { ...updated }
  }

  function setStatus(id, status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new TypeError('Invalid service status.')
    }

    const existing = services.get(id)
    if (!existing) return null

    const updated = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    }

    services.set(id, updated)
    return { ...updated }
  }

  return {
    list,
    getById,
    create,
    update,
    setStatus,
  }
}
