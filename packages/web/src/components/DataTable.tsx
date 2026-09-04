import { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  key: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyLabel = "Nenhum registro encontrado.",
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">{emptyLabel}</div>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={onRowClick ? "clickable" : ""} onClick={() => onRowClick?.(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Anterior</button>
      <span>Página {page} de {totalPages} · {total} registro(s)</span>
      <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Próxima ›</button>
    </div>
  );
}
