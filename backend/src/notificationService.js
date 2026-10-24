// In-memory, per-user notification store. Data is intentionally lost on restart.
export function createNotificationService({ now = () => new Date().toISOString() } = {}) {
  const notificationsByUser = new Map()
  let nextId = 1
  function list(userId) {
    return (notificationsByUser.get(userId) ?? []).map((item) => ({ ...item }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
  }
  function create({ userId, type, message, serviceId = null, serviceName = null }) {
    if (!userId) throw new TypeError('userId is required.')
    if (!type || !message) throw new TypeError('type and message are required.')
    const item = { id: String(nextId++), userId, type, message, serviceId, serviceName, read: false, createdAt: now() }
    if (!notificationsByUser.has(userId)) notificationsByUser.set(userId, [])
    notificationsByUser.get(userId).push(item)
    return { ...item }
  }
  function markRead(userId, id) {
    const item = (notificationsByUser.get(userId) ?? []).find((n) => n.id === String(id))
    if (!item) return null
    item.read = true
    return { ...item }
  }
  function markAllRead(userId) {
    for (const item of notificationsByUser.get(userId) ?? []) item.read = true
    return list(userId)
  }
  return { list, create, markRead, markAllRead, unreadCount: (userId) => list(userId).filter((n) => !n.read).length }
}
