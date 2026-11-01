import { useEffect, useState } from "react";
import { btn } from "./Card";

/** Client-side pagination for a table. Call at the top of a component; render <Pager {...pg} /> under the table. */
export function usePager<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  return { slice: rows.slice((current - 1) * size, current * size), page: current, pages, setPage, total: rows.length, size };
}

export function Pager({ page, pages, setPage, total, size }: { page: number; pages: number; setPage: (p: number) => void; total: number; size: number }) {
  if (total === 0) return null;
  const start = (page - 1) * size + 1;
  const end = Math.min(total, page * size);
  return (
    <nav aria-label="Table pages" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
      <span>Showing {start}–{end} of {total}</span>
      <div className="flex items-center gap-2">
        <button className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className={btn} onClick={() => setPage(page + 1)} disabled={page >= pages}>Next</button>
      </div>
    </nav>
  );
}
