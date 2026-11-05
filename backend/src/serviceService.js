
import { randomUUID } from 'node:crypto'

const VALID_STATUSES = ['open', 'closed']
const EDITABLE_FIELDS = ['name', 'description', 'duration', 'priority']

export function createServiceService(db) {
  if (!db) {
    throw new TypeError('A database connection is required.')
  }

  // Convert SQLite column names to the existing API response format.
  function mapService(row) {
    if (!row) return null

    return {
      id: row.service_id,
      name: row.name,
      description: row.description,
      duration: row.duration,
      priority: row.priority,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // GET all services.
  function list() {
    const rows = db.prepare(`
      SELECT *
      FROM Service
      ORDER BY created_at ASC
    `).all()

    return rows.map(mapService)
  }

  // GET one service by ID.
  function getById(id) {
    const row = db.prepare(`
      SELECT *
      FROM Service
      WHERE service_id = ?
    `).get(id)

    return mapService(row)
  }

  // CREATE a service.
  function create(data) {
    const id = randomUUID()

    db.prepare(`
      INSERT INTO Service (
        service_id,
        name,
        description,
        duration,
        priority
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      data.name.trim(),
      data.description.trim(),
      data.duration,
      data.priority
    )

    return getById(id)
  }

  // UPDATE an existing service.
  function update(id, changes) {
    const existing = getById(id)

    if (!existing) return null

    const fields = EDITABLE_FIELDS.filter(
      field => changes[field] !== undefined
    )

    if (fields.length === 0) {
      return existing
    }

    const values = fields.map(field => {
      const value = changes[field]

      return typeof value === 'string'
        ? value.trim()
        : value
    })

    const assignments = fields.map(
      field => `${field} = ?`
    )

    db.prepare(`
      UPDATE Service
      SET ${assignments.join(', ')},
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE service_id = ?
    `).run(...values, id)

    return getById(id)
  }

  // OPEN or CLOSE a service.
  function setStatus(id, status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new TypeError('Invalid service status.')
    }

    const result = db.prepare(`
      UPDATE Service
      SET status = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE service_id = ?
    `).run(status, id)

    if (result.changes === 0) {
      return null
    }

    return getById(id)
  }

  return {
    list,
    getById,
    create,
    update,
    setStatus,
  }
}
