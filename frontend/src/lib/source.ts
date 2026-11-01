import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AppStatus } from "../types";

/** Whether market data is live from Kite or generated SAMPLE data. Shares the header's status query. */
export function useDataSource(): { live: boolean; word: "KITE" | "SAMPLE" } {
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<AppStatus>("/status"), refetchInterval: 30_000 });
  const live = status.data?.dataSource === "KITE";
  return { live, word: live ? "KITE" : "SAMPLE" };
}
