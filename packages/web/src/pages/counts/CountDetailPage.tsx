import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { InventoryCount, InventoryCountItem } from "@/api/types";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

function CountItemRow({ count, item, mode }: { count: InventoryCount; item: InventoryCountItem; mode: "count" | "recount" }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(item.systemQty);
  const [error, setError] = useState<string | null>(null);
  const { hasPermission } = useAuth();
  const canManage = hasPermission("count.manage");

  const mutation = useMutation({
    mutationFn: () => api.post(`/counts/${count.id}/items/${item.id}/${mode}`, { countedQty: qty }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/counts", count.id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao registrar contagem."),
  });

  const alreadyDone = mode === "count" ? item.countedQty1 !== null && item.countedQty1 !== undefined : item.countedQty2 !== null && item.countedQty2 !== undefined;
  const needsRecount = mode === "recount" && item.status !== "DIVERGENT";

  return (
    <tr>
      <td className="mono">{item.product?.sku}</td>
      <td>{item.product?.description}</td>
      <td className="mono">{item.location?.fullCode}</td>
      <td className="mono">{item.systemQty}</td>
      <td className="mono">{item.countedQty1 ?? "-"}</td>
      {mode === "recount" && <td className="mono">{item.countedQty2 ?? "-"}</td>}
      <td><Badge value={item.status} /></td>
      <td>
        {canManage && !alreadyDone && !needsRecount && (
          <div className="row">
            <input type="number" style={{ width: 70 }} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            <button className="btn sm primary" disabled={mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>Registrar</button>
          </div>
        )}
        {error && <div className="field-hint">{error}</div>}
      </td>
    </tr>
  );
}

export function CountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("count.manage");
  const canApprove = hasPermission("count.approve");
  const [error, setError] = useState<string | null>(null);

  const { data: count, isLoading } = useQuery({ queryKey: ["/counts", id], queryFn: () => api.get<InventoryCount>(`/counts/${id}`) });

  const actionMutation = useMutation({
    mutationFn: (action: string) => api.post(`/counts/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/counts", id] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao executar ação."),
  });

  if (isLoading || !count) return <Loading />;

  const mode: "count" | "recount" = count.status === "RECOUNT" ? "recount" : "count";
  const allCounted = (count.items ?? []).every((i) => i.countedQty1 !== null && i.countedQty1 !== undefined);
  const allRecounted = (count.items ?? []).filter((i) => i.status === "DIVERGENT").every((i) => i.countedQty2 !== null && i.countedQty2 !== undefined);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Contagem {count.code}</h1>
          <p className="page-subtitle">{count.type} · {count.items?.length ?? 0} posição(ões)</p>
        </div>
        <Badge value={count.status} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        {canManage && count.status === "OPEN" && <button className="btn primary" onClick={() => actionMutation.mutate("start")}>Iniciar contagem</button>}
        {canManage && count.status === "COUNTING" && <button className="btn primary" disabled={!allCounted} onClick={() => actionMutation.mutate("complete-counting")}>Concluir contagem</button>}
        {canManage && count.status === "DISCREPANCY" && <button className="btn primary" onClick={() => actionMutation.mutate("start-recount")}>Iniciar recontagem</button>}
        {canManage && count.status === "RECOUNT" && <button className="btn primary" disabled={!allRecounted} onClick={() => actionMutation.mutate("complete-recount")}>Concluir recontagem</button>}
        {canApprove && count.status === "APPROVAL" && <button className="btn primary" onClick={() => actionMutation.mutate("approve")}>Aprovar contagem</button>}
        {canApprove && count.status === "ADJUSTMENT" && <button className="btn primary" onClick={() => actionMutation.mutate("apply-adjustments")}>Aplicar ajustes de estoque</button>}
        {canManage && !["COMPLETED", "CANCELLED"].includes(count.status) && <button className="btn danger" onClick={() => actionMutation.mutate("cancel")}>Cancelar</button>}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>SKU</th><th>Produto</th><th>Endereço</th><th>Sistema</th><th>1ª Contagem</th>
              {mode === "recount" && <th>2ª Contagem</th>}
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(count.items ?? []).map((item) => <CountItemRow key={item.id} count={count} item={item} mode={mode} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
