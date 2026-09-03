import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { Warehouse } from "@/api/types";

interface MapLocation {
  id: string; fullCode: string; type: string; status: string; capacityQty: number; occupiedQty: number; occupancyPct: number;
  aisle: string; rack: string; level: string; position: string;
}
interface MapZone { id: string; code: string; name: string; type: string; locations: MapLocation[]; }
interface WarehouseMap { id: string; code: string; name: string; zones: MapZone[]; }

interface LocationDetail {
  id: string; fullCode: string; type: string; status: string; capacityQty: number; occupiedQty: number;
  maxWeightKg: number; maxVolumeM3: number; pickingMin?: number | null; pickingMax?: number | null;
  zone: { name: string; warehouse: { name: string } };
  balances: { id: string; qtyPhysical: number; qtyAvailable: number; qtyReserved: number; qtyBlocked: number; qtyQuarantine: number; product: { sku: string; description: string }; lot?: { code: string; expiryDate?: string | null } | null }[];
  openTasks: { id: string; type: string; status: string }[];
}

function occupancyColor(pct: number) {
  if (pct === 0) return "var(--ink-800)";
  if (pct < 60) return "rgba(63,166,108,0.35)";
  if (pct < 85) return "rgba(217,165,32,0.4)";
  return "rgba(217,85,63,0.45)";
}

export function WarehousePage() {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const { data: warehouses } = useQuery({ queryKey: ["/warehouse/warehouses"], queryFn: () => api.get<Warehouse[]>("/warehouse/warehouses") });
  const warehouseId = warehouses?.[0]?.id;

  const { data: map, isLoading } = useQuery({
    queryKey: ["/warehouse/map", warehouseId],
    queryFn: () => api.get<WarehouseMap>(`/warehouse/warehouses/${warehouseId}/map`),
    enabled: Boolean(warehouseId),
  });

  const { data: detail } = useQuery({
    queryKey: ["/warehouse/locations", selectedLocationId],
    queryFn: () => api.get<LocationDetail>(`/warehouse/locations/${selectedLocationId}`),
    enabled: Boolean(selectedLocationId),
  });

  if (isLoading || !map) return <Loading label="Carregando mapa do armazém..." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mapa do Armazém — {map.name}</h1>
          <p className="page-subtitle">Áreas, ruas, posições e ocupação em tempo real · clique em uma posição para ver detalhes</p>
        </div>
      </div>

      <div className="row" style={{ gap: 14, marginBottom: 16, fontSize: 11.5, color: "var(--ink-400)" }}>
        <span className="row" style={{ gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: occupancyColor(0), display: "inline-block" }} /> Vazio</span>
        <span className="row" style={{ gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: occupancyColor(30), display: "inline-block" }} /> {"<"}60%</span>
        <span className="row" style={{ gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: occupancyColor(70), display: "inline-block" }} /> 60–85%</span>
        <span className="row" style={{ gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: occupancyColor(90), display: "inline-block" }} /> {">"}85%</span>
      </div>

      <div className="loc-map">
        {map.zones.map((zone) => (
          <div className="loc-zone" key={zone.id}>
            <div className="loc-zone-head">
              <strong>{zone.code} — {zone.name}</strong>
              <Badge value={zone.type} />
              <span className="page-subtitle">{zone.locations.length} posições</span>
            </div>
            <div className="loc-grid">
              {zone.locations.map((loc) => (
                <div key={loc.id} className="loc-cell" style={{ background: occupancyColor(loc.occupancyPct), opacity: loc.status === "ACTIVE" ? 1 : 0.4 }} title={`${loc.fullCode} · ${loc.occupancyPct}%`} onClick={() => setSelectedLocationId(loc.id)}>
                  {loc.aisle}-{loc.rack}-{loc.level}-{loc.position}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedLocationId && detail && (
        <Modal title={`Posição ${detail.fullCode}`} onClose={() => setSelectedLocationId(null)} width={640}>
          <div className="field-row" style={{ marginBottom: 14 }}>
            <div className="card"><div className="kpi-label">Tipo</div><Badge value={detail.type} /></div>
            <div className="card"><div className="kpi-label">Status</div><Badge value={detail.status} /></div>
            <div className="card"><div className="kpi-label">Ocupação</div><div className="mono">{detail.occupiedQty} / {detail.capacityQty}</div></div>
            <div className="card"><div className="kpi-label">Capacidade peso/volume</div><div className="mono">{detail.maxWeightKg}kg / {detail.maxVolumeM3}m³</div></div>
          </div>

          <div className="section-title" style={{ marginTop: 0 }}>Estoque na posição</div>
          {detail.balances.length === 0 ? <p className="page-subtitle">Sem estoque nesta posição.</p> : (
            <table className="data">
              <thead><tr><th>SKU</th><th>Produto</th><th>Lote</th><th>Físico</th><th>Disponível</th><th>Reservado</th><th>Bloqueado</th></tr></thead>
              <tbody>
                {detail.balances.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.product.sku}</td>
                    <td>{b.product.description}</td>
                    <td className="mono">{b.lot?.code ?? "-"}</td>
                    <td className="mono">{b.qtyPhysical}</td>
                    <td className="mono">{b.qtyAvailable}</td>
                    <td className="mono">{b.qtyReserved}</td>
                    <td className="mono">{b.qtyBlocked + b.qtyQuarantine}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-title">Tarefas em aberto</div>
          {detail.openTasks.length === 0 ? <p className="page-subtitle">Nenhuma tarefa em aberto para esta posição.</p> : (
            <div className="stack">
              {detail.openTasks.map((t) => (
                <div key={t.id} className="row"><Badge value={t.type} /><Badge value={t.status} /></div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
