import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/api/client";
import { AuditLog, Paginated } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading } from "@/components/Loading";

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/audit", page, entityType],
    queryFn: () => api.get<Paginated<AuditLog>>(`/audit${qs({ page, pageSize: 25, entityType })}`),
  });

  const entityTypes = ["User", "Product", "Category", "Supplier", "Customer", "Carrier", "Warehouse", "Zone", "Location", "Receipt", "ReceiptItem", "Discrepancy", "Order", "Task", "PickWave", "InventoryCount", "QualityInspection", "InventoryBalance", "Package", "Shipment", "ReplenishmentTask"];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Auditoria</h1>
          <p className="page-subtitle">Usuário, ação, data/hora, entidade, valor anterior e novo valor</p>
        </div>
      </div>

      <div className="toolbar">
        <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
          <option value="">Todas as entidades</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<AuditLog>
            columns={[
              { key: "date", header: "Data/Hora", render: (r) => new Date(r.createdAt).toLocaleString("pt-BR") },
              { key: "user", header: "Usuário", render: (r) => r.user?.name ?? "Sistema" },
              { key: "action", header: "Ação", render: (r) => r.action },
              { key: "entity", header: "Entidade", render: (r) => `${r.entityType} · ${r.entityId.slice(0, 10)}` },
              { key: "prev", header: "Valor anterior", render: (r) => <span className="mono" style={{ fontSize: 10.5 }}>{r.previousValue ? JSON.stringify(r.previousValue).slice(0, 60) : "-"}</span> },
              { key: "new", header: "Novo valor", render: (r) => <span className="mono" style={{ fontSize: 10.5 }}>{r.newValue ? JSON.stringify(r.newValue).slice(0, 60) : "-"}</span> },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
