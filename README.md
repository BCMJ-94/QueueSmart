# QueueSmart — COSC 4353 Project

QueueSmart is a queue-management web application with user registration/login, administrator service management, queue operations, notifications, and user queue history.

## Run locally

Requirements: Node.js 22.13+ (Node's built-in `node:sqlite` is used).

```bash
cd backend
npm ci
cp .env.example .env
# Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env
npm run dev
```

In another terminal:

```bash
cd frontend
npx serve -l 5500
```

Open `http://localhost:5500`. The API runs on `http://localhost:3001` by default. The SQLite database is created at `backend/data/queuesmart.db`; do not commit the database or `.env` file.

## Tests and coverage

```bash
cd backend
npm test
npm run test:coverage
```

The notification/history tests use temporary SQLite databases and verify user isolation, read/viewed status, and persistence after closing and reopening the database.

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/notifications` | List current user's notifications and unread count |
| PATCH | `/api/notifications/:id/read` | Mark one notification as viewed |
| PATCH | `/api/notifications/read-all` | Mark all current user's notifications as viewed |
| GET | `/api/history` | List current user's queue history |

All four endpoints require a valid bearer token. Never accept a `user_id` from the browser to determine ownership; the API uses the authenticated user's ID.
