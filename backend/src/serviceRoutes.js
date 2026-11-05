
import express from 'express'
import { validateFields } from './validation.js'
import {
  requireAuthentication,
  requireAdministrator,
} from './authMiddleware.js'
import { isUniqueViolation } from './db.js'

const SERVICE_RULES = {
  name: {
    required: true,
    type: 'string',
    maxLength: 100,
  },
  description: {
    required: true,
    type: 'string',
    minLength: 1,
      maxLength: 500,
  },
  duration: {
    required: true,
    type: 'integer',
    min: 1,
    max: 480,
  },
  priority: {
    required: true,
    type: 'string',
    oneOf: ['low', 'medium', 'high'],
  },
}

const EDITABLE_FIELDS = Object.keys(SERVICE_RULES)
const STATUS_RULES = {
  status: {
    required: true,
    type: 'string',
    oneOf: ['open', 'closed'],
  },
}

function isRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
}

function rejectUnknownFields(body, allowedFields) {
  return Object.keys(body).filter(
    field => !allowedFields.includes(field),
  )
}

function sendValidationError(response, errors) {
  return response.status(400).json({
    message: 'Validation failed.',
    errors,
  })
}

function validateAllowedFields(body, allowedFields) {
  const unknown = rejectUnknownFields(body, allowedFields)

  if (unknown.length === 0) return null

  return Object.fromEntries(
    unknown.map(field => [
      field,
      `Unknown field: ${field}.`,
    ]),
  )
}

export function createServiceRoutes({
  authService,
  serviceService,
} = {}) {
  if (!authService) {
    throw new Error('An authentication service is required.')
  }

  if (!serviceService) {
      throw new Error('A service database implementation is required.')
  }

  const router = express.Router()
  const requireAuth = requireAuthentication(authService)

  // List services. The frontend can use status to distinguish
  // open services from closed services.
  router.get('/', requireAuth, (request, response) => {
    return response.json({
      services: serviceService.list(),
    })
  })

  // Create a service (administrator only).
  router.post(
    '/',
    requireAuth,
    requireAdministrator,
    (request, response) => {
      const body = request.body

      if (!isRecord(body)) {
        return response.status(400).json({
          message: 'Request body must be a JSON object.',
        })
      }

      const unknownErrors = validateAllowedFields(
        body,
        EDITABLE_FIELDS,
      )

      if (unknownErrors) {
        return sendValidationError(response, unknownErrors)
      }

      const errors = validateFields(body, SERVICE_RULES)

      if (Object.keys(errors).length > 0) {
        return sendValidationError(response, errors)
      }

      try {
        const service = serviceService.create(body)
        return response.status(201).json({ service })
      } catch (error) {
        if (isUniqueViolation(error)) {
            return response.status(409).json({
                message: 'A service with this name already exists.',
            })
        }

        throw error
      }
    },
  )

  // Update one or more editable fields (administrator only).
  router.put(
    '/:id',
    requireAuth,
    requireAdministrator,
    (request, response) => {
      const body = request.body

      if (!isRecord(body)) {
        return response.status(400).json({
          message: 'Request body must be a JSON object.',
        })
      }

      if (Object.keys(body).length === 0) {
        return sendValidationError(response, {
          body: 'Provide at least one field to update.',
        })
      }

      const unknownErrors = validateAllowedFields(
        body,
        EDITABLE_FIELDS,
      )

      if (unknownErrors) {
        return sendValidationError(response, unknownErrors)
      }

      // For partial updates, only validate fields supplied.
      const rules = Object.fromEntries(
        Object.keys(body).map(field => [
          field,
          { ...SERVICE_RULES[field], required: true },
        ]),
      )

      const errors = validateFields(body, rules)

      if (Object.keys(errors).length > 0) {
        return sendValidationError(response, errors)
      }

      let service
        try {
            service = serviceService.update(request.params.id, body)
        } catch (error) {
            if (isUniqueViolation(error)) {
                return response.status(409).json({
                    message: 'A service with this name already exists.',
                })
            }

            throw error
        }

      if (!service) {
        return response.status(404).json({
          message: 'Service not found.',
        })
      }

      return response.json({ service })
    },
  )

  // Open or close a service (administrator only).
  router.patch(
    '/:id/status',
    requireAuth,
    requireAdministrator,
    (request, response) => {
      const body = request.body

      if (!isRecord(body)) {
        return response.status(400).json({
          message: 'Request body must be a JSON object.',
        })
      }

      const unknownErrors = validateAllowedFields(
        body,
        Object.keys(STATUS_RULES),
      )

      if (unknownErrors) {
        return sendValidationError(response, unknownErrors)
      }

      const errors = validateFields(body, STATUS_RULES)

      if (Object.keys(errors).length > 0) {
        return sendValidationError(response, errors)
      }

      const service = serviceService.setStatus(
        request.params.id,
        body.status,
      )

      if (!service) {
        return response.status(404).json({
          message: 'Service not found.',
        })
      }

      return response.json({ service })
    },
  )

  return router
}
