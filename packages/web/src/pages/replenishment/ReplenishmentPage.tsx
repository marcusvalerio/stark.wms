import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/api/client";
import { Paginated, ReplenishmentTask } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

export function ReplenishmentPage() {
  const { hasPermission } = useAuth();
  const canAssign = hasPermission("task.assign");
  const canExecute = hasPermission("task.execute");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/replenishment", page, status],
    queryFn: () => api.get<Paginated<ReplenishmentTask>>(`/replenishment${qs({ page, pageSize: 20, status })}`),
  });

  const scanMutation = useMutation({
    mutationFn: () => api.post<{ created: number }>("/replenishment/scan"),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["/replenishment"] }); setError(res.created === 0 ? "Nenhuma necessidade de reabastecimento identificada no momento." : null); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao escanear necessidades."),
  });
  const executeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/replenishment/${id}/execute`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/replenishment"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao executar."),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/replenishment/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/replenishment"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao cancelar."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reabastecimento</h1>
          <p className="page-subtitle">Posições de picking abaixo do mínimo → reabastecer a partir da reserva</p>
        </div>
        {canAssign && <button className="btn primary" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>Escanear necessidades</button>}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todos os status</option>
          {["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<ReplenishmentTask>
            columns={[
              { key: "sku", header: "SKU", render: (r) => <span className="mono">{r.product?.sku}</span> },
              { key: "product", header: "Produto", render: (r) => r.product?.description },
              { key: "from", header: "Origem (Reserva)", render: (r) => <span className="mono">{r.fromLocation?.fullCode}</span> },
              { key: "to", header: "Destino (Picking)", render: (r) => <span className="mono">{r.toLocation?.fullCode}</span> },
              { key: "qty", header: "Qtd", render: (r) => <span className="mono">{r.qty}</span> },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              { key: "actions", header: "", render: (r) => (
                <div className="row">
                  {canExecute && r.status === "PENDING" && <button className="btn sm primary" onClick={() => executeMutation.mutate(r.id)}>Executar</button>}
                  {canAssign && r.status === "PENDING" && <button className="btn sm ghost" onClick={() => cancelMutation.mutate(r.id)}>Cancelar</button>}
                </div>
              ) },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
