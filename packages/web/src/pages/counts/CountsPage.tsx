import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/api/client";
import { InventoryCount, Location as Loc, Paginated } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export function CountsPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("count.manage");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState("CYCLE");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["/counts", page], queryFn: () => api.get<Paginated<InventoryCount>>(`/counts?page=${page}&pageSize=15`) });
  const { data: locations } = useQuery({ queryKey: ["/warehouse/locations", "all"], queryFn: () => api.get<Paginated<Loc>>("/warehouse/locations?pageSize=200"), enabled: creating });

  function openNew() {
    setCode(`INV-${Date.now().toString().slice(-6)}`);
    setType("CYCLE");
    setSelectedLocations([]);
    setError(null);
    setCreating(true);
  }

  const createMutation = useMutation({
    mutationFn: () => api.post<InventoryCount>("/counts", { code, type, locationIds: selectedLocations }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["/counts"] }); setCreating(false); navigate(`/counts/${res.id}`); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao criar contagem."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Contagens de Inventário</h1>
          <p className="page-subtitle">Geral, parcial ou cíclica — aberto → contagem → conferência → ajuste → finalizado</p>
        </div>
        {canManage && <button className="btn primary" onClick={openNew}>+ Nova Contagem</button>}
      </div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<InventoryCount>
            columns={[
              { key: "code", header: "Código", render: (r) => <span className="mono">{r.code}</span> },
              { key: "type", header: "Tipo", render: (r) => r.type },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              { key: "created", header: "Criado em", render: (r) => new Date(r.createdAt).toLocaleString("pt-BR") },
            ]}
            rows={data?.items ?? []}
            onRowClick={(r) => navigate(`/counts/${r.id}`)}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {creating && (
        <Modal title="Nova Contagem de Inventário" onClose={() => setCreating(false)}>
          {error && <ErrorBanner message={error} />}
          <div className="field-row">
            <div className="field"><label>Código</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <div className="field">
              <label>Tipo</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="GENERAL">Geral</option><option value="PARTIAL">Parcial</option><option value="CYCLE">Cíclica</option>
              </select>
            </div>
          </div>
          <div className="section-title" style={{ marginTop: 4 }}>Localizações a contar</div>
          <div className="stack" style={{ maxHeight: 240, overflowY: "auto" }}>
            {(locations?.items ?? []).map((l) => (
              <label key={l.id} className="row" style={{ fontSize: 12.5 }}>
                <input type="checkbox" checked={selectedLocations.includes(l.id)} onChange={(e) => setSelectedLocations(e.target.checked ? [...selectedLocations, l.id] : selectedLocations.filter((id) => id !== l.id))} />
                <span className="mono">{l.fullCode}</span> <Badge value={l.type} />
              </label>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="btn primary" disabled={selectedLocations.length === 0 || createMutation.isPending} onClick={() => createMutation.mutate()}>Criar contagem</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
