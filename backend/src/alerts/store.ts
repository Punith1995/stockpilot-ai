/** In-memory alert rules and notifications. Bounded. No email, SMS or push delivery exists. */
export type AlertType = "PRICE_ABOVE" | "PRICE_BELOW" | "SIGNAL_BUY";
export interface AlertRule { id: string; symbol: string; type: AlertType; value?: number; createdAt: string }
export interface Notification { at: string; ruleId: string; symbol: string; message: string; delivery?: "NOT_CONFIGURED" | "DELIVERED" | "FAILED"; deliveryError?: string }

export class AlertStore {
  rules: AlertRule[] = [];
  notifications: Notification[] = [];
  private seq = 1;

  add(rule: Omit<AlertRule, "id" | "createdAt">): AlertRule {
    const r = { ...rule, id: `A${this.seq++}`, createdAt: new Date().toISOString() };
    this.rules.push(r);
    if (this.rules.length > 50) this.rules.splice(0, this.rules.length - 50);
    return r;
  }

  remove(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    return this.rules.length < before;
  }

  notify(n: Omit<Notification, "at">): Notification {
    const item: Notification = { ...n, at: new Date().toISOString() };
    this.notifications.push(item);
    if (this.notifications.length > 200) this.notifications.splice(0, this.notifications.length - 200);
    return item;
  }
}
