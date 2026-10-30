import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { PaperEngine } from "../paper/engine.js";
import { logger } from "../utils/logger.js";

const MAX_BUFFER = 1_000_000; // bytes queued per socket before we skip pushes to it

/** /ws: origin-checked, heartbeat, and backpressure-aware. Pushes paper-trading status every 5 s. */
export function attachWebSocket(http: HttpServer, opts: { allowedOrigins: string[]; production: boolean; paper: PaperEngine }) {
  const wss = new WebSocketServer({
    server: http,
    path: "/ws",
    maxPayload: 16 * 1024,
    verifyClient: ({ origin }: { origin?: string }, done: (ok: boolean, code?: number, msg?: string) => void) => {
      if (origin && opts.allowedOrigins.includes(origin)) return done(true);
      if (!origin && !opts.production) return done(true);
      done(false, 403, "Origin not allowed");
    },
  });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("error", (err) => logger.warn({ err: err.message }, "ws error"));
    ws.send(JSON.stringify({ type: "hello", mode: "PAPER", dataSource: "SAMPLE", at: new Date().toISOString() }));
  });

  const pushTimer = setInterval(() => {
    const msg = JSON.stringify({ type: "paper", at: new Date().toISOString(), cash: Math.round(opts.paper.cash * 100) / 100, positions: opts.paper.positions.size, realizedPnl: Math.round(opts.paper.realizedPnl * 100) / 100, emergencyStop: opts.paper.emergencyStop });
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFER) ws.send(msg);
  }, 5000);

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);

  return {
    clients: () => wss.clients.size,
    close: () => new Promise<void>((resolve) => {
      clearInterval(pushTimer); clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => resolve());
    }),
  };
}
