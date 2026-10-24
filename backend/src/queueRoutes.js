import { Router } from 'express'
import { requireAdministrator } from './authMiddleware.js'

// Routes for the queue module. app.js mounts this at /api/queues behind
// requireAuthentication, so every route here already has request.user.
//
//   GET    /me                                  my queue entry (or { entry: null })
//   DELETE /me                                  leave my queue
//   POST   /:serviceId/join                     join a service's queue
//
//   GET    /:serviceId                          administrator: list a queue in order
//   POST   /:serviceId/serve-next               administrator: serve the first person
//   DELETE /:serviceId/entries/:entryId         administrator: remove someone
//   POST   /:serviceId/entries/:entryId/move    administrator: move someone up or down
//
// Errors thrown by queueService (QueueError) are turned into 400/404/409 responses
// by the error handler in app.js, so the handlers below don't catch anything.

export function createQueueRoutes({ queueService }) {
  const router = Router()

  // "/me" routes come first so "me" is never read as a service id
  router.get('/me', (request, response) => {
    response.json(queueService.myQueue(request.user.id))
  })

  router.delete('/me', (request, response) => {
    queueService.leave(request.user.id)
    response.status(204).end()
  })

  // No body: the signed-in user is the one joining
  router.post('/:serviceId/join', (request, response) => {
    response.status(201).json(queueService.join(request.user.id, request.params.serviceId))
  })

  // ---------- administrator routes ----------

  router.get('/:serviceId', requireAdministrator, (request, response) => {
    response.json({ entries: queueService.list(request.params.serviceId) })
  })

  router.post('/:serviceId/serve-next', requireAdministrator, (request, response) => {
    response.json(queueService.serveNext(request.params.serviceId))
  })

  router.delete('/:serviceId/entries/:entryId', requireAdministrator, (request, response) => {
    queueService.remove(request.params.serviceId, request.params.entryId)
    response.status(204).end()
  })

  // Body: { direction: 'up' | 'down' }. request.body is undefined when no body was sent,
  // and queueService turns a missing direction into a 400 with a field error.
  router.post('/:serviceId/entries/:entryId/move', requireAdministrator, (request, response) => {
    const entries = queueService.move(request.params.serviceId, request.params.entryId, request.body?.direction)
    response.json({ entries })
  })

  return router
}