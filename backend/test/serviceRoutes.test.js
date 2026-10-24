
import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { ROLES } from '../src/authService.js'

const admin = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: ROLES.ADMIN,
}

const regularUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
}

async function withServer(run) {
  const usersByToken = new Map([
    ['admin-token', admin],
    ['user-token', regularUser],
  ])

  const authService = {
    getUserForToken(token) {
      return usersByToken.get(token) ?? null
    },
  }

  const app = createApp({ authService })
  const server = app.listen(0)

  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  async function request(path, {
    method = 'GET',
    token,
    body,
  } = {}) {
    const headers = {}

    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
    })

    const text = await response.text()

    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
    }
  }

  try {
    await run(request)
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

const validService = {
  name: 'Consultation',
  description: 'General customer consultation',
  duration: 30,
  priority: 'medium',
}

test('GET services requires authentication', async () => {
  await withServer(async request => {
    const result = await request('/api/services')
    assert.equal(result.status, 401)
  })
})

test('regular users can list services', async () => {
  await withServer(async request => {
    const result = await request('/api/services', {
      token: 'user-token',
    })

    assert.equal(result.status, 200)
    assert.deepEqual(result.body.services, [])
  })
})

test('regular users cannot create services', async () => {
  await withServer(async request => {
    const result = await request('/api/services', {
      method: 'POST',
      token: 'user-token',
      body: validService,
    })

    assert.equal(result.status, 403)
  })
})

test('administrator can create and list a service', async () => {
  await withServer(async request => {
    const created = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body: validService,
    })

    assert.equal(created.status, 201)
    assert.equal(created.body.service.name, 'Consultation')
    assert.equal(created.body.service.duration, 30)
    assert.equal(created.body.service.priority, 'medium')
    assert.equal(created.body.service.status, 'closed')
    assert.ok(created.body.service.id)

    const listed = await request('/api/services', {
      token: 'user-token',
    })

    assert.equal(listed.status, 200)
    assert.equal(listed.body.services.length, 1)
    assert.equal(
      listed.body.services[0].id,
      created.body.service.id,
    )
  })
})

test('create rejects a missing name', async () => {
  await withServer(async request => {
    const { name, ...body } = validService

    const result = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body,
    })

    assert.equal(result.status, 400)
    assert.ok(result.body.errors.name)
  })
})

test('create rejects names over 100 characters', async () => {
  await withServer(async request => {
    const result = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body: { ...validService, name: 'x'.repeat(101) },
    })

    assert.equal(result.status, 400)
    assert.ok(result.body.errors.name)
  })
})

test('create rejects blank descriptions', async () => {
  await withServer(async request => {
    const result = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body: { ...validService, description: '   ' },
    })

    assert.equal(result.status, 400)
    assert.ok(result.body.errors.description)
  })
})

test('create rejects duration outside 1–480', async t => {
  for (const duration of [0, 481, 1.5, '30']) {
    await t.test(`duration ${JSON.stringify(duration)}`, async () => {
      await withServer(async request => {
        const result = await request('/api/services', {
          method: 'POST',
          token: 'admin-token',
          body: { ...validService, duration },
        })

        assert.equal(result.status, 400)
        assert.ok(result.body.errors.duration)
      })
    })
  }
})

test('create rejects unsupported priority', async () => {
  await withServer(async request => {
    const result = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body: { ...validService, priority: 'urgent' },
    })

    assert.equal(result.status, 400)
    assert.ok(result.body.errors.priority)
  })
})

test('administrator can update a service', async () => {
  await withServer(async request => {
    const created = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body: validService,
    })

    const id = created.body.service.id

    const updated = await request(`/api/services/${id}`, {
      method: 'PUT',
      token: 'admin-token',
      body: { duration: 45 },
    })

    assert.equal(updated.status, 200)
    assert.equal(updated.body.service.duration, 45)
    assert.equal(updated.body.service.name, 'Consultation')
  })
})

test('update rejects an empty body', async () => {
  await withServer(async request => {
    const result = await request('/api/services/some-id', {
      method: 'PUT',
      token: 'admin-token',
      body: {},
    })

    assert.equal(result.status, 400)
  })
})

test('update returns 404 for an unknown service', async () => {
  await withServer(async request => {
    const result = await request('/api/services/unknown-id', {
      method: 'PUT',
      token: 'admin-token',
      body: { duration: 45 },
    })

    assert.equal(result.status, 404)
  })
})

test('administrator can open and close a service', async () => {
  await withServer(async request => {
    const created = await request('/api/services', {
      method: 'POST',
      token: 'admin-token',
      body: validService,
    })

    const id = created.body.service.id

    const opened = await request(`/api/services/${id}/status`, {
      method: 'PATCH',
      token: 'admin-token',
      body: { status: 'open' },
    })

    assert.equal(opened.status, 200)
    assert.equal(opened.body.service.status, 'open')

    const closed = await request(`/api/services/${id}/status`, {
      method: 'PATCH',
      token: 'admin-token',
      body: { status: 'closed' },
    })

    assert.equal(closed.status, 200)
    assert.equal(closed.body.service.status, 'closed')
  })
})

test('status endpoint rejects an invalid status', async () => {
  await withServer(async request => {
    const result = await request('/api/services/some-id/status', {
      method: 'PATCH',
      token: 'admin-token',
      body: { status: 'paused' },
    })

    assert.equal(result.status, 400)
    assert.ok(result.body.errors.status)
  })
})

test('regular users cannot change service status', async () => {
  await withServer(async request => {
    const result = await request('/api/services/some-id/status', {
      method: 'PATCH',
      token: 'user-token',
      body: { status: 'open' },
    })

    assert.equal(result.status, 403)
  })
})
