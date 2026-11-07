// SQLite-backed, per-user notification storage.
export function createNotificationService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('A database connection is required.')
  const insert = db.prepare(`INSERT INTO Notification (user_id, type, message, service_id, status, created_at)
    VALUES (?, ?, ?, ?, 'sent', ?)`)
  const selectByUser = db.prepare(`SELECT notification_id AS id, user_id AS userId, type, message,
    service_id AS serviceId, status, created_at AS createdAt
    FROM Notification WHERE user_id = ? ORDER BY created_at DESC, notification_id DESC`)
  const selectOne = db.prepare(`SELECT notification_id AS id, user_id AS userId, type, message,
    service_id AS serviceId, status, created_at AS createdAt
    FROM Notification WHERE user_id = ? AND notification_id = ?`)
  function map(row) {
    if (!row) return null
    return { ...row, id: String(row.id), serviceId: row.serviceId == null ? null : String(row.serviceId),
      read: row.status === 'viewed' }
  }
  function list(userId) {
    if (!userId) throw new TypeError('userId is required.')
    return selectByUser.all(userId).map(map)
  }
  function create({ userId, type, message, serviceId = null } = {}) {
    if (!userId) throw new TypeError('userId is required.')
    if (!type || !message) throw new TypeError('type and message are required.')
    const result = insert.run(userId, type, message, serviceId == null ? null : String(serviceId), now())
    return map(selectOne.get(userId, result.lastInsertRowid))
  }
  function markRead(userId, id) {
    db.prepare("UPDATE Notification SET status = 'viewed' WHERE user_id = ? AND notification_id = ?")
      .run(userId, Number(id))
    return map(selectOne.get(userId, Number(id)))
  }
  function markAllRead(userId) {
    db.prepare("UPDATE Notification SET status = 'viewed' WHERE user_id = ? AND status = 'sent'").run(userId)
    return list(userId)
  }
  return { list, create, markRead, markAllRead,
    unreadCount: (userId) => list(userId).filter((item) => !item.read).length }
}
