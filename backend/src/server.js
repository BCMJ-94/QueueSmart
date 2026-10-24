import { createApp } from './app.js'
import { createAuthService } from './authService.js'
import { createNotificationService } from './notificationService.js'
import { createHistoryService } from './historyService.js'

const { createServiceService } = require('./serviceService');

const serviceService = createServiceService()

const port = Number(process.env.PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.')
}

const authService = createAuthService()
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD

if (Boolean(adminEmail) !== Boolean(adminPassword)) {
  throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to seed an administrator.')
}
if (adminEmail && adminPassword) {
  await authService.seedAdministrator({ email: adminEmail, password: adminPassword })
}

const notificationService = createNotificationService()
const historyService = createHistoryService()
const app = createApp({ authService, frontendOrigin: process.env.FRONTEND_ORIGIN, notificationService, historyService })

app.listen(port, () => {
  console.log(`QueueSmart API listening on http://localhost:${port}`)
})

const queueService = createQueueService({
  getService: (id) => { try { return serviceService.getById(id) } catch { return undefined } },
  recordHistory: (event) => historyService.record(event),
  getUserEmail: (userId) => authService.getUserById(userId)?.email,
})