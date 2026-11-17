const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'EDITOR']);
const MEMBER_MANAGERS = new Set(['OWNER', 'ADMIN']);

export const hasWorkspaceWriteRole = (role: string): boolean => WRITE_ROLES.has(role);

export const canRemoveWorkspaceMember = (
  actorRole: string,
  targetRole: string,
  targetIsWorkspaceOwner = false,
): boolean => MEMBER_MANAGERS.has(actorRole) && targetRole !== 'OWNER' && !targetIsWorkspaceOwner;

export interface ActiveWorkspaceConnection {
  userId: string;
  workspaceId: string;
  close: (code: number, reason: string) => void;
}

export const revokeWorkspaceConnections = <T extends ActiveWorkspaceConnection>(
  connections: Set<T>,
  workspaceId: string,
  userId: string,
): number => {
  let revoked = 0;
  for (const connection of connections) {
    if (connection.workspaceId !== workspaceId || connection.userId !== userId) continue;
    connections.delete(connection);
    connection.close(1008, 'Workspace access changed');
    revoked += 1;
  }
  return revoked;
};
