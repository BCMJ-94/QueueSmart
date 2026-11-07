# QueueSmart backend

Express API backed by SQLite (`node:sqlite`, Node.js 22.13+). Accounts, services, notifications, and history are persisted in `data/queuesmart.db`. Session tokens and the active in-memory queue are process-local.

## Run

```bash
npm ci
cp .env.example .env
# Configure ADMIN_EMAIL and ADMIN_PASSWORD
npm run dev
```

The API listens on `http://localhost:3001`. Keep `.env`, `data/`, and `node_modules/` out of Git.

## Tests

```bash
npm test
npm run test:coverage
```

Notification/history tests create temporary databases. They verify notification ownership, sent/viewed state, history ownership, and persistence after database close/reopen.

## Notifications and history

`Notification` stores `user_id`, `type`, `message`, optional `service_id`, `status` (`sent` or `viewed`), and `created_at`. `History` stores `user_id`, optional service reference/name, `outcome`, and `occurred_at`. The service layer in `src/notificationService.js` and `src/historyService.js` accepts the shared SQLite connection.

Routes are authenticated and derive ownership from `request.user.id`:
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`
- `GET /api/history`

The browser loads these endpoints when opening the notification panel or History view.
