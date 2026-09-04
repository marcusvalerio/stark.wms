import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { InventoryBalance, Paginated, QualityInspection } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export function QualityPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("quality.manage");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  const [deciding, setDeciding] = useState<QualityInspection | null>(null);
  const [balanceId, setBalanceId] = useState("");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["/quality", page], queryFn: () => api.get<Paginated<QualityInspection>>(`/quality?page=${page}&pageSize=15`) });
  const { data: balances } = useQuery({ queryKey: ["/inventory/balances", "quality"], queryFn: () => api.get<Paginated<InventoryBalance>>("/inventory/balances?pageSize=100"), enabled: opening });

  function openNew() {
    setBalanceId(""); setQty(1); setNotes(""); setError(null); setOpening(true);
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const b = balances?.items.find((x) => x.id === balanceId);
      if (!b) throw new Error("Selecione um item de estoque.");
      return api.post("/quality", { refType: "ROTINA", refId: "manual", productId: b.productId, lotId: b.lotId ?? undefined, locationId: b.locationId, qty, notes });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/quality"] }); setOpening(false); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao abrir inspeção."),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quality/${id}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/quality"] }),
  });

  const decideMutation = useMutation({
    mutationFn: (result: "APPROVED" | "REJECTED") => api.post(`/quality/${deciding!.id}/decide`, { result, notes: decisionNotes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/quality"] }); setDeciding(null); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao decidir inspeção."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Qualidade</h1>
          <p className="page-subtitle">Bloqueio, quarentena, inspeção, liberação e reprovação de estoque</p>
        </div>
        {canManage && <button className="btn primary" onClick={openNew}>+ Nova Inspeção</button>}
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<QualityInspection>
            columns={[
              { key: "sku", header: "SKU", render: (r) => <span className="mono">{r.product?.sku}</span> },
              { key: "product", header: "Produto", render: (r) => r.product?.description },
              { key: "lot", header: "Lote", render: (r) => r.lot?.code ?? "-" },
              { key: "location", header: "Endereço", render: (r) => r.location?.fullCode ?? "-" },
              { key: "qty", header: "Qtd", render: (r) => <span className="mono">{r.qty ?? "-"}</span> },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              { key: "actions", header: "", render: (r) => (
                canManage && (
                  <div className="row">
                    {r.status === "PENDING" && <button className="btn sm" onClick={() => startMutation.mutate(r.id)}>Iniciar inspeção</button>}
                    {r.status === "INSPECTING" && <button className="btn sm primary" onClick={() => { setDeciding(r); setDecisionNotes(""); setError(null); }}>Decidir</button>}
                  </div>
                )
              ) },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {opening && (
        <Modal title="Nova Inspeção de Qualidade" onClose={() => setOpening(false)}>
          {error && <ErrorBanner message={error} />}
          <div className="field">
            <label>Item de estoque</label>
            <select value={balanceId} onChange={(e) => setBalanceId(e.target.value)}>
              <option value="">Selecione...</option>
              {balances?.items.filter((b) => b.qtyAvailable > 0).map((b) => (
                <option key={b.id} value={b.id}>{b.product?.sku} · {b.location?.fullCode} · disp: {b.qtyAvailable}{b.lot ? ` · lote ${b.lot.code}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="field"><label>Quantidade a inspecionar</label><input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
          <div className="field"><label>Observações</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setOpening(false)}>Cancelar</button>
            <button className="btn primary" disabled={!balanceId || createMutation.isPending} onClick={() => createMutation.mutate()}>Enviar para quarentena</button>
          </div>
        </Modal>
      )}

      {deciding && (
        <Modal title={`Decidir inspeção — ${deciding.product?.sku}`} onClose={() => setDeciding(null)}>
          {error && <ErrorBanner message={error} />}
          <div className="field"><label>Observações *</label><textarea rows={2} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setDeciding(null)}>Cancelar</button>
            <button className="btn danger" disabled={!decisionNotes || decideMutation.isPending} onClick={() => decideMutation.mutate("REJECTED")}>Reprovar</button>
            <button className="btn primary" disabled={!decisionNotes || decideMutation.isPending} onClick={() => decideMutation.mutate("APPROVED")}>Aprovar / Liberar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
