import { create } from "zustand";

/** Admin token lives in memory only. It is never persisted to storage, so a page reload clears it. */
interface AdminState { adminToken: string; setAdminToken: (t: string) => void }
export const useAdmin = create<AdminState>((set) => ({ adminToken: "", setAdminToken: (adminToken) => set({ adminToken }) }));
