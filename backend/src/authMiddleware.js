import { ROLES } from './authService.js'

// Role handling for every module's routes.
// requireAuthentication checks the "Authorization: Bearer <token>" header and sets request.user.
// requireAdministrator goes after it on admin-only routes.

export function requireAuthentication(authService) {
  return (request, response, next) => {
    const match = /^Bearer\s+(\S+)$/.exec(request.get('authorization') ?? '')
    if (!match) {
      return response.status(401).json({ message: 'Authentication required.' })
    }

    const user = authService.getUserForToken(match[1])
    if (!user) {
      return response.status(401).json({ message: 'Session is invalid or expired.' })
    }

    request.authToken = match[1]
    request.user = user
    return next()
  }
}

export function requireAdministrator(request, response, next) {
  if (request.user?.role !== ROLES.ADMIN) {
    return response.status(403).json({ message: 'Only administrators can do this.' })
  }
  return next()
}
