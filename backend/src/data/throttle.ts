/** Spaces out calls so no more than 1 / minIntervalMs run per second. Calls queue in order. */
export class RateLimiter {
  private chain: Promise<void> = Promise.resolve();
  private last = 0;
  constructor(private minIntervalMs: number) {}
  wait(): Promise<void> {
    const next = this.chain.then(async () => {
      const gap = this.last + this.minIntervalMs - Date.now();
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      this.last = Date.now();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
