import cors from 'cors'
import express from 'express'
import { AuthError } from './authService.js'
import { requireAuthentication } from './authMiddleware.js'
import { createNotificationService } from './notificationService.js'
import { createHistoryService } from './historyService.js'
import { createNotificationHistoryRoutes } from './notificationHistoryRoutes.js'
import { QueueError } from './queueService.js'
import { createQueueRoutes } from './queueRoutes.js'
import { createServiceService } from './serviceService.js';
import { createServiceRoutes } from './serviceRoutes.js';

// Allows the front end when it is served from any localhost port
// (VS Code Live Server, npx serve, etc.) plus an optional configured origin.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function createApp({ authService, serviceService = createServiceService(), queueService, frontendOrigin, notificationService = createNotificationService(), historyService = createHistoryService() } = {}) {
  if (!authService) {
    throw new Error('An authentication service is required.')
  }

  const app = express()

  app.use(cors({
    origin(origin, callback) {
      if (!origin || LOCAL_ORIGIN.test(origin) || origin === frontendOrigin) {
        return callback(null, true)
      }
      return callback(Object.assign(new Error('Origin is not allowed by CORS.'), { status: 403 }))
    },
  }))
  app.use(express.json({ limit: '10kb' }))

  app.get('/api/health', (request, response) => {
    response.json({ status: 'ok' })
  })

  // ---------- Authentication module ----------
  const requireAuth = requireAuthentication(authService)

  app.post('/api/auth/register', async (request, response) => {
    response.status(201).json(await authService.register(request.body))
  })

  app.post('/api/auth/login', async (request, response) => {
    response.json(await authService.login(request.body))
  })

  app.get('/api/auth/me', requireAuth, (request, response) => {
    response.json({ user: request.user })
  })

  app.post('/api/auth/logout', requireAuth, (request, response) => {
    authService.revokeToken(request.authToken)
    response.status(204).end()
  })

  // --------- Service Module --------
  app.use(
    '/api/services',
    createServiceRoutes({
      authService,
      serviceService,
    })
  );

  // ---------- Queue module ----------
  // Only mounted when a queueService is passed in, so callers that don't use queues
  // (like the existing tests) keep working.
  if (queueService) {
    app.use('/api/queues', requireAuth, createQueueRoutes({ queueService }))
  }

  // ---------- Notifications and history ----------
  app.use('/api', createNotificationHistoryRoutes({ notificationService, historyService, requireAuth }))

  // Queue module routes can use these same service instances so queue events
  // create durable-for-this-process history and notifications.

  app.use('/api', (request, response) => {
    response.status(404).json({ message: 'Not found.' })
  })

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error)
    }

    if (error instanceof AuthError || error instanceof QueueError) {
      return response.status(error.status).json({
        message: error.message,
        ...(error.errors ? { errors: error.errors } : {}),
      })
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return response.status(400).json({ message: 'Request body must be valid JSON.' })
    }

    if (error.status === 403) {
      return response.status(403).json({ message: error.message })
    }

    if (error.status === 413) {
      return response.status(413).json({ message: 'Request body is too large.' })
    }

    console.error(error)
    return response.status(500).json({ message: 'An unexpected server error occurred.' })
  })

  // Expose service instances for module composition and focused integration tests.
  app.locals.notificationService = notificationService
  app.locals.historyService = historyService
  return app
}