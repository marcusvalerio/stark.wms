import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError, qs } from "@/api/client";
import { Paginated, Receipt, Supplier, Product } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export function ReceivingListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("receiving.manage");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [items, setItems] = useState<{ productId: string; expectedQty: number }[]>([{ productId: "", expectedQty: 10 }]);

  const { data, isLoading } = useQuery({
    queryKey: ["/receiving", page, status],
    queryFn: () => api.get<Paginated<Receipt>>(`/receiving${qs({ page, pageSize: 15, status })}`),
  });
  const { data: suppliers } = useQuery({ queryKey: ["/partners/suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/partners/suppliers?pageSize=100") });
  const { data: products } = useQuery({ queryKey: ["/catalog/products", "all"], queryFn: () => api.get<Paginated<Product>>("/catalog/products?pageSize=200") });

  const statuses = ["SCHEDULED", "ARRIVED", "AT_DOCK", "IN_CONFERENCE", "CONFERRED", "PUTAWAY", "COMPLETED", "CANCELLED"];

  function openNew() {
    setNumber(`REC-${Date.now().toString().slice(-6)}`);
    setSupplierId(suppliers?.items[0]?.id ?? "");
    setItems([{ productId: products?.items[0]?.id ?? "", expectedQty: 10 }]);
    setFormError(null);
    setCreating(true);
  }

  const createMutation = useMutation({
    mutationFn: () => api.post("/receiving", { number, supplierId, scheduledDate: new Date().toISOString(), items }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["/receiving"] });
      setCreating(false);
      navigate(`/receiving/${res.id}`);
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Falha ao criar recebimento."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Recebimentos</h1>
          <p className="page-subtitle">Agendamento → chegada → doca → conferência → put-away → finalizado</p>
        </div>
        {canManage && <button className="btn primary" onClick={openNew}>+ Novo Recebimento</button>}
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todos os status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<Receipt>
            columns={[
              { key: "number", header: "Número", render: (r) => <span className="mono">{r.number}</span> },
              { key: "supplier", header: "Fornecedor", render: (r) => r.supplier?.legalName ?? "-" },
              { key: "date", header: "Agendado", render: (r) => new Date(r.scheduledDate).toLocaleDateString("pt-BR") },
              { key: "dock", header: "Doca", render: (r) => r.dock?.code ?? "-" },
              { key: "items", header: "Itens", render: (r) => r.items.length },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
            ]}
            rows={data?.items ?? []}
            onRowClick={(r) => navigate(`/receiving/${r.id}`)}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {creating && (
        <Modal title="Novo Recebimento" onClose={() => setCreating(false)} width={640}>
          {formError && <ErrorBanner message={formError} />}
          <div className="field-row">
            <div className="field"><label>Número *</label><input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            <div className="field">
              <label>Fornecedor *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                {suppliers?.items.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
              </select>
            </div>
          </div>
          <div className="section-title" style={{ marginTop: 6 }}>Itens esperados</div>
          {items.map((item, idx) => (
            <div className="field-row" key={idx}>
              <div className="field" style={{ flex: 2 }}>
                <label>Produto</label>
                <select value={item.productId} onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, productId: e.target.value } : it)))}>
                  {products?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.description}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Qtd esperada</label>
                <input type="number" value={item.expectedQty} onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, expectedQty: Number(e.target.value) } : it)))} />
              </div>
              <button className="btn ghost sm" style={{ alignSelf: "center", marginTop: 18 }} onClick={() => setItems(items.filter((_, i) => i !== idx))} disabled={items.length === 1}>Remover</button>
            </div>
          ))}
          <button className="btn ghost sm" onClick={() => setItems([...items, { productId: products?.items[0]?.id ?? "", expectedQty: 10 }])}>+ Adicionar item</button>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="btn primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>Criar recebimento</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
