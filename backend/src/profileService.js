import { AuthError } from './authService.js'
import { openDatabase } from './db.js'
import { validateProfile } from './validation.js'

// Profile module: the signed-in user's name, contact details, and preferences,
// stored in the UserProfile table (one row per email in UserCredentials).

function toProfile(email, row) {
  return {
    email,
    fullName: row?.full_name ?? '',
    phone: row?.phone ?? '',
    preferences: row?.preferences ?? '',
    updatedAt: row?.updated_at ?? null,
  }
}

// Blank optional fields are stored as NULL
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function createProfileService({ db = openDatabase(':memory:') } = {}) {
  const findProfile = db.prepare('SELECT * FROM UserProfile WHERE email = ?')
  const saveProfile = db.prepare(`
    INSERT INTO UserProfile (email, full_name, phone, preferences, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT (email) DO UPDATE SET
      full_name = excluded.full_name,
      phone = excluded.phone,
      preferences = excluded.preferences,
      updated_at = excluded.updated_at
  `)

  return {
    // Returns empty fields when the user has not saved a profile yet
    get(email) {
      return toProfile(email, findProfile.get(email))
    },

    update(email, input) {
      const errors = validateProfile(input)
      if (Object.keys(errors).length > 0) {
        throw new AuthError(400, 'Check the profile details and try again.', errors)
      }

      saveProfile.run(email, input.fullName.trim(), optionalText(input.phone), optionalText(input.preferences))
      return toProfile(email, findProfile.get(email))
    },
  }
}
