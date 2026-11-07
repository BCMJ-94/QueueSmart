import { createApp } from './app.js'
import { createAuthService } from './authService.js'
import { createNotificationService } from './notificationService.js'
import { createHistoryService } from './historyService.js'
import { openDatabase } from './db.js'
import { createServiceService } from './serviceService.js'
import { createQueueService } from './queueService.js'

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')

const db = openDatabase()
const authService = createAuthService({ db })
const serviceService = createServiceService(db)
const notificationService = createNotificationService({ db })
const historyService = createHistoryService({ db })
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
if (Boolean(adminEmail) !== Boolean(adminPassword)) throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to seed an administrator.')
if (adminEmail && adminPassword && !authService.getUserForEmail?.(adminEmail)) {
  try { await authService.seedAdministrator({ email: adminEmail, password: adminPassword }) }
  catch (error) { if (!/already exists/i.test(error.message)) throw error }
}

const queueService = createQueueService({
  db,
  getService: (id) => serviceService.getById(id) ?? undefined,
  recordHistory: (event) => historyService.record(event),
  getUserEmail: (userId) => authService.getUserById(userId)?.email,
  notify: (event) => notificationService.create(event),
})
const app = createApp({ authService, db, serviceService, queueService,
  frontendOrigin: process.env.FRONTEND_ORIGIN, notificationService, historyService })
const server = app.listen(port, () => console.log(`QueueSmart API listening on http://localhost:${port}`))

function shutdown() {
  server.close(() => { db.close(); console.log('QueueSmart API server and database connection closed.') })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
