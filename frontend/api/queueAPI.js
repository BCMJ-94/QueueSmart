// frontend/queueApi.js
// Plain script (not an ES module): load it before the inline script in index.html.
//   <script src="queueApi.js"></script>
// It relies on the shared api() helper, which adds the session token and throws
// an Error with .status and .data when the server answers with an error.

// The API uses full field names; the UI's state object S uses short ones.
const fromApiService = (s) => ({
  id: s.id,
  name: s.name,
  desc: s.description,
  dur: s.duration,
  pri: s.priority,
  open: s.open,
  q: [],   // filled in once the queue endpoints exist (see queueLength below)
})

const toApiService = (s) => ({
  name: s.name,
  description: s.desc,
  duration: s.dur,
  priority: s.pri,
})

const queueApi = {
  // ---------- Services (built: GET/POST/PATCH /api/services) ----------
  async listServices() {
    const { services } = await api('/api/services')
    return services.map(fromApiService)
  },
  async createService(fields) {                       // fields: { name, desc, dur, pri }
    const { service } = await api('/api/services', { method: 'POST', body: toApiService(fields) })
    return fromApiService(service)
  },
  async updateService(id, fields) {                   // fields: any of { name, desc, dur, pri }
    const body = {}
    if (fields.name !== undefined) body.name = fields.name
    if (fields.desc !== undefined) body.description = fields.desc
    if (fields.dur !== undefined) body.duration = fields.dur
    if (fields.pri !== undefined) body.priority = fields.pri
    const { service } = await api(`/api/services/${id}`, { method: 'PATCH', body })
    return fromApiService(service)
  },
  async setServiceOpen(id, open) {                    // replaces tog()
    const { service } = await api(`/api/services/${id}`, { method: 'PATCH', body: { open } })
    return fromApiService(service)
  },

  // ---------- Queues ----------
  myQueue:     ()          => api('/api/queues/me'),                                   // { entry: null } or { entry: {...} }
  join:        (serviceId) => api(`/api/queues/${serviceId}/join`, { method: 'POST' }),
  leave:       ()          => api('/api/queues/me', { method: 'DELETE' }),

  // admin
  listQueue:   (serviceId) => api(`/api/queues/${serviceId}`),
  serveNext:   (serviceId) => api(`/api/queues/${serviceId}/serve-next`, { method: 'POST' }),
  removeEntry: (serviceId, entryId) =>
                 api(`/api/queues/${serviceId}/entries/${entryId}`, { method: 'DELETE' }),
  moveEntry:   (serviceId, entryId, direction) =>   // direction: 'up' | 'down'
                 api(`/api/queues/${serviceId}/entries/${entryId}/move`, { method: 'POST', body: { direction } }),

  // ---------- History (planned) ----------
  history:     ()          => api('/api/history'),
}