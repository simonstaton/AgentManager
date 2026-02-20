import type { Response } from "express";
import type { StreamEvent } from "../types";

export interface SSEOptions {
  /**
   * When true, `done` and `destroyed` events close the SSE connection.
   * When false, all events are sent but the connection stays open.
   * Defaults to true.
   */
  closeOnDone?: boolean;
}

export function setupSSE(
  res: Response,
  _agentId: string,
  subscribe: (listener: (event: StreamEvent) => void) => () => void,
  options: SSEOptions = {},
) {
  const { closeOnDone = true } = options;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx/Cloud Run
  res.flushHeaders();

  let eventId = 0;
  let closed = false;

  // Deferred cleanup avoids calling unsubscribe() while inside the listener
  // callback (which is invoked during Set iteration in AgentManager.handleEvent).
  const scheduleCleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(maxLifetime);
    setImmediate(() => unsubscribe());
  };

  const safeSend = (event: StreamEvent) => {
    if (closed) return;
    try {
      eventId++;
      res.write(`id: ${eventId}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected - clean up silently
      scheduleCleanup();
    }
  };

  // Keep-alive heartbeat every 15s to prevent connection timeout.
  // Also proactively detects dead connections that didn't fire a
  // 'close' event (common behind Cloud Run / HTTP/2 proxies).
  const heartbeat = setInterval(() => {
    if (closed) {
      clearInterval(heartbeat);
      return;
    }
    // Detect connections destroyed by the proxy/client without a 'close' event
    if (res.destroyed || res.writableEnded) {
      scheduleCleanup();
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch {
      scheduleCleanup();
    }
  }, 15_000);

  // Maximum listener lifetime (30 min) - force cleanup even if proxy
  // disconnect was never detected (half-open socket leak, issue #21)
  const maxLifetime = setTimeout(
    () => {
      scheduleCleanup();
      try {
        res.end();
      } catch {}
    },
    30 * 60 * 1000,
  );
  maxLifetime.unref();

  const unsubscribe = subscribe((event) => {
    safeSend(event);
    if (closeOnDone && (event.type === "done" || event.type === "destroyed")) {
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(maxLifetime);
      // Defer unsubscribe - we're inside the listener callback during Set iteration
      setImmediate(() => unsubscribe());
      try {
        res.end();
      } catch {}
    }
  });

  res.on("close", () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(maxLifetime);
    unsubscribe();
  });
}
