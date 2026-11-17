import test from 'node:test';
import assert from 'node:assert/strict';
import { canRemoveWorkspaceMember, hasWorkspaceWriteRole, revokeWorkspaceConnections } from '../dist/workspace-access.js';

test('only workspace editors and above can write', () => {
  assert.equal(hasWorkspaceWriteRole('OWNER'), true);
  assert.equal(hasWorkspaceWriteRole('ADMIN'), true);
  assert.equal(hasWorkspaceWriteRole('EDITOR'), true);
  assert.equal(hasWorkspaceWriteRole('VIEWER'), false);
  assert.equal(hasWorkspaceWriteRole('UNKNOWN'), false);
});

test('admins cannot remove the workspace owner', () => {
  assert.equal(canRemoveWorkspaceMember('ADMIN', 'OWNER'), false);
  assert.equal(canRemoveWorkspaceMember('OWNER', 'OWNER'), false);
  assert.equal(canRemoveWorkspaceMember('ADMIN', 'EDITOR', true), false);
  assert.equal(canRemoveWorkspaceMember('ADMIN', 'EDITOR'), true);
  assert.equal(canRemoveWorkspaceMember('EDITOR', 'VIEWER'), false);
});

test('workspace access changes revoke only matching collaboration connections', () => {
  const closed = [];
  const connection = (workspaceId, userId) => ({
    workspaceId,
    userId,
    close: (code, reason) => closed.push({ workspaceId, userId, code, reason }),
  });
  const removed = connection('workspace-1', 'user-1');
  const changedRole = connection('workspace-1', 'user-1');
  const otherUser = connection('workspace-1', 'user-2');
  const otherWorkspace = connection('workspace-2', 'user-1');
  const connections = new Set([removed, changedRole, otherUser, otherWorkspace]);

  assert.equal(revokeWorkspaceConnections(connections, 'workspace-1', 'user-1'), 2);
  assert.deepEqual([...connections], [otherUser, otherWorkspace]);
  assert.equal(closed.length, 2);
  assert.ok(closed.every(({ code, reason }) => code === 1008 && reason === 'Workspace access changed'));
});
