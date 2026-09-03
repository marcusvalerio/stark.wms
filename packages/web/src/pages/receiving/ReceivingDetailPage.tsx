import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { Dock, Paginated, Receipt, ReceiptItem, Task, Location as Loc } from "@/api/types";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

const RECEIPT_STEPS = ["SCHEDULED", "ARRIVED", "AT_DOCK", "IN_CONFERENCE", "CONFERRED", "PUTAWAY", "COMPLETED"];

function Timeline({ current }: { current: string }) {
  if (current === "CANCELLED") return <span className="badge danger">CANCELADO</span>;
  const idx = RECEIPT_STEPS.indexOf(current);
  return (
    <div className="timeline">
      {RECEIPT_STEPS.map((s, i) => (
        <span key={s}>
          <span className={`step ${i < idx ? "done" : i === idx ? "current" : ""}`}>{s}</span>
          {i < RECEIPT_STEPS.length - 1 && <span className="arrow"> → </span>}
        </span>
      ))}
    </div>
  );
}

function CheckItemRow({ receiptId, item, canCheck }: { receiptId: string; item: ReceiptItem; canCheck: boolean }) {
  const qc = useQueryClient();
  const [receivedQty, setReceivedQty] = useState(item.expectedQty);
  const [damagedQty, setDamagedQty] = useState(0);
  const [lotCode, setLotCode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/receiving/${receiptId}/items/${item.id}/check`, {
        receivedQty, damagedQty,
        lotCode: item.product?.lotControl ? lotCode : undefined,
        expiryDate: item.product?.expiryControl && expiryDate ? new Date(expiryDate).toISOString() : undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/receiving", receiptId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao conferir item."),
  });

  const alreadyChecked = item.status !== "PENDING";

  return (
    <tr>
      <td className="mono">{item.product?.sku}</td>
      <td>{item.product?.description}</td>
      <td className="mono">{item.expectedQty}</td>
      <td>{alreadyChecked ? <span className="mono">{item.receivedQty}</span> : <input type="number" style={{ width: 70 }} value={receivedQty} onChange={(e) => setReceivedQty(Number(e.target.value))} />}</td>
      <td>{alreadyChecked ? <span className="mono">{item.damagedQty}</span> : <input type="number" style={{ width: 60 }} value={damagedQty} onChange={(e) => setDamagedQty(Number(e.target.value))} />}</td>
      <td>
        {item.product?.lotControl && (alreadyChecked ? item.lot?.code ?? "-" : <input style={{ width: 90 }} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Lote" />)}
      </td>
      <td>
        {item.product?.expiryControl && (alreadyChecked ? (item.lot?.expiryDate ? new Date(item.lot.expiryDate).toLocaleDateString("pt-BR") : "-") : <input type="date" style={{ width: 130 }} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />)}
      </td>
      <td><Badge value={item.status} /></td>
      <td>
        {!alreadyChecked && canCheck && (
          <button className="btn sm primary" disabled={mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>Conferir</button>
        )}
        {error && <div className="field-hint">{error}</div>}
      </td>
    </tr>
  );
}

function PutawayTaskRow({ task, locations, canExecute }: { task: Task; locations: Loc[]; canExecute: boolean }) {
  const qc = useQueryClient();
  const reserveLocations = locations.filter((l) => l.type === "RESERVE" || l.type === "PICKING");
  const [destLocationId, setDestLocationId] = useState(reserveLocations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.post(`/receiving/putaway-tasks/${task.id}/execute`, { destLocationId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["putaway-tasks"] });
      qc.invalidateQueries({ queryKey: ["/receiving"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao executar put-away."),
  });

  return (
    <tr>
      <td className="mono">{task.product?.sku}</td>
      <td>{task.product?.description}</td>
      <td className="mono">{task.qty}</td>
      <td><Badge value={task.priority} /></td>
      <td>
        {canExecute ? (
          <select value={destLocationId} onChange={(e) => setDestLocationId(e.target.value)} style={{ minWidth: 160 }}>
            {reserveLocations.map((l) => <option key={l.id} value={l.id}>{l.fullCode} ({l.occupiedQty}/{l.capacityQty})</option>)}
          </select>
        ) : <span className="page-subtitle">Sugestão: reserva</span>}
      </td>
      <td>
        {canExecute && <button className="btn sm primary" disabled={mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>Armazenar</button>}
        {error && <div className="field-hint">{error}</div>}
      </td>
    </tr>
  );
}

export function ReceivingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const canManage = hasPermission("receiving.manage");
  const canCheck = hasPermission("receiving.check", "receiving.manage");
  const canExecute = hasPermission("task.execute");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: receipt, isLoading } = useQuery({ queryKey: ["/receiving", id], queryFn: () => api.get<Receipt>(`/receiving/${id}`) });
  const { data: docks } = useQuery({ queryKey: ["/warehouse/docks"], queryFn: () => api.get<Dock[]>("/warehouse/docks") });
  const { data: locations } = useQuery({ queryKey: ["/warehouse/locations", "all"], queryFn: () => api.get<Paginated<Loc>>("/warehouse/locations?pageSize=200") });
  const { data: putawayTasks } = useQuery({
    queryKey: ["putaway-tasks", id],
    queryFn: () => api.get<Paginated<Task>>(`/tasks?${new URLSearchParams({ type: "PUTAWAY", receiptId: id ?? "", pageSize: "50" })}`),
    enabled: Boolean(id),
  });

  const [dockId, setDockId] = useState("");

  const actionMutation = useMutation({
    mutationFn: (action: string) => api.post(`/receiving/${id}/${action}`, action === "assign-dock" ? { dockId } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/receiving", id] }),
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "Falha ao executar ação."),
  });

  if (isLoading || !receipt) return <Loading />;

  const receivingDocks = (docks ?? []).filter((d) => d.type === "RECEIVING");
  const pendingPutaway = (putawayTasks?.items ?? []).filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Recebimento {receipt.number}</h1>
          <p className="page-subtitle">{receipt.supplier?.legalName} · agendado para {new Date(receipt.scheduledDate).toLocaleDateString("pt-BR")}</p>
        </div>
        <Badge value={receipt.status} />
      </div>

      <Timeline current={receipt.status} />
      {actionError && <div style={{ marginTop: 12 }}><ErrorBanner message={actionError} /></div>}

      <div className="row" style={{ marginTop: 16, marginBottom: 6, flexWrap: "wrap" }}>
        {canManage && receipt.status === "SCHEDULED" && <button className="btn" onClick={() => actionMutation.mutate("arrive")}>Registrar chegada</button>}
        {canManage && receipt.status === "ARRIVED" && (
          <>
            <select value={dockId} onChange={(e) => setDockId(e.target.value)}>
              <option value="">Selecione a doca...</option>
              {receivingDocks.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
            </select>
            <button className="btn" disabled={!dockId} onClick={() => actionMutation.mutate("assign-dock")}>Atribuir doca</button>
          </>
        )}
        {canCheck && receipt.status === "AT_DOCK" && <button className="btn primary" onClick={() => actionMutation.mutate("start-conference")}>Iniciar conferência</button>}
        {canCheck && receipt.status === "IN_CONFERENCE" && <button className="btn primary" onClick={() => actionMutation.mutate("complete-conference")}>Concluir conferência</button>}
        {canManage && !["COMPLETED", "CANCELLED", "PUTAWAY"].includes(receipt.status) && <button className="btn danger" onClick={() => actionMutation.mutate("cancel")}>Cancelar recebimento</button>}
      </div>

      <div className="section-title">Itens do recebimento</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>SKU</th><th>Produto</th><th>Esperado</th><th>Recebido</th><th>Avariado</th><th>Lote</th><th>Validade</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {receipt.items.map((item) => <CheckItemRow key={item.id} receiptId={receipt.id} item={item} canCheck={canCheck && receipt.status === "IN_CONFERENCE"} />)}
          </tbody>
        </table>
      </div>

      {(receipt.status === "PUTAWAY" || pendingPutaway.length > 0) && (
        <>
          <div className="section-title">Tarefas de Put-away</div>
          {pendingPutaway.length === 0 ? <p className="page-subtitle">Nenhuma tarefa de put-away pendente.</p> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>SKU</th><th>Produto</th><th>Qtd</th><th>Prioridade</th><th>Destino</th><th></th></tr></thead>
                <tbody>
                  {pendingPutaway.map((t) => <PutawayTaskRow key={t.id} task={t} locations={locations?.items ?? []} canExecute={canExecute} />)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
