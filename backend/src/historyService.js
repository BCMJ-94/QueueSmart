// In-memory queue activity history, scoped to each user.
export function createHistoryService({ now = () => new Date().toISOString() } = {}) {
  const entries = []
  let nextId = 1
  function record({ userId, serviceId, serviceName = null, outcome, occurredAt } = {}) {
    if (!userId || !serviceId || !outcome) throw new TypeError('userId, serviceId, and outcome are required.')
    const entry = { id: String(nextId++), userId, serviceId, serviceName, outcome, occurredAt: occurredAt ?? now() }
    entries.push(entry)
    return { ...entry }
  }
  function list(userId) {
    return entries.filter((entry) => entry.userId === userId)
      .slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || Number(b.id) - Number(a.id))
      .map((entry) => ({ ...entry }))
  }
  return { record, list }
}
