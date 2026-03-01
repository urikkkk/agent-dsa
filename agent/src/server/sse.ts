import type { ServerResponse } from 'node:http';

export interface SSEWriter {
  sendEvent(type: string, data: unknown): void;
  sendHeartbeat(): void;
  close(): void;
  isClosed(): boolean;
}

export function createSSEWriter(res: ServerResponse): SSEWriter {
  let closed = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.on('close', () => {
    closed = true;
  });

  return {
    sendEvent(type: string, data: unknown) {
      if (closed) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    },

    sendHeartbeat() {
      if (closed) return;
      res.write(': heartbeat\n\n');
    },

    close() {
      if (closed) return;
      closed = true;
      res.end();
    },

    isClosed() {
      return closed;
    },
  };
}
