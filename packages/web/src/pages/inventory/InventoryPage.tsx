import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/api/client";
import { InventoryBalance, Paginated } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/Badge";

export function InventoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/inventory/balances", page, search],
    queryFn: () => api.get<Paginated<InventoryBalance>>(`/inventory/balances${qs({ page, pageSize: 20, q: search })}`),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Estoque</h1>
          <p className="page-subtitle">Produto + quantidade + localização + status + lote/validade quando aplicável</p>
        </div>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por SKU ou descrição..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<InventoryBalance>
            columns={[
              { key: "sku", header: "SKU", render: (r) => <span className="mono">{r.product?.sku}</span> },
              { key: "desc", header: "Produto", render: (r) => r.product?.description },
              { key: "loc", header: "Endereço", render: (r) => <span className="mono">{r.location?.fullCode}</span> },
              { key: "type", header: "Tipo", render: (r) => <Badge value={r.location?.type ?? ""} /> },
              { key: "lot", header: "Lote", render: (r) => r.lot?.code ?? "-" },
              { key: "expiry", header: "Validade", render: (r) => (r.lot?.expiryDate ? new Date(r.lot.expiryDate).toLocaleDateString("pt-BR") : "-") },
              { key: "physical", header: "Físico", render: (r) => <span className="mono">{r.qtyPhysical}</span> },
              { key: "available", header: "Disponível", render: (r) => <span className="mono">{r.qtyAvailable}</span> },
              { key: "reserved", header: "Reservado", render: (r) => <span className="mono">{r.qtyReserved}</span> },
              { key: "blocked", header: "Bloqueado/Quarentena", render: (r) => <span className="mono">{r.qtyBlocked + r.qtyQuarantine}</span> },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
