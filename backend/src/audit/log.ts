/** Bounded in-memory audit trail of admin actions. Never records tokens or request bodies. */
export interface AuditEntry { at: string; action: string; target?: string; outcome: "OK" | "FAILED" }

export class AuditLog {
  private entries: AuditEntry[] = [];
  constructor(private max = 500) {}

  record(action: string, outcome: AuditEntry["outcome"] = "OK", target?: string): void {
    this.entries.push({ at: new Date().toISOString(), action, outcome, ...(target ? { target } : {}) });
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }
}
