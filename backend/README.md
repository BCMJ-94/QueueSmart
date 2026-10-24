# QueueSmart backend

Assignment 3 Express API. Data is kept in server memory (no database until
Assignment 4), so accounts and sessions are cleared when the server restarts.
Passwords are stored as salted scrypt hashes and are never returned.

## Run locally

Terminal 1, start the API:

```
cd backend
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
# Edit .env and set your own ADMIN_EMAIL and ADMIN_PASSWORD
npm run dev
```

The API listens on `http://localhost:3001`. The `.env` file is ignored by Git.
`ADMIN_EMAIL` and `ADMIN_PASSWORD` create one Administrator account when the
server starts. Public registration always creates a `User` account, even if the
request includes a `role` field.

Terminal 2, serve the front end (any static server on localhost works):

```
cd frontend
npx serve -l 5500
```

Open `http://localhost:5500`. You can also open `frontend/index.html` with the
VS Code Live Server extension.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check that the API is running |
| `POST` | `/api/auth/register` | Create a User account and sign in |
| `POST` | `/api/auth/login` | Sign in; returns a session token and public user |
| `GET` | `/api/auth/me` | Get the signed-in user |
| `POST` | `/api/auth/logout` | Revoke the current session token |
| `GET` | `/api/notifications` | Current user's notifications and `unreadCount` |
| `PATCH` | `/api/notifications/:id/read` | Mark one of the current user's notifications read |
| `PATCH` | `/api/notifications/read-all` | Mark all current user's notifications read |
| `GET` | `/api/history` | Current user's queue activity history |

Send data as JSON. Authenticated endpoints require `Authorization: Bearer <token>`.
Registration expects a valid email (max 254 characters) and a password of 8–128
characters. Invalid input returns `400 { message, errors: { field: message } }`.

## Adding a module (Services, Queues, Notifications, History)

- Validate request bodies with `validateFields(input, rules)` from `src/validation.js`
  (required, type, minLength/maxLength, min/max, pattern, oneOf).
- Protect routes with `requireAuthentication(authService)` and, for admin-only
  routes, `requireAdministrator` from `src/authMiddleware.js`. The signed-in user
  is available as `request.user` (`{ id, email, role }`).
- Mount your routes in `src/app.js` where the comment shows.
- In `frontend/index.html`, call the API with the shared `api(path, { method, body })`
  helper; it sends the session token for you.

## Test

```
npm test                 # run all unit tests
npm run test:coverage    # tests + coverage report
```

Tests use Node's built-in test runner and make real HTTP requests to an
ephemeral local Express server; no database is needed.