# Feedback Issue Board Design

## Goal

Build a low-cost, decoupled feedback issue board on the existing Cloudflare Worker so anyone can view submitted issues and their handling status, while only administrators can view sensitive evidence and update processing state.

## Decisions

- Host the issue board as an independent Worker page at `/feedback`.
- Keep the main Gantt SPA unchanged except for optional future links to the issue board.
- Let public users view only sanitized issue summaries and public handling notes.
- Require administrator authentication before exposing screenshots, videos, rrweb data, console logs, contact information, and full runtime context.
- Avoid repeated password prompts by issuing a short-lived admin session token that the browser stores locally.
- Store workflow state in the same `FEEDBACK_KV` item as the original feedback payload to avoid a database migration.

## Current Context

The existing feedback channel posts to `POST /api/feedback` in `workers/share-worker.js`. Feedback entries are stored in `FEEDBACK_KV` with keys shaped as `feedback:${Date.now()}:${randomId}`. Payloads include title, description, contact, attachments, context, logs, replay metadata, and server metadata.

The Worker currently has no list, detail, update, or admin authentication routes. Viewing collected feedback requires Cloudflare KV tools or the dashboard, which is not suitable for day-to-day triage.

## User Roles

Public users can:

- Open `/feedback`.
- Browse the issue list.
- Filter by status.
- Open a sanitized issue detail page.
- See issue status, priority, public handling note, and update time.

Administrators can:

- Enter an admin password once per session period.
- View complete issue details.
- View contact information.
- Inspect attachment metadata and open/download attachment data.
- View console logs, runtime context, and rrweb replay JSON.
- Change status, priority, assignee, public note, and internal note.
- Append workflow history for every processing action.

## Public Data Rules

Public responses must not include:

- `contact`
- `attachments[].dataUrl`
- full screenshots or videos
- rrweb JSON content
- console logs
- full browser user agent
- IP-derived metadata
- raw runtime context objects
- internal notes

Public responses may include:

- key
- type
- title
- description preview
- receivedAt
- workflow status
- workflow priority
- assignee if explicitly set
- publicNote
- updatedAt
- sanitized URL origin/path when available
- project name when available
- attachment count
- replay event count

## Workflow Model

Each feedback item is normalized at read time. Existing records without workflow data receive defaults:

```js
workflow: {
    status: 'open',
    priority: 'medium',
    assignee: '',
    publicNote: '',
    internalNote: '',
    updatedAt: receivedAt,
    history: [],
}
```

Supported statuses:

- `open`: new or untriaged issue.
- `in_progress`: accepted and being handled.
- `resolved`: fix or answer completed.
- `closed`: no further action planned.

Supported priorities:

- `low`
- `medium`
- `high`
- `urgent`

Admin updates append a history item:

```js
{
    at: '2026-05-31T00:00:00.000Z',
    actor: 'admin',
    changes: {
        status: ['open', 'in_progress'],
        priority: ['medium', 'high'],
    },
    publicNote: 'Reproduced and scheduled for the next fix.',
    internalNote: 'Console shows task refresh race condition.',
}
```

## API Design

### `GET /feedback`

Returns the independent HTML page for the issue board. The page is self-contained and uses the Worker APIs below.

### `GET /api/feedback/issues?status=&limit=&cursor=`

Returns a paginated issue list from `FEEDBACK_KV`.

- Public callers receive sanitized summaries.
- Admin callers with `Authorization: Bearer <token>` receive additional sensitive summary fields when useful.
- `limit` is capped to 100.
- `status` filters normalized workflow status.
- `cursor` uses Cloudflare KV list pagination.

### `GET /api/feedback/issues/:key`

Returns one issue by key.

- Public callers receive sanitized detail.
- Admin callers receive full detail.
- Missing keys return `404`.

### `POST /api/feedback/admin/session`

Accepts:

```json
{
  "password": "admin password"
}
```

If the password matches `FEEDBACK_ADMIN_PASSWORD`, returns:

```json
{
  "token": "signed-token",
  "expiresAt": "2026-06-07T00:00:00.000Z"
}
```

Tokens are HMAC-signed by the Worker using `FEEDBACK_ADMIN_TOKEN_SECRET` when set, otherwise `FEEDBACK_ADMIN_PASSWORD`. Tokens expire after 7 days.

### `PATCH /api/feedback/issues/:key`

Requires admin token. Accepts partial workflow updates:

```json
{
  "status": "in_progress",
  "priority": "high",
  "assignee": "chenlonglong",
  "publicNote": "Reproduced and under investigation.",
  "internalNote": "Check rrweb event sequence around task save."
}
```

The Worker validates status and priority values, normalizes text lengths, updates `workflow.updatedAt`, appends history, and stores the full issue payload back to `FEEDBACK_KV` with the existing 180-day feedback TTL.

## Authentication Behavior

The `/feedback` page starts in public mode. It shows an "Admin" control in a compact header. When the administrator enters the password successfully, the page stores the returned token and expiry in `localStorage`.

On later visits, the page reads the token from `localStorage` and uses it until expiry or API rejection. If a token is expired or rejected, the page clears it and returns to public mode. This avoids repeated password entry without requiring accounts, cookies, or a separate identity provider.

## Page UX

The page should feel like a compact operations list, not a marketing page.

Layout:

- Header: title, total visible count, admin login/status button.
- Filter row: status tabs and refresh button.
- Main area: issue list on the left, detail panel on the right for desktop; stacked layout on small screens.
- Empty state: short message and refresh action.
- Error state: short message and retry action.

Issue list item:

- title
- type
- status badge
- priority badge
- received time
- last updated time
- description preview

Public detail:

- title, type, status, priority
- public description
- project name
- page path
- attachment count
- replay event count
- public handling note
- public workflow history entries

Admin detail additions:

- contact
- full URL
- browser and viewport details
- console logs
- context JSON
- attachment list with preview/download actions where feasible
- rrweb attachment JSON download
- update form for status, priority, assignee, public note, internal note

## Security And Privacy

- Public list and detail routes must use explicit allowlists instead of deleting a few fields from the full payload.
- Admin tokens must expire.
- Password comparison must avoid returning different error messages for missing versus wrong passwords.
- `PATCH` must only allow known workflow fields.
- Text fields must be length-limited to avoid oversized updates.
- Attachments remain stored in KV as currently designed; public APIs never return base64 attachment bodies.
- CORS remains permissive for existing app submission compatibility, but admin write routes still require bearer auth.

## Testing

Worker behavior:

- Public list returns sanitized issue summaries.
- Public detail does not include sensitive fields.
- Admin session rejects wrong password.
- Admin session accepts correct password and returns an expiring token.
- Admin detail with valid token includes full issue data.
- `PATCH` without token returns `401`.
- `PATCH` with invalid status returns `400`.
- `PATCH` with valid token updates workflow and appends history.

Manual verification:

- Submit a feedback item from the app.
- Open `/feedback` and confirm it appears in public list.
- Confirm public detail hides screenshots, rrweb data, logs, contact, and raw context.
- Log in as admin once.
- Refresh page and confirm admin mode persists.
- Update status and priority.
- Log out and confirm public view shows updated status and public note only.

## Deployment

Deploy only the Worker for the issue board API and page:

```powershell
$env:CLOUDFLARE_API_TOKEN=[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','User')
npx wrangler@3.114.17 deploy --config wrangler.toml
```

Required Worker secrets:

- `FEEDBACK_ADMIN_PASSWORD`
- `FEEDBACK_ADMIN_TOKEN_SECRET` recommended, can be generated as a long random string

The Cloudflare Pages frontend does not need redeployment unless a future task adds a link from the main app to `/feedback`.

## Out Of Scope

- Multi-admin accounts.
- Email or push notifications.
- Full-text search.
- Permanent database migration away from KV.
- Public comments from non-admin users.
- GitHub Issues or third-party tracker sync.
