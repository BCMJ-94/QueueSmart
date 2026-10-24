import { Router } from 'express'

const ACTIVITY_TYPES = new Set(['queue_joined', 'queue_left', 'served', 'next_in_line'])

export function createNotificationHistoryRoutes({ notificationService, historyService, requireAuth }) {
  const router = Router()

  // Authentication is attached to each real endpoint so unknown routes can still return 404.
  router.get('/notifications', requireAuth, (req, res) => {
    const notifications = notificationService.list(req.user.id)
    res.json({ notifications, unreadCount: notifications.filter((item) => !item.read).length })
  })
  router.patch('/notifications/read-all', requireAuth, (req, res) => {
    const notifications = notificationService.markAllRead(req.user.id)
    res.json({ notifications, unreadCount: 0 })
  })
  router.patch('/notifications/:id/read', requireAuth, (req, res) => {
    const notification = notificationService.markRead(req.user.id, req.params.id)
    if (!notification) return res.status(404).json({ message: 'Notification not found.' })
    return res.json({ notification })
  })
  router.get('/history', requireAuth, (req, res) => res.json({ history: historyService.list(req.user.id) }))

  // The current browser UI simulates queue operations locally. This authenticated
  // endpoint records those demo events in the same in-memory stores as the APIs.
  // When real queue routes are mounted, they should call these services directly instead.
  router.post('/activity', requireAuth, (req, res) => {
    const { type, serviceId, serviceName, position } = req.body ?? {}
    if (!ACTIVITY_TYPES.has(type)) {
      return res.status(400).json({ message: 'Unsupported queue activity type.' })
    }
    if ((serviceId === undefined || serviceId === null || String(serviceId).length === 0) ||
        typeof serviceName !== 'string' || !serviceName.trim() || serviceName.length > 100) {
      return res.status(400).json({ message: 'A valid serviceId and serviceName are required.' })
    }
    if (type === 'queue_joined' && (!Number.isInteger(position) || position < 1)) {
      return res.status(400).json({ message: 'A valid queue position is required for queue_joined.' })
    }

    const messages = {
      queue_joined: `You joined ${serviceName}. Your position is #${position}.`,
      queue_left: `You left ${serviceName}.`,
      served: `You've been served at ${serviceName}.`,
      next_in_line: `You're next in line for ${serviceName}. Please get ready.`,
    }
    const notification = notificationService.create({
      userId: req.user.id, type, message: messages[type], serviceId: String(serviceId), serviceName: serviceName.trim(),
    })
    const outcomes = { queue_joined: 'Joined queue', queue_left: 'Left queue', served: 'Served' }
    if (outcomes[type]) {
      historyService.record({ userId: req.user.id, serviceId: String(serviceId), serviceName: serviceName.trim(), outcome: outcomes[type] })
    }
    return res.status(201).json({ notification, history: historyService.list(req.user.id) })
  })

  return router
}
