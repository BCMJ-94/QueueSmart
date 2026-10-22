// Shared input validation for every module (required fields, field types, length limits).
// validateFields(input, rules) returns { field: message } for each invalid field; {} means valid.
//
// Rule options:
//   label       name used in messages (defaults to the field name)
//   required    value must be present and not blank
//   type        'string' | 'number' | 'integer' | 'boolean'
//   minLength / maxLength   string length limits (after trimming)
//   min / max   number range limits
//   pattern     RegExp a string must match, with patternMessage as its error
//   oneOf       list of allowed values

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkField(value, rule) {
  const label = rule.label
  const missing = value === undefined || value === null
    || (typeof value === 'string' && value.trim() === '')

  if (missing) {
    return rule.required ? `${label} is required.` : null
  }

  if (rule.type === 'string' && typeof value !== 'string') {
    return `${label} must be text.`
  }
  if (rule.type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) {
    return `${label} must be a number.`
  }
  if (rule.type === 'integer' && !Number.isInteger(value)) {
    return `${label} must be a whole number.`
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    return `${label} must be true or false.`
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (rule.minLength !== undefined && text.length < rule.minLength) {
      return `${label} must be at least ${rule.minLength} characters.`
    }
    if (rule.maxLength !== undefined && text.length > rule.maxLength) {
      return `${label} must be ${rule.maxLength} characters or fewer.`
    }
    if (rule.pattern && !rule.pattern.test(text)) {
      return rule.patternMessage ?? `${label} is not in a valid format.`
    }
  }

  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) {
      return `${label} must be at least ${rule.min}.`
    }
    if (rule.max !== undefined && value > rule.max) {
      return `${label} must be ${rule.max} or less.`
    }
  }

  if (rule.oneOf && !rule.oneOf.includes(value)) {
    return `${label} must be one of: ${rule.oneOf.join(', ')}.`
  }

  return null
}

export function validateFields(input, rules) {
  const data = isRecord(input) ? input : {}
  const errors = {}

  for (const [field, rule] of Object.entries(rules)) {
    const message = checkField(data[field], { label: field, ...rule })
    if (message) {
      errors[field] = message
    }
  }

  return errors
}

const EMAIL_RULE = {
  label: 'Email',
  required: true,
  type: 'string',
  maxLength: 254,
  pattern: EMAIL_PATTERN,
  patternMessage: 'Enter a valid email address.',
}

export function validateRegistration(input) {
  return validateFields(input, {
    email: EMAIL_RULE,
    password: { label: 'Password', required: true, type: 'string', minLength: 8, maxLength: 128 },
  })
}

export function validateLogin(input) {
  return validateFields(input, {
    email: EMAIL_RULE,
    password: { label: 'Password', required: true, type: 'string', maxLength: 128 },
  })
}
