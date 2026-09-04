import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { ControlTower } from "@/api/types";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/Badge";

export function ControlTowerPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["control-tower"],
    queryFn: () => api.get<ControlTower>("/dashboard/control-tower"),
    refetchInterval: 20_000,
  });

  if (isLoading || !data) return <Loading label="Carregando control tower..." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Control Tower</h1>
          <p className="page-subtitle">Gargalos, atrasos e pontos de atenção operacional</p>
        </div>
      </div>

      {data.alerts.length > 0 && (
        <div className="stack" style={{ marginBottom: 18 }}>
          {data.alerts.map((a, i) => (
            <div key={i} className={`banner ${a.level === "CRITICAL" ? "danger" : a.level === "HIGH" ? "warn" : "info"}`}>{a.message}</div>
          ))}
        </div>
      )}

      <div className="field-row" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Tarefas atrasadas (SLA vencido)</div>
          {data.delayedTasks.length === 0 ? <p className="page-subtitle">Nenhuma tarefa atrasada.</p> : (
            <table className="data">
              <thead><tr><th>Tipo</th><th>Prioridade</th><th>SLA</th><th>Operador</th></tr></thead>
              <tbody>
                {data.delayedTasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.type}</td>
                    <td><Badge value={t.priority} /></td>
                    <td>{t.slaDueAt ? new Date(t.slaDueAt).toLocaleString("pt-BR") : "-"}</td>
                    <td>{t.assignedTo ?? "Não atribuído"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Docas ocupadas</div>
          {data.occupiedDocks.length === 0 ? <p className="page-subtitle">Nenhuma doca ocupada.</p> : (
            <table className="data">
              <thead><tr><th>Doca</th><th>Tipo</th><th>Recebimentos</th><th>Expedições</th></tr></thead>
              <tbody>
                {data.occupiedDocks.map((d) => (
                  <tr key={d.dockId}>
                    <td className="mono">{d.code}</td>
                    <td>{d.type}</td>
                    <td>{d.receipts.join(", ") || "-"}</td>
                    <td>{d.shipments.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="field-row" style={{ alignItems: "start", marginTop: 16 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Pedidos críticos</div>
          {data.criticalOrders.length === 0 ? <p className="page-subtitle">Nenhum pedido crítico em aberto.</p> : (
            <table className="data">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Prioridade</th><th>Status</th><th>SLA</th></tr></thead>
              <tbody>
                {data.criticalOrders.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/orders/${o.id}`} className="mono">{o.number}</Link></td>
                    <td>{o.customer}</td>
                    <td><Badge value={o.priority} /></td>
                    <td><Badge value={o.status} /></td>
                    <td>{o.slaDueAt ? new Date(o.slaDueAt).toLocaleString("pt-BR") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Operadores</div>
          <table className="data">
            <thead><tr><th>Nome</th><th>Turno</th><th>Status</th><th>Tarefas ativas</th></tr></thead>
            <tbody>
              {data.operators.map((op) => (
                <tr key={op.id}>
                  <td>{op.name}</td>
                  <td>{op.shift ?? "-"}</td>
                  <td><Badge value={op.status} /></td>
                  <td className="mono">{op.activeTasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
