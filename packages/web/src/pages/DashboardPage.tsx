import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { DashboardSnapshot } from "@/api/types";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/Badge";

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-snapshot"],
    queryFn: () => api.get<DashboardSnapshot>("/dashboard/snapshot"),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <Loading label="Carregando operação..." />;

  const totalOrders = Object.values(data.orders).reduce((a, b) => a + b, 0);
  const totalTasksPending = data.tasks.filter((t) => ["PENDING", "ASSIGNED", "IN_PROGRESS"].includes(t.status)).reduce((a, b) => a + b.count, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Operação Agora</h1>
          <p className="page-subtitle">Visão em tempo real do centro de distribuição · atualizado {new Date(data.generatedAt).toLocaleTimeString("pt-BR")}</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Ocupação do Armazém</div>
          <div className={`kpi-value ${data.warehouseOccupancyPct > 85 ? "danger" : "amber"}`}>{data.warehouseOccupancyPct}%</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pedidos em Aberto</div>
          <div className="kpi-value">{totalOrders - (data.orders.SHIPPED ?? 0) - (data.orders.CANCELLED ?? 0)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Tarefas Pendentes</div>
          <div className="kpi-value">{totalTasksPending}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Divergências Abertas</div>
          <div className={`kpi-value ${data.discrepanciesOpen > 0 ? "danger" : "ok"}`}>{data.discrepanciesOpen}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Inventários em Curso</div>
          <div className="kpi-value">{data.countsInProgress}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Expedições Hoje</div>
          <div className="kpi-value ok">{data.shipmentsToday}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Produtos Abaixo do Mínimo</div>
          <div className={`kpi-value ${data.productsBelowMinimum > 0 ? "danger" : "ok"}`}>{data.productsBelowMinimum}</div>
        </div>
      </div>

      <div className="section-title">Recebimento por status</div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {Object.entries(data.receiving).map(([status, count]) => (
          <div key={status} className="card" style={{ minWidth: 140 }}>
            <Badge value={status} />
            <div className="kpi-value" style={{ fontSize: 20, marginTop: 8 }}>{count}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Pedidos por status</div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {Object.entries(data.orders).map(([status, count]) => (
          <div key={status} className="card" style={{ minWidth: 140 }}>
            <Badge value={status} />
            <div className="kpi-value" style={{ fontSize: 20, marginTop: 8 }}>{count}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Tarefas por tipo / status</div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Tipo</th><th>Status</th><th>Quantidade</th></tr>
          </thead>
          <tbody>
            {data.tasks.map((t, i) => (
              <tr key={i}>
                <td>{t.type}</td>
                <td><Badge value={t.status} /></td>
                <td className="mono">{t.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
