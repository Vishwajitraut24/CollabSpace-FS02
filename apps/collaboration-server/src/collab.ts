import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
import { WebSocket, WebSocketServer } from 'ws';
import { setupWSConnection, setPersistence } from 'y-websocket/bin/utils';
import { LeveldbPersistence } from 'y-leveldb';
import * as Y from 'yjs';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { hasWorkspaceWriteRole, revokeWorkspaceConnections } from './workspace-access.js';
const prisma = new PrismaClient();
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters in every environment.');
const REDIS_URL = process.env.REDIS_URL;
if (process.env.NODE_ENV === 'production' && !REDIS_URL) throw new Error('REDIS_URL must be configured in production for collaboration access revocation.');
const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
redis?.on('error', error => console.error('Collaboration Redis error', error));
const ACCESS_REVOCATION_CHANNEL = 'collabspace:workspace-access-revoked';
const activeConnections = new Set<{ workspaceId: string; userId: string; close: (code: number, reason: string) => void }>();
if (redis) {
  redis.on('message', (channel, payload) => {
    if (channel !== ACCESS_REVOCATION_CHANNEL) return;
    try {
      const event: unknown = JSON.parse(payload);
      if (!event || typeof event !== 'object' || !('workspaceId' in event) || !('userId' in event)
        || typeof event.workspaceId !== 'string' || typeof event.userId !== 'string') {
        throw new Error('Invalid collaboration access-revocation event');
      }
      revokeWorkspaceConnections(activeConnections, event.workspaceId, event.userId);
    } catch (error) {
      console.error('Unable to process collaboration access-revocation event', error);
    }
  });
  void redis.subscribe(ACCESS_REVOCATION_CHANNEL).catch(error => {
    console.error('Unable to subscribe to collaboration access-revocation events', error);
  });
}

// Yjs document updates are persisted on disk and rehydrated when a room is opened.
const persistence = new LeveldbPersistence('./.collab-data');
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const persisted = await persistence.getYDoc(docName);
    const localUpdate = Y.encodeStateAsUpdate(persisted);
    if (localUpdate.byteLength > 2) Y.applyUpdate(ydoc, localUpdate);
    persisted.destroy();
    // PostgreSQL snapshots make collaboration recoverable on a different host as well.
    const latest = await prisma.collaborationSnapshot.findFirst({ where: { documentId: docName }, orderBy: { createdAt: 'desc' } });
    if (latest?.snapshot) Y.applyUpdate(ydoc, Buffer.from(latest.snapshot, 'base64'));
  },
  writeState: async (docName: string, ydoc: Y.Doc) => {
    const update = Y.encodeStateAsUpdate(ydoc);
    await persistence.storeUpdate(docName, update);
    await prisma.collaborationSnapshot.create({ data: { documentId: docName, snapshot: Buffer.from(update).toString('base64') } });
  },
});
const port = Number(process.env.COLLAB_PORT || 4001);
const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ service: 'collabspace-yjs', status: 'ok' })); });
const wss = new WebSocketServer({ server });
wss.on('connection', (conn, req) => {
  void (async () => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (!token) throw new Error('Missing token');
      const identity = jwt.verify(token, SECRET);
      if (typeof identity === 'string' || typeof identity.id !== 'string') throw new Error('Invalid token identity');
      const room = decodeURIComponent(url.pathname.replace(/^\//, '').split('/')[0] || '');
      const doc = await prisma.document.findFirst({ where: { id: room, workspace: { members: { some: { userId: identity.id, role: { in: ['OWNER', 'ADMIN', 'EDITOR'] } } } } }, select: { id: true, workspaceId: true } });
      if (!doc) throw new Error('Document access denied');
      const activeConnection = {
        workspaceId: doc.workspaceId,
        userId: identity.id,
        close: (code: number, reason: string) => conn.close(code, reason),
      };
      activeConnections.add(activeConnection);
      conn.once('close', () => activeConnections.delete(activeConnection));
      const currentMembership = await prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: identity.id, workspaceId: doc.workspaceId } },
        select: { role: true },
      });
      if (!currentMembership || !hasWorkspaceWriteRole(currentMembership.role) || conn.readyState !== WebSocket.OPEN) {
        activeConnections.delete(activeConnection);
        conn.close(1008, 'Unauthorized or document access denied');
        return;
      }
      setupWSConnection(conn, req, { docName: room, gc: true });
    } catch {
      conn.close(1008, 'Unauthorized or document access denied');
    }
  })();
});
server.listen(port, () => console.log(`CollabSpace Yjs server listening on :${port}`));
