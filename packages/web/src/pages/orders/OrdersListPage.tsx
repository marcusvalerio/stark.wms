import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError, qs } from "@/api/client";
import { Carrier, Customer, Order, Paginated, Product, UnitOfMeasure } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export function OrdersListPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("order.manage");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [items, setItems] = useState<{ productId: string; uomId: string; qtyOrdered: number }[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["/orders", page, status],
    queryFn: () => api.get<Paginated<Order>>(`/orders${qs({ page, pageSize: 15, status })}`),
  });
  const { data: customers } = useQuery({ queryKey: ["/partners/customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/partners/customers?pageSize=100") });
  const { data: carriers } = useQuery({ queryKey: ["/partners/carriers", "all"], queryFn: () => api.get<Paginated<Carrier>>("/partners/carriers?pageSize=100") });
  const { data: products } = useQuery({ queryKey: ["/catalog/products", "all"], queryFn: () => api.get<Paginated<Product>>("/catalog/products?pageSize=200") });
  const { data: uoms } = useQuery({ queryKey: ["/catalog/uoms", "all"], queryFn: () => api.get<Paginated<UnitOfMeasure>>("/catalog/uoms?pageSize=100") });

  const statuses = ["RECEIVED", "RELEASED", "ALLOCATED", "PICKING", "PICKED", "CONFERENCE", "PACKING", "STAGING", "READY", "SHIPPED", "CANCELLED"];

  function openNew() {
    setNumber(`PED-${Date.now().toString().slice(-6)}`);
    setCustomerId(customers?.items[0]?.id ?? "");
    setCarrierId(carriers?.items[0]?.id ?? "");
    setPriority("NORMAL");
    setItems([{ productId: products?.items[0]?.id ?? "", uomId: uoms?.items.find((u) => u.isBase)?.id ?? "", qtyOrdered: 1 }]);
    setFormError(null);
    setCreating(true);
  }

  const createMutation = useMutation({
    mutationFn: () => api.post("/orders", { number, customerId, carrierId, priority, items }),
    onSuccess: (res: any) => { qc.invalidateQueries({ queryKey: ["/orders"] }); setCreating(false); navigate(`/orders/${res.id}`); },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Falha ao criar pedido."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="page-subtitle">Recebido → liberado → alocado → separação → conferência → embalagem → expedido</p>
        </div>
        {canManage && <button className="btn primary" onClick={openNew}>+ Novo Pedido</button>}
      </div>

      <div className="toolbar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Todos os status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<Order>
            columns={[
              { key: "number", header: "Número", render: (r) => <span className="mono">{r.number}</span> },
              { key: "customer", header: "Cliente", render: (r) => r.customer?.name ?? "-" },
              { key: "priority", header: "Prioridade", render: (r) => <Badge value={r.priority} /> },
              { key: "items", header: "Itens", render: (r) => r.items.length },
              { key: "sla", header: "SLA", render: (r) => (r.slaDueAt ? new Date(r.slaDueAt).toLocaleString("pt-BR") : "-") },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
            ]}
            rows={data?.items ?? []}
            onRowClick={(r) => navigate(`/orders/${r.id}`)}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {creating && (
        <Modal title="Novo Pedido" onClose={() => setCreating(false)} width={680}>
          {formError && <ErrorBanner message={formError} />}
          <div className="field-row">
            <div className="field"><label>Número *</label><input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            <div className="field">
              <label>Cliente *</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>{customers?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <div className="field">
              <label>Transportadora</label>
              <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>{carriers?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </div>
            <div className="field">
              <label>Prioridade</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>{["CRITICAL", "HIGH", "NORMAL", "LOW"].map((p) => <option key={p} value={p}>{p}</option>)}</select>
            </div>
          </div>
          <div className="section-title" style={{ marginTop: 6 }}>Itens do pedido</div>
          {items.map((item, idx) => (
            <div className="field-row" key={idx}>
              <div className="field" style={{ flex: 2 }}>
                <label>Produto</label>
                <select value={item.productId} onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, productId: e.target.value } : it)))}>
                  {products?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.description}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Qtd</label>
                <input type="number" value={item.qtyOrdered} onChange={(e) => setItems(items.map((it, i) => (i === idx ? { ...it, qtyOrdered: Number(e.target.value) } : it)))} />
              </div>
              <button className="btn ghost sm" style={{ alignSelf: "center", marginTop: 18 }} onClick={() => setItems(items.filter((_, i) => i !== idx))} disabled={items.length === 1}>Remover</button>
            </div>
          ))}
          <button className="btn ghost sm" onClick={() => setItems([...items, { productId: products?.items[0]?.id ?? "", uomId: uoms?.items.find((u) => u.isBase)?.id ?? "", qtyOrdered: 1 }])}>+ Adicionar item</button>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="btn primary" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>Criar pedido</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
