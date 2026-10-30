import { useEffect, useRef, useState } from "react";
import { wsUrl } from "./api";

export interface PushState { connected: boolean; lastAt: string | null; cash: number | null; positions: number | null; realizedPnl: number | null }

/** Subscribes to backend /ws. This shows whether the push channel is up. It is not a market-data feed. */
export function usePushStatus(): PushState {
  const [state, setState] = useState<PushState>({ connected: false, lastAt: null, cash: null, positions: null, realizedPnl: null });
  const retry = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;
    const open = () => {
      try { ws = new WebSocket(wsUrl()); } catch { return; }
      ws.onopen = () => { retry.current = 0; setState((s) => ({ ...s, connected: true })); };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          if (m.type === "paper") setState({ connected: true, lastAt: m.at, cash: m.cash, positions: m.positions, realizedPnl: m.realizedPnl });
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** retry.current++);
        timer = window.setTimeout(open, delay);
      };
    };
    open();
    return () => { closed = true; window.clearTimeout(timer); ws?.close(); };
  }, []);
  return state;
}
