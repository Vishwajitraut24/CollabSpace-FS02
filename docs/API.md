# CollabSpace API reference

Base URL: `http://localhost:4000/api`  
Authentication: send `Authorization: Bearer <JWT>` for protected routes.

## Health

- `GET /health` — API process health (outside `/api`).

## Authentication

- `POST /auth/register` — `{ "name", "email", "password" }`; creates a user and personal workspace.
- `POST /auth/login` — `{ "email", "password" }`; returns `{ token, user, workspace }`.
- `GET /me` — current authenticated profile.
- `PATCH /me/avatar` — `{ "avatarUrl": "data:image/webp;base64,..." }` saves the caller's profile image; send `null` to remove it. Only PNG, JPEG, or WebP data URLs up to 512 KB are accepted.

## Workspaces

- `GET /workspaces` — workspaces where the caller is a member.
- `POST /workspaces` — `{ "name" }` creates a workspace owned by the caller.
- `GET /workspaces/:id/overview` — workspace, members, projects, tasks, documents, channels and events. Membership is required.
- `POST /workspaces/:id/projects` — `{ "name", "description?" }`.
- `POST /workspaces/:id/tasks` — `{ "title", "description?", "status?", "priority?", "dueDate?", "projectId?" }`.
- `POST /workspaces/:id/documents` — `{ "title" }`.

## Tasks

- `PATCH /tasks/:id` — update title, description, status, priority, assignee or due date.
- `DELETE /tasks/:id` — delete a task.

## Documents

- `GET /documents/:id` — document, comments and recent versions.
- `PATCH /documents/:id` — update title and/or TipTap JSON content.
- `POST /documents/:id/versions` — create a snapshot of the current document content.
- `POST /documents/:id/comments` — `{ "body" }` adds a comment.

## Search and AI

- `GET /search?q=term` — searches document titles, task titles and project names in the caller's workspaces.
- `POST /ai/chat` — `{ "message", "workspaceId?", "documentId?" }`; requires `OPENAI_API_KEY`. If a workspace ID is supplied, its membership is verified and recent document content is passed as bounded context to the configured model.

## Realtime events

Socket.IO connects to `http://localhost:4000` with `auth: { token }`.

- Client emits `workspace:join` with a workspace ID; server verifies membership.
- Client emits `document:join` with a document ID; server verifies membership.
- Client emits `chat:send` with `{ channelId, body }`; server persists the message and broadcasts `chat:message` to workspace members currently connected to the gateway.
- Server emits `task:created` and `task:updated` to the workspace room.
- Server emits `presence:joined` and `presence:left` presence hints.

The Yjs WebSocket service runs at `ws://localhost:4001`. It validates the JWT and verifies access to the document before allowing a room connection. See `ARCHITECTURE.md` and `SECURITY.md` for current limitations and production hardening requirements.


## Team chat

### `GET /api/workspaces/:id/channels`

Requires a Bearer token and workspace membership. Returns workspace channels ordered by name, each with up to the latest 100 messages in chronological order. Message author fields are limited to `id`, `name`, and `avatarUrl`.

### Socket.IO events

- Authenticate the Socket.IO connection with `auth: { token }`.
- Emit `workspace:join` with a workspace ID to join its authorized workspace room.
- Emit `channel:join` with a channel ID to join its authorized channel room.
- Emit `chat:send` with `{ channelId, body }`; an acknowledgement returns `{ ok: true }` or `{ ok: false, error }`.
- Listen for `chat:message` to receive persisted messages.

The server checks workspace membership before channel joins and message creation. Messages are stored in PostgreSQL before they are broadcast. Attachments, private-channel membership, threads, reactions and DMs are not included in this iteration.

## Workspace administration

- `POST /workspaces/:id/invitations` — owner/admin only; `{ "email", "role?" }`. Returns a single-use token valid for seven days. Copy/share it securely; automatic email delivery is not configured.
- `POST /invitations/accept` — authenticated user whose email matches the invitation; `{ "token" }`.
- `PATCH /workspaces/:id/members/:userId` — owner only; `{ "role": "ADMIN" | "EDITOR" | "VIEWER" }`.
- `DELETE /workspaces/:id/members/:userId` — owner/admin only; removes a different member.
- `POST /workspaces/:id/channels` — owner/admin only; `{ "name" }` (letters, numbers and hyphens).

## Calendar

- `POST /workspaces/:id/events` — `{ "title", "startsAt", "endsAt?" }` with ISO-8601 timestamps.
- `PATCH /events/:id` — update title or start/end times.
- `DELETE /events/:id` — delete an event.

## Whiteboards

- `GET /workspaces/:id/whiteboards` — list workspace whiteboards.
- `POST /workspaces/:id/whiteboards` — `{ "title?" }` creates a persisted whiteboard.
- `GET /whiteboards/:id` — retrieve the board state.
- `PUT /whiteboards/:id` — `{ "title?", "state" }` saves JSON state (2 MB maximum).
- `DELETE /whiteboards/:id` — delete a board.
- Socket.IO `whiteboard:join` verifies membership before joining a board room; `whiteboard:cursor` relays transient cursor coordinates to other room members. The UI still needs to connect its canvas object operations to these APIs/events.

## Comments, documents and notifications

- `DELETE /documents/:id` — delete a document and its dependent comments/versions.
- `PATCH /comments/:id` — author can edit `body`; any workspace member can set `resolved`.
- `DELETE /comments/:id` — author only.
- `GET /notifications` — latest 50 notifications for the current user.
- `PATCH /notifications/:id/read` — mark one notification read.
- `POST /notifications/read-all` — mark all current user's notifications read.

## Collaboration persistence

The Yjs service stores updates in local LevelDB and writes PostgreSQL snapshots through the `CollaborationSnapshot` model when the persistence hook flushes a room. For a production multi-instance deployment, replace local LevelDB with shared durable storage and add a tested distributed room/broadcast adapter; this local development setup is not a horizontally-scaled collaboration cluster.
