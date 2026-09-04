import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/Badge";

interface OccupancyRow { zoneId: string; warehouse: string; code: string; name: string; type: string; locations: number; capacity: number; occupied: number; occupancyPct: number; }
interface AccuracyReport { countedItems: number; accurateItems: number; accuracyPct: number; }
interface ProductivityRow { id: string; name: string; matricula: string; tasksCompleted: number; }
interface DiscrepancyRow { type: string; status: string; count: number; }

export function ReportsPage() {
  const { data: occupancy, isLoading: l1 } = useQuery({ queryKey: ["/reports/occupancy"], queryFn: () => api.get<OccupancyRow[]>("/reports/occupancy") });
  const { data: accuracy, isLoading: l2 } = useQuery({ queryKey: ["/reports/accuracy"], queryFn: () => api.get<AccuracyReport>("/reports/accuracy") });
  const { data: productivity, isLoading: l3 } = useQuery({ queryKey: ["/reports/productivity"], queryFn: () => api.get<ProductivityRow[]>("/reports/productivity") });
  const { data: discrepancies, isLoading: l4 } = useQuery({ queryKey: ["/reports/discrepancies"], queryFn: () => api.get<DiscrepancyRow[]>("/reports/discrepancies") });

  if (l1 || l2 || l3 || l4) return <Loading label="Carregando relatórios..." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-subtitle">Ocupação, acuracidade de inventário, produtividade e divergências</p>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card"><div className="kpi-label">Acuracidade de Inventário</div><div className="kpi-value ok">{accuracy?.accuracyPct ?? 0}%</div></div>
        <div className="kpi-card"><div className="kpi-label">Itens contados</div><div className="kpi-value">{accuracy?.countedItems ?? 0}</div></div>
        <div className="kpi-card"><div className="kpi-label">Itens corretos</div><div className="kpi-value">{accuracy?.accurateItems ?? 0}</div></div>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Ocupação por área</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Área</th><th>Nome</th><th>Tipo</th><th>Posições</th><th>Capacidade</th><th>Ocupado</th><th>%</th></tr></thead>
          <tbody>
            {(occupancy ?? []).map((z) => (
              <tr key={z.zoneId}>
                <td className="mono">{z.code}</td><td>{z.name}</td><td><Badge value={z.type} /></td>
                <td className="mono">{z.locations}</td><td className="mono">{z.capacity}</td><td className="mono">{z.occupied}</td>
                <td className="mono">{z.occupancyPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Produtividade por operador</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Matrícula</th><th>Nome</th><th>Tarefas concluídas</th></tr></thead>
          <tbody>
            {(productivity ?? []).map((p) => (
              <tr key={p.id}><td className="mono">{p.matricula}</td><td>{p.name}</td><td className="mono">{p.tasksCompleted}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Divergências por tipo</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Tipo</th><th>Status</th><th>Quantidade</th></tr></thead>
          <tbody>
            {(discrepancies ?? []).map((d, i) => (
              <tr key={i}><td><Badge value={d.type} /></td><td><Badge value={d.status} /></td><td className="mono">{d.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
