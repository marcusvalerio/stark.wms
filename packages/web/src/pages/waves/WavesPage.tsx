import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { Order, Paginated, PickWave } from "@/api/types";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export function WavesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("wave.manage");
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: waves, isLoading } = useQuery({ queryKey: ["/waves"], queryFn: () => api.get<Paginated<PickWave>>("/waves?pageSize=50") });
  const { data: allocatedOrders } = useQuery({
    queryKey: ["/orders", "allocated"],
    queryFn: () => api.get<Paginated<Order>>("/orders?status=ALLOCATED&pageSize=100"),
    enabled: creating,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/waves", { code, orderIds: selectedOrders }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/waves"] }); setCreating(false); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao criar onda."),
  });

  const actionMutation = useMutation({
    mutationFn: ({ waveId, action }: { waveId: string; action: string }) => api.post(`/waves/${waveId}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/waves"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao executar ação."),
  });

  function openNew() {
    setCode(`ONDA-${Date.now().toString().slice(-6)}`);
    setSelectedOrders([]);
    setError(null);
    setCreating(true);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Ondas de Picking</h1>
          <p className="page-subtitle">Agrupamento de pedidos por prioridade, cliente, zona ou transportadora</p>
        </div>
        {canManage && <button className="btn primary" onClick={openNew}>+ Nova Onda</button>}
      </div>

      {error && <ErrorBanner message={error} />}

      {isLoading ? <Loading /> : (
        <div className="stack">
          {(waves?.items ?? []).map((wave) => (
            <div className="card" key={wave.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong className="mono">{wave.code}</strong>
                <Badge value={wave.status} />
              </div>
              <table className="data" style={{ marginTop: 10 }}>
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Prioridade</th><th>Status</th></tr></thead>
                <tbody>
                  {wave.orders?.map((wo) => (
                    <tr key={wo.order.id}>
                      <td className="mono">{wo.order.number}</td>
                      <td>{wo.order.customer.name}</td>
                      <td><Badge value={wo.order.priority} /></td>
                      <td><Badge value={wo.order.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {canManage && (
                <div className="row" style={{ marginTop: 10 }}>
                  {wave.status === "CREATED" && <button className="btn sm primary" onClick={() => actionMutation.mutate({ waveId: wave.id, action: "release" })}>Liberar onda</button>}
                  {wave.status === "RELEASED" && <button className="btn sm" onClick={() => actionMutation.mutate({ waveId: wave.id, action: "pause" })}>Pausar</button>}
                  {wave.status === "PAUSED" && <button className="btn sm" onClick={() => actionMutation.mutate({ waveId: wave.id, action: "resume" })}>Retomar</button>}
                  {wave.status === "RELEASED" && <button className="btn sm ghost" onClick={() => actionMutation.mutate({ waveId: wave.id, action: "complete" })}>Concluir</button>}
                  {["CREATED", "RELEASED", "PAUSED"].includes(wave.status) && <button className="btn sm danger" onClick={() => actionMutation.mutate({ waveId: wave.id, action: "cancel" })}>Cancelar</button>}
                </div>
              )}
            </div>
          ))}
          {(waves?.items.length ?? 0) === 0 && <div className="empty-state">Nenhuma onda criada.</div>}
        </div>
      )}

      {creating && (
        <Modal title="Nova Onda de Picking" onClose={() => setCreating(false)}>
          <div className="field"><label>Código</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="section-title" style={{ marginTop: 4 }}>Pedidos alocados disponíveis</div>
          <div className="stack" style={{ maxHeight: 260, overflowY: "auto" }}>
            {(allocatedOrders?.items ?? []).map((o) => (
              <label key={o.id} className="row" style={{ fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={selectedOrders.includes(o.id)}
                  onChange={(e) => setSelectedOrders(e.target.checked ? [...selectedOrders, o.id] : selectedOrders.filter((id) => id !== o.id))}
                />
                <span className="mono">{o.number}</span> — {o.customer?.name} <Badge value={o.priority} />
              </label>
            ))}
            {(allocatedOrders?.items.length ?? 0) === 0 && <p className="page-subtitle">Nenhum pedido alocado disponível no momento.</p>}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="btn primary" disabled={selectedOrders.length === 0 || createMutation.isPending} onClick={() => createMutation.mutate()}>Criar onda</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
