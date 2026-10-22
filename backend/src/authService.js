import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { validateLogin, validateRegistration } from './validation.js'

// Authentication module: registration, login, and role handling.
// Users and sessions live in memory (no database until Assignment 4).

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

export const ROLES = { USER: 'User', ADMIN: 'Administrator' }

export class AuthError extends Error {
  constructor(status, message, errors) {
    super(message)
    this.status = status
    this.errors = errors
  }
}

async function hashPassword(password, salt) {
  const key = await scrypt(password, salt, KEY_LENGTH)
  return key.toString('hex')
}

// What the API returns about a user: never the salt or password hash
function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role }
}

export function createAuthService() {
  const usersByEmail = new Map()
  const usersById = new Map()
  const sessions = new Map()   // token -> user id

  // Used when the email is unknown, so a failed login takes the same time either way
  const dummySalt = randomBytes(16).toString('hex')
  const dummyHash = hashPassword('no-account-password', dummySalt)

  async function addUser({ email, password, role }) {
    const normalizedEmail = email.trim().toLowerCase()
    if (usersByEmail.has(normalizedEmail)) {
      throw new AuthError(409, 'An account with this email already exists.')
    }

    const salt = randomBytes(16).toString('hex')
    const user = {
      id: randomBytes(16).toString('hex'),
      email: normalizedEmail,
      role,
      salt,
      passwordHash: await hashPassword(password, salt),
    }

    usersByEmail.set(user.email, user)
    usersById.set(user.id, user)
    return user
  }

  function createSession(user) {
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, user.id)
    return { token, user: publicUser(user) }
  }

  return {
    // Public sign-up always creates a User, even if the request sends a role
    async register(input) {
      const errors = validateRegistration(input)
      if (Object.keys(errors).length > 0) {
        throw new AuthError(400, 'Check the registration details and try again.', errors)
      }

      const user = await addUser({ email: input.email, password: input.password, role: ROLES.USER })
      return createSession(user)
    },

    async login(input) {
      const errors = validateLogin(input)
      if (Object.keys(errors).length > 0) {
        throw new AuthError(400, 'Check the login details and try again.', errors)
      }

      const user = usersByEmail.get(input.email.trim().toLowerCase())
      const salt = user ? user.salt : dummySalt
      const expectedHash = user ? user.passwordHash : await dummyHash
      const actualHash = await hashPassword(input.password, salt)
      const matches = timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))

      if (!user || !matches) {
        throw new AuthError(401, 'Email or password is incorrect.')
      }

      return createSession(user)
    },

    getUserForToken(token) {
      const userId = sessions.get(token)
      const user = userId ? usersById.get(userId) : undefined
      return user ? publicUser(user) : null
    },

    revokeToken(token) {
      sessions.delete(token)
    },

    // Administrators are created by the server (from .env), never through public sign-up
    async seedAdministrator({ email, password }) {
      const errors = validateRegistration({ email, password })
      if (Object.keys(errors).length > 0) {
        throw new Error(`Invalid administrator configuration: ${JSON.stringify(errors)}`)
      }

      return publicUser(await addUser({ email, password, role: ROLES.ADMIN }))
    },
  }
}
