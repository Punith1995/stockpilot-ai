/** A single background scan over many symbols. Only one runs at a time; progress and results are kept in memory. */
export interface ScanRow { symbol: string; signal: string; close: number | null; rsi14: number | null; adx14: number | null; relVolume: number | null }
export interface ScanJobState {
  id: string; status: "running" | "done" | "cancelled" | "failed";
  total: number; done: number; failed: number;
  startedAt: string; finishedAt: string | null; interval: string;
  results: ScanRow[]; error: string | null;
}

export class ScanJobs {
  private current: ScanJobState | null = null;
  private cancelRequested = false;
  private seq = 0;

  get state(): ScanJobState | null { return this.current; }
  get running(): boolean { return this.current?.status === "running"; }

  cancel(): boolean {
    if (!this.running) return false;
    this.cancelRequested = true;
    return true;
  }

  /** Starts a scan. Returns null if one is already running. `evaluate` throws for symbols it cannot score. */
  start(symbols: string[], interval: string, evaluate: (symbol: string) => Promise<ScanRow | null>): ScanJobState | null {
    if (this.running) return null;
    this.cancelRequested = false;
    const job: ScanJobState = { id: `S${++this.seq}`, status: "running", total: symbols.length, done: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: null, interval, results: [], error: null };
    this.current = job;
    void (async () => {
      try {
        for (const sym of symbols) {
          if (this.cancelRequested) { job.status = "cancelled"; break; }
          try {
            const row = await evaluate(sym);
            if (row) job.results.push(row);
          } catch (e) {
            // A fatal error (for example an expired Kite session) stops the whole scan.
            if ((e as { fatal?: boolean }).fatal) throw e;
            job.failed++;
          }
          job.done++;
        }
        if (job.status === "running") job.status = "done";
      } catch (e) {
        job.status = "failed";
        job.error = (e as Error).message;
      } finally {
        job.finishedAt = new Date().toISOString();
        job.results.sort((a, b) => Number(b.signal === "BUY") - Number(a.signal === "BUY"));
      }
    })();
    return job;
  }
}
