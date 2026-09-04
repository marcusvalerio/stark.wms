import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { Dock, Order, Package, Paginated, PickingTask, Shipment } from "@/api/types";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

const ORDER_STEPS = ["RECEIVED", "RELEASED", "ALLOCATED", "PICKING", "PICKED", "CONFERENCE", "PACKING", "STAGING", "READY", "SHIPPED"];

function Timeline({ current }: { current: string }) {
  if (current === "CANCELLED") return <span className="badge danger">CANCELADO</span>;
  const idx = ORDER_STEPS.indexOf(current);
  return (
    <div className="timeline">
      {ORDER_STEPS.map((s, i) => (
        <span key={s}>
          <span className={`step ${i < idx ? "done" : i === idx ? "current" : ""}`}>{s}</span>
          {i < ORDER_STEPS.length - 1 && <span className="arrow"> → </span>}
        </span>
      ))}
    </div>
  );
}

function PickTaskRow({ task }: { task: PickingTask }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(task.qtySuggested - task.qtyPicked);
  const [error, setError] = useState<string | null>(null);
  const { hasPermission } = useAuth();
  const canExecute = hasPermission("task.execute");

  const mutation = useMutation({
    mutationFn: () => api.post(`/orders/picking-tasks/${task.id}/pick`, { qtyPicked: qty }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["order-picking-tasks"] }); qc.invalidateQueries({ queryKey: ["/orders"] }); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao separar."),
  });

  const done = task.status === "COMPLETED";
  return (
    <tr>
      <td className="mono">{task.product?.sku}</td>
      <td>{task.product?.description}</td>
      <td className="mono">{task.location?.fullCode}</td>
      <td><Badge value={task.strategy} /></td>
      <td className="mono">{task.qtyPicked} / {task.qtySuggested}</td>
      <td><Badge value={task.status} /></td>
      <td>
        {!done && canExecute && (
          <div className="row">
            <input type="number" style={{ width: 60 }} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            <button className="btn sm primary" disabled={mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>Separar</button>
          </div>
        )}
        {error && <div className="field-hint">{error}</div>}
      </td>
    </tr>
  );
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canRelease = hasPermission("order.release", "order.manage");
  const canManage = hasPermission("order.manage");
  const canPack = hasPermission("packing.manage");
  const canShip = hasPermission("shipping.manage");
  const [actionError, setActionError] = useState<string | null>(null);
  const [packageCode, setPackageCode] = useState("");

  const { data: order, isLoading } = useQuery({ queryKey: ["/orders", id], queryFn: () => api.get<Order>(`/orders/${id}`) });
  const { data: pickingTasks } = useQuery({
    queryKey: ["order-picking-tasks", id],
    queryFn: () => api.get<Paginated<PickingTask>>(`/orders/picking-tasks?${new URLSearchParams({ orderId: id ?? "", pageSize: "50" })}`),
    enabled: Boolean(id) && ["PICKING", "PICKED", "CONFERENCE"].includes(order?.status ?? ""),
  });
  const { data: packages } = useQuery({
    queryKey: ["order-packages", id],
    queryFn: () => api.get<Package[]>(`/packing/orders/${id}/packages`),
    enabled: Boolean(id) && ["CONFERENCE", "PACKING", "STAGING", "READY", "SHIPPED"].includes(order?.status ?? ""),
  });
  const { data: shipments } = useQuery({
    queryKey: ["shipments"],
    queryFn: () => api.get<Shipment[]>("/shipping"),
    enabled: Boolean(id) && ["STAGING", "READY", "SHIPPED"].includes(order?.status ?? ""),
  });
  const { data: docks } = useQuery({ queryKey: ["/warehouse/docks"], queryFn: () => api.get<Dock[]>("/warehouse/docks"), enabled: canShip });

  const orderAction = useMutation({
    mutationFn: (action: string) => api.post(`/orders/${id}/${action}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/orders", id] }); qc.invalidateQueries({ queryKey: ["order-picking-tasks"] }); },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao executar ação."),
  });

  const createPackage = useMutation({
    mutationFn: () => api.post("/packing/packages", { orderId: id, code: packageCode || `${order?.number}-VOL${((packages?.length ?? 0) + 1).toString().padStart(2, "0")}` }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["order-packages", id] }); qc.invalidateQueries({ queryKey: ["/orders", id] }); setPackageCode(""); },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao criar volume."),
  });

  const addAllItemsToPackage = useMutation({
    mutationFn: async (packageId: string) => {
      if (!order) return;
      for (const item of order.items) {
        const packed = packages?.find((p) => p.id === packageId)?.items.filter((pi) => pi.orderItemId === item.id).reduce((s, pi) => s + pi.qty, 0) ?? 0;
        const remaining = item.qtyPicked - packed;
        if (remaining > 0) await api.post(`/packing/packages/${packageId}/items`, { orderItemId: item.id, qty: remaining });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["order-packages", id] }),
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao adicionar itens."),
  });

  const closePackage = useMutation({
    mutationFn: (packageId: string) => api.post(`/packing/packages/${packageId}/close`, { weightKg: 5, lengthCm: 40, widthCm: 30, heightCm: 25 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["order-packages", id] }),
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao fechar volume."),
  });

  const sendToStaging = useMutation({
    mutationFn: () => api.post(`/packing/orders/${id}/send-to-staging`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/orders", id] }); },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao enviar para staging."),
  });

  const createShipment = useMutation({
    mutationFn: () => api.post("/shipping", { orderId: id, carrierId: order?.carrierId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipments"] }); qc.invalidateQueries({ queryKey: ["/orders", id] }); },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao criar expedição."),
  });

  const shipmentAction = useMutation({
    mutationFn: (params: { shipmentId: string; action: string; body?: unknown }) => api.post(`/shipping/${params.shipmentId}/${params.action}`, params.body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipments"] }); qc.invalidateQueries({ queryKey: ["/orders", id] }); },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao executar ação de expedição."),
  });

  if (isLoading || !order) return <Loading />;

  const shipment = shipments?.find((s) => s.orderId === id);
  const shippingDocks = (docks ?? []).filter((d) => d.type === "SHIPPING");
  const allPickTasksDone = (pickingTasks?.items ?? []).length > 0 && pickingTasks!.items.every((t) => t.status === "COMPLETED" || t.status === "CANCELLED");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pedido {order.number}</h1>
          <p className="page-subtitle">{order.customer?.name} · {order.carrier?.name ?? "sem transportadora"}</p>
        </div>
        <div className="row"><Badge value={order.priority} /><Badge value={order.status} /></div>
      </div>

      <Timeline current={order.status} />
      {actionError && <div style={{ marginTop: 12 }}><ErrorBanner message={actionError} /></div>}

      <div className="row" style={{ marginTop: 16, marginBottom: 6, flexWrap: "wrap" }}>
        {canRelease && order.status === "RECEIVED" && <button className="btn primary" onClick={() => orderAction.mutate("release")}>Liberar pedido (reservar estoque)</button>}
        {canRelease && order.status === "ALLOCATED" && <button className="btn primary" onClick={() => orderAction.mutate("start-picking")}>Gerar tarefas de separação</button>}
        {canManage && order.status === "PICKED" && <button className="btn primary" onClick={() => orderAction.mutate("advance-conference")}>Avançar para conferência</button>}
        {canManage && ["RECEIVED", "RELEASED", "ALLOCATED", "PICKING"].includes(order.status) && <button className="btn danger" onClick={() => orderAction.mutate("cancel")}>Cancelar pedido</button>}
      </div>

      <div className="section-title">Itens do pedido</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>SKU</th><th>Produto</th><th>Pedido</th><th>Alocado</th><th>Separado</th><th>Expedido</th></tr></thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.product?.sku}</td>
                <td>{item.product?.description}</td>
                <td className="mono">{item.qtyOrdered}</td>
                <td className="mono">{item.qtyAllocated}</td>
                <td className="mono">{item.qtyPicked}</td>
                <td className="mono">{item.qtyShipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {["PICKING", "PICKED", "CONFERENCE"].includes(order.status) && (
        <>
          <div className="section-title">Tarefas de separação (picking)</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>SKU</th><th>Produto</th><th>Endereço</th><th>Estratégia</th><th>Separado / Sugerido</th><th>Status</th><th></th></tr></thead>
              <tbody>{(pickingTasks?.items ?? []).map((t) => <PickTaskRow key={t.id} task={t} />)}</tbody>
            </table>
          </div>
          {order.status === "PICKED" && !allPickTasksDone && <p className="page-subtitle">Aguardando finalização de todas as tarefas de separação.</p>}
        </>
      )}

      {["CONFERENCE", "PACKING", "STAGING", "READY", "SHIPPED"].includes(order.status) && (
        <>
          <div className="section-title">Volumes (Packing)</div>
          {canPack && (order.status === "CONFERENCE" || order.status === "PACKING") && (
            <div className="row" style={{ marginBottom: 10 }}>
              <input placeholder="Código do volume (opcional)" value={packageCode} onChange={(e) => setPackageCode(e.target.value)} />
              <button className="btn" onClick={() => createPackage.mutate()}>+ Novo volume</button>
            </div>
          )}
          <div className="stack">
            {(packages ?? []).map((pkg) => (
              <div className="card" key={pkg.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong className="mono">{pkg.code}</strong>
                  <Badge value={pkg.status} />
                </div>
                <table className="data" style={{ marginTop: 8 }}>
                  <thead><tr><th>Produto</th><th>Qtd</th></tr></thead>
                  <tbody>
                    {pkg.items.map((it) => <tr key={it.id}><td>{it.orderItem?.product?.sku}</td><td className="mono">{it.qty}</td></tr>)}
                    {pkg.items.length === 0 && <tr><td colSpan={2} className="page-subtitle">Sem itens.</td></tr>}
                  </tbody>
                </table>
                {canPack && pkg.status === "OPEN" && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn sm" onClick={() => addAllItemsToPackage.mutate(pkg.id)}>Adicionar itens separados</button>
                    <button className="btn sm primary" onClick={() => closePackage.mutate(pkg.id)}>Fechar volume</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {canPack && order.status === "PACKING" && (
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => sendToStaging.mutate()}>Enviar para staging</button>
          )}
        </>
      )}

      {["STAGING", "READY", "SHIPPED"].includes(order.status) && (
        <>
          <div className="section-title">Expedição</div>
          {!shipment && canShip && order.status === "STAGING" && (
            <button className="btn primary" onClick={() => createShipment.mutate()}>Criar expedição / romaneio</button>
          )}
          {shipment && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong className="mono">{shipment.romaneioNumber}</strong>
                <Badge value={shipment.status} />
              </div>
              <p className="page-subtitle">Transportadora: {shipment.carrier?.name} · Doca: {shipment.dock?.code ?? "não atribuída"}</p>
              {canShip && (
                <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                  {shipment.status === "STAGING" && (
                    <select onChange={(e) => shipmentAction.mutate({ shipmentId: shipment.id, action: "assign-dock", body: { dockId: e.target.value } })} defaultValue="">
                      <option value="" disabled>Atribuir doca...</option>
                      {shippingDocks.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
                    </select>
                  )}
                  {shipment.status === "DOCK" && <button className="btn sm primary" onClick={() => shipmentAction.mutate({ shipmentId: shipment.id, action: "load" })}>Carregar</button>}
                  {shipment.status === "LOADING" && <button className="btn sm primary" onClick={() => shipmentAction.mutate({ shipmentId: shipment.id, action: "ship" })}>Expedir</button>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
