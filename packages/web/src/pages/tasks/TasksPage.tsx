import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/api/client";
import { Paginated, Task, User } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

export function TasksPage() {
  const { hasPermission, user } = useAuth();
  const canAssign = hasPermission("task.assign");
  const canExecute = hasPermission("task.execute");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/tasks", page, type, status, mineOnly],
    queryFn: () => api.get<Paginated<Task>>(`/tasks${qs({ page, pageSize: 20, type, status, assignedToId: mineOnly ? user?.id : undefined })}`),
  });
  const { data: operators } = useQuery({ queryKey: ["/users", "all"], queryFn: () => api.get<Paginated<User>>("/users?pageSize=100"), enabled: canAssign });

  const assignMutation = useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) => api.post(`/tasks/${taskId}/assign`, { userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/tasks"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao atribuir."),
  });
  const startMutation = useMutation({
    mutationFn: (taskId: string) => api.post(`/tasks/${taskId}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/tasks"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao iniciar."),
  });
  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => api.post(`/tasks/${taskId}/cancel`, { reason: "Cancelada manualmente pelo supervisor." }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/tasks"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao cancelar."),
  });

  const types = ["RECEIVING", "CONFERENCE", "PUTAWAY", "PICKING", "REPLENISHMENT", "TRANSFER", "COUNT", "SHIPPING"];
  const statuses = ["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tarefas</h1>
          <p className="page-subtitle">Task Engine — recebimento, put-away, picking, reabastecimento, contagem, expedição</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="toolbar">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Todos os tipos</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todos os status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {canExecute && (
          <label className="row" style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => { setMineOnly(e.target.checked); setPage(1); }} /> Minhas tarefas
          </label>
        )}
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<Task>
            columns={[
              { key: "type", header: "Tipo", render: (r) => <Badge value={r.type} /> },
              { key: "priority", header: "Prioridade", render: (r) => <Badge value={r.priority} /> },
              { key: "product", header: "Produto", render: (r) => r.product ? `${r.product.sku}` : "-" },
              { key: "qty", header: "Qtd", render: (r) => <span className="mono">{r.qty ?? "-"}</span> },
              { key: "origin", header: "Origem", render: (r) => r.originLocation?.fullCode ?? "-" },
              { key: "dest", header: "Destino", render: (r) => r.destLocation?.fullCode ?? "-" },
              { key: "assigned", header: "Operador", render: (r) => r.assignedTo?.name ?? "-" },
              { key: "sla", header: "SLA", render: (r) => (r.slaDueAt ? new Date(r.slaDueAt).toLocaleString("pt-BR") : "-") },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              { key: "actions", header: "", render: (r) => (
                <div className="row">
                  {canAssign && r.status === "PENDING" && (
                    <select defaultValue="" onChange={(e) => e.target.value && assignMutation.mutate({ taskId: r.id, userId: e.target.value })}>
                      <option value="" disabled>Atribuir...</option>
                      {operators?.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  )}
                  {canExecute && ["PENDING", "ASSIGNED"].includes(r.status) && <button className="btn sm" onClick={() => startMutation.mutate(r.id)}>Iniciar</button>}
                  {canAssign && ["PENDING", "ASSIGNED"].includes(r.status) && <button className="btn sm ghost" onClick={() => cancelMutation.mutate(r.id)}>Cancelar</button>}
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
