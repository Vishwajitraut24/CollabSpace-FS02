declare module 'y-websocket/bin/utils' {
  import type { WebSocket } from 'ws';
  import type { IncomingMessage } from 'node:http';
  import type * as Y from 'yjs';

  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    options?: {
      docName?: string;
      gc?: boolean;
    }
  ): void;

  export function setPersistence(persistence: {
    bindState: (docName: string, ydoc: Y.Doc) => Promise<void> | void;
    writeState: (docName: string, ydoc: Y.Doc) => Promise<void> | void;
  }): void;
}

declare module 'y-leveldb' {
  import type * as Y from 'yjs';

  export class LeveldbPersistence {
    constructor(location: string);

    getYDoc(docName: string): Promise<Y.Doc>;

    storeUpdate(
      docName: string,
      update: Uint8Array
    ): Promise<void>;
  }
}