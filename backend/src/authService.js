import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { isUniqueViolation } from './db.js'
import { validateLogin, validateRegistration } from './validation.js'

// Authentication module: registration, login, and role handling.
// Sessions always live in memory. Accounts live in memory too, unless a database is passed
// to createAuthService({ db }): then they are stored in the UserCredentials table (the
// queue, history and notification tables point at it), loaded when the service starts,
// and every new account is saved there.

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

export function createAuthService({ db } = {}) {
  const usersByEmail = new Map()
  const usersById = new Map()
  const sessions = new Map()   // token -> user id

  const insertUser = db?.prepare(`
    INSERT INTO UserCredentials (user_id, email, password_salt, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `)
  if (db) {
    const rows = db.prepare('SELECT user_id, email, password_salt, password_hash, role FROM UserCredentials').all()
    for (const row of rows) {
      const user = { id: row.user_id, email: row.email, role: row.role, salt: row.password_salt, passwordHash: row.password_hash }
      usersByEmail.set(user.email, user)
      usersById.set(user.id, user)
    }
  }

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

    if (insertUser) {
      try {
        insertUser.run(user.id, user.email, user.salt, user.passwordHash, user.role)
      } catch (error) {
        // The database is the final judge of "email already taken", even for two sign-ups at once
        if (isUniqueViolation(error)) throw new AuthError(409, 'An account with this email already exists.')
        throw error
      }
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

    // Used by other modules (for example the queue list) to show who a user id belongs to
    getUserById(id) {
      const user = usersById.get(id)
      return user ? publicUser(user) : undefined
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