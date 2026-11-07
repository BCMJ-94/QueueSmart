// SQLite-backed, per-user queue activity history.
export function createHistoryService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('A database connection is required.')
  const insert = db.prepare(`INSERT INTO History (user_id, service_id, service_name, outcome, occurred_at)
    VALUES (?, ?, ?, ?, ?)`)
  const selectByUser = db.prepare(`SELECT history_id AS id, user_id AS userId, service_id AS serviceId,
    service_name AS serviceName, outcome, occurred_at AS occurredAt
    FROM History WHERE user_id = ? ORDER BY occurred_at DESC, history_id DESC`)
  function record({ userId, serviceId = null, serviceName = null, outcome, occurredAt } = {}) {
    if (!userId || !outcome) throw new TypeError('userId and outcome are required.')
    const timestamp = occurredAt ?? now()
    const result = insert.run(userId, serviceId == null ? null : String(serviceId),
      serviceName, outcome, timestamp)
    return { id: String(result.lastInsertRowid), userId, serviceId: serviceId == null ? null : String(serviceId),
      serviceName, outcome, occurredAt: timestamp }
  }
  function list(userId) {
    if (!userId) throw new TypeError('userId is required.')
    return selectByUser.all(userId).map((row) => ({ ...row, id: String(row.id),
      serviceId: row.serviceId == null ? null : String(row.serviceId) }))
  }
  return { record, list }
}
