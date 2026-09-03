import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/api/client";
import { Discrepancy, Paginated } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export function DiscrepanciesPage() {
  const { hasPermission } = useAuth();
  const canResolve = hasPermission("discrepancy.resolve");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [resolving, setResolving] = useState<Discrepancy | null>(null);
  const [action, setAction] = useState("AJUSTE_ACEITO");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["/discrepancies", page, status],
    queryFn: () => api.get<Paginated<Discrepancy>>(`/discrepancies${qs({ page, pageSize: 15, status })}`),
  });

  const reviewMutation = useMutation({
    mutationFn: (id: string) => api.post(`/discrepancies/${id}/review`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/discrepancies"] }),
  });

  const resolveMutation = useMutation({
    mutationFn: () => api.post(`/discrepancies/${resolving!.id}/resolve`, { action, notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/discrepancies"] }); setResolving(null); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao resolver."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Divergências</h1>
          <p className="page-subtitle">Falta, sobra, produto incorreto, lote, validade, avaria, documento, endereço</p>
        </div>
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todos os status</option>
          {["OPEN", "IN_REVIEW", "RESOLVED", "CANCELLED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<Discrepancy>
            columns={[
              { key: "type", header: "Tipo", render: (r) => <Badge value={r.type} /> },
              { key: "ref", header: "Origem", render: (r) => `${r.refType} · ${r.refId.slice(0, 8)}` },
              { key: "product", header: "Produto", render: (r) => r.product ? `${r.product.sku} — ${r.product.description}` : "-" },
              { key: "qty", header: "Esperado / Real", render: (r) => <span className="mono">{r.expectedQty ?? "-"} / {r.actualQty ?? "-"}</span> },
              { key: "description", header: "Descrição", render: (r) => r.description },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              { key: "actions", header: "", render: (r) => (
                canResolve && (r.status === "OPEN" || r.status === "IN_REVIEW") ? (
                  <div className="row">
                    {r.status === "OPEN" && <button className="btn ghost sm" onClick={() => reviewMutation.mutate(r.id)}>Analisar</button>}
                    <button className="btn sm primary" onClick={() => { setResolving(r); setNotes(""); setError(null); }}>Resolver</button>
                  </div>
                ) : null
              ) },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {resolving && (
        <Modal title={`Resolver divergência — ${resolving.type}`} onClose={() => setResolving(null)}>
          {error && <ErrorBanner message={error} />}
          <p className="page-subtitle">{resolving.description}</p>
          <div className="field">
            <label>Ação tomada</label>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="AJUSTE_ACEITO">Ajuste aceito — estoque corrigido</option>
              <option value="COBRANCA_FORNECEDOR">Cobrança ao fornecedor</option>
              <option value="DEVOLUCAO">Devolução</option>
              <option value="PERDA_REGISTRADA">Perda registrada</option>
            </select>
          </div>
          <div className="field">
            <label>Observações *</label>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setResolving(null)}>Cancelar</button>
            <button className="btn primary" disabled={!notes || resolveMutation.isPending} onClick={() => resolveMutation.mutate()}>Confirmar resolução</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
