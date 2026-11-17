# Architecture and engineering decisions

## System boundaries

The Next.js application is the presentation layer. The Express service owns identity, workspace membership, project/task/document CRUD, validation and Socket.IO events. A separate Yjs WebSocket process owns CRDT room synchronization and LevelDB update persistence. PostgreSQL is the source of truth for relational application records; Yjs LevelDB stores collaborative document updates.

## Data isolation

Workspace data is queried through the authenticated user's membership. Read routes require membership; content writes require OWNER, ADMIN, or EDITOR, while VIEWER remains read-only. Ownership is checked against the workspace's owner ID for role changes and removal. Continue to add authorization tests whenever new routes or event handlers are introduced.

## Collaboration

Each saved document ID maps to a Yjs room. Clients join through `WebsocketProvider`; TipTap Collaboration binds editor state to the Y.Doc and CollaborationCursor publishes awareness state. The server validates JWT and document membership before joining. LevelDB persistence reloads the Y.Doc when a room is opened and stores updates as they arrive through y-websocket persistence hooks.

## Scaling path

1. Put API and Yjs services behind a TLS reverse proxy.
2. Use managed PostgreSQL with connection pooling and automated backups.
3. Add Redis adapter for Socket.IO and Redis-backed presence TTLs.
4. Replace local LevelDB with a shared persistence strategy and implement snapshot/compaction workers.
5. Add queues for notifications, AI indexing and export generation.
6. Add tracing, structured logs, metrics and alerting.
