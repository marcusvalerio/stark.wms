import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/api/client";
import { Movement, Paginated } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/Badge";

export function MovementsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/inventory/movements", page, type],
    queryFn: () => api.get<Paginated<Movement>>(`/inventory/movements${qs({ page, pageSize: 25, type })}`),
  });

  const types = ["RECEIPT", "PUTAWAY", "PICK", "REPLENISH", "TRANSFER", "ADJUST", "BLOCK", "UNBLOCK", "QUARANTINE", "RELEASE", "SHIP", "COUNT_ADJUST"];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Movimentações</h1>
          <p className="page-subtitle">Histórico completo de movimentações de estoque</p>
        </div>
      </div>

      <div className="toolbar">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Todos os tipos</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<Movement>
            columns={[
              { key: "date", header: "Data/Hora", render: (r) => new Date(r.createdAt).toLocaleString("pt-BR") },
              { key: "type", header: "Tipo", render: (r) => <Badge value={r.type} /> },
              { key: "sku", header: "SKU", render: (r) => <span className="mono">{r.product?.sku}</span> },
              { key: "product", header: "Produto", render: (r) => r.product?.description },
              { key: "qty", header: "Qtd", render: (r) => <span className="mono">{r.qty}</span> },
              { key: "from", header: "Origem", render: (r) => <span className="mono">{r.fromLocation?.fullCode ?? "-"}</span> },
              { key: "to", header: "Destino", render: (r) => <span className="mono">{r.toLocation?.fullCode ?? "-"}</span> },
              { key: "user", header: "Usuário", render: (r) => r.user?.name ?? "-" },
              { key: "reason", header: "Motivo", render: (r) => r.reason ?? "-" },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
