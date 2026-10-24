// backend/src/queueService.js
//
// Queue module: who is waiting for which service, in what order. In memory for now.
// Every operation is synchronous (no await between a check and the change it guards).
//
//
//   getService(id)   -> { id, name, duration, open } or undefined if there is no such service.
//                       `id` may be text (it comes from the URL), so the catalog decides how to match it.
//   recordHistory({ userId, serviceId, outcome })
//                    -> stores a history entry. outcome is 'Served', 'Left queue' or 'Removed'.
//   getUserEmail(userId) -> the user's email, or undefined

export class QueueError extends Error {
  constructor(status, message, errors) {
    super(message)
    this.status = status
    this.errors = errors
  }
}

export function createQueueService({ getService, recordHistory, getUserEmail, notify = () => {} }) {
  const queues = new Map()         // service.id -> [ { entryId, userId, joinedAt } ]  (index 0 = next up)
  const queuedByUser = new Map()   // userId -> service.id  (one queue per user)
  let nextEntryId = 1

  function requireService(id) {
    const service = getService(id)
    if (!service) throw new QueueError(404, 'Service not found.')
    return service
  }

  const queueFor = (serviceId) => {
    if (!queues.has(serviceId)) queues.set(serviceId, [])
    return queues.get(serviceId)
  }

  function findEntry(serviceId, entryId) {
    const queue = queueFor(serviceId)
    const index = queue.findIndex((entry) => String(entry.entryId) === String(entryId))
    if (index === -1) throw new QueueError(404, 'Queue entry not found.')
    return { queue, index }
  }

  // ---------- user actions ----------

  function myQueue(userId) {
    const serviceId = queuedByUser.get(userId)
    if (serviceId === undefined) return { entry: null }

    const service = requireService(serviceId)
    const position = queueFor(serviceId).findIndex((entry) => entry.userId === userId) + 1
    return {
      entry: {
        serviceId,
        serviceName: service.name,
        position,                                         
        estimatedWaitMinutes: position * service.duration,
        status: position === 1 ? 'almost-ready' : 'waiting',
      },
    }
  }

  function join(userId, id) {
    const service = requireService(id)
    if (!service.open) throw new QueueError(409, 'This queue is closed.')
    if (queuedByUser.has(userId)) throw new QueueError(409, 'You are already in a queue.')

    const entry = { entryId: nextEntryId++, userId, joinedAt: new Date().toISOString() }
    queueFor(service.id).push(entry)
    queuedByUser.set(userId, service.id)
    const result = myQueue(userId)
    notify({ userId, type: 'queue_joined', message: `You joined ${service.name}. Your position is #${result.entry.position}.`, serviceId: service.id, serviceName: service.name })
    if (result.entry.position === 1) notify({ userId, type: 'next_in_line', message: `You're next in line for ${service.name}. Please get ready.`, serviceId: service.id, serviceName: service.name })
    return result
  }

  function leave(userId) {
    const serviceId = queuedByUser.get(userId)
    if (serviceId === undefined) throw new QueueError(409, 'You are not in a queue.')

    const queue = queueFor(serviceId)
    const oldPosition = queue.findIndex((entry) => entry.userId === userId)
    queue.splice(oldPosition, 1)
    queuedByUser.delete(userId)
    const service = getService(serviceId)
    if (oldPosition === 0 && queue[0]) notify({ userId: queue[0].userId, type: 'next_in_line', message: `You're next in line for ${service.name}. Please get ready.`, serviceId: service.id, serviceName: service.name })
    recordHistory({ userId, serviceId, serviceName: service?.name ?? null, outcome: 'Left queue' })
  }

  // ---------- administrator actions ----------

  function list(id) {
    const service = requireService(id)
    return queueFor(service.id).map((entry, index) => ({
      entryId: entry.entryId,
      userId: entry.userId,
      email: getUserEmail(entry.userId) ?? 'unknown',
      position: index + 1,
      joinedAt: entry.joinedAt,
    }))
  }

  function serveNext(id) {
    const service = requireService(id)
    const entry = queueFor(service.id).shift()
    if (!entry) throw new QueueError(409, 'The queue is empty.')

    queuedByUser.delete(entry.userId)
    recordHistory({ userId: entry.userId, serviceId: service.id, serviceName: service.name, outcome: 'Served' })
    notify({ userId: entry.userId, type: 'served', message: `You've been served at ${service.name}.`, serviceId: service.id, serviceName: service.name })
    const next = queueFor(service.id)[0]
    if (next) notify({ userId: next.userId, type: 'next_in_line', message: `You're next in line for ${service.name}. Please get ready.`, serviceId: service.id, serviceName: service.name })
    return { served: { entryId: entry.entryId, userId: entry.userId } }
  }

  function remove(id, entryId) {
    const service = requireService(id)
    const { queue, index } = findEntry(service.id, entryId)
    const [entry] = queue.splice(index, 1)

    queuedByUser.delete(entry.userId)
    recordHistory({ userId: entry.userId, serviceId: service.id, serviceName: service.name, outcome: 'Removed' })
    notify({ userId: entry.userId, type: 'removed', message: `You were removed from ${service.name}.`, serviceId: service.id, serviceName: service.name })
    if (index === 0 && queue[0]) notify({ userId: queue[0].userId, type: 'next_in_line', message: `You're next in line for ${service.name}. Please get ready.`, serviceId: service.id, serviceName: service.name })
  }

  // Relative moves ("up one") stay correct even if another admin changed the list meanwhile
  function move(id, entryId, direction) {
    if (direction !== 'up' && direction !== 'down') {
      throw new QueueError(400, 'Check the move and try again.', { direction: 'Direction must be up or down.' })
    }
    const service = requireService(id)
    const { queue, index } = findEntry(service.id, entryId)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= queue.length) {
      throw new QueueError(409, `Already ${direction === 'up' ? 'first' : 'last'} in the queue.`)
    }
    ;[queue[index], queue[target]] = [queue[target], queue[index]]
    return list(service.id)
  }

  return {
    myQueue, join, leave,
    list, serveNext, remove, move,
    queueLength: (id) => {
      const service = getService(id)
      return service ? queueFor(service.id).length : 0
    },
  }
}