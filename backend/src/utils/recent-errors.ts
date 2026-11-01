export interface RecentError { at: string; status: number; code: string; path: string; message: string }

const MAX = 50;
const items: RecentError[] = [];

/** Keeps the last errors for the Settings page. Messages are the server's own safe texts, never stack traces. */
export function recordError(e: RecentError): void {
  items.unshift(e);
  if (items.length > MAX) items.length = MAX;
}

export const recentErrors = (): RecentError[] => [...items];
