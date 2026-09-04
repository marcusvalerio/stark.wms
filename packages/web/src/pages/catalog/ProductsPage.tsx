import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/api/client";
import { Category, Paginated, Product, UnitOfMeasure } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

const emptyForm = {
  sku: "", internalCode: "", barcode: "", description: "", categoryId: "", baseUomId: "",
  weightKg: 0, lengthCm: 0, widthCm: 0, heightCm: 0, type: "STANDARD",
  lotControl: false, expiryControl: false, serialControl: false, minStock: 0, maxStock: 0, status: "ACTIVE",
};

export function ProductsPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("master_data.manage");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["/catalog/products", page, search],
    queryFn: () => api.get<Paginated<Product>>(`/catalog/products${qs({ page, pageSize: 15, q: search })}`),
  });
  const { data: categories } = useQuery({ queryKey: ["/catalog/categories", "all"], queryFn: () => api.get<Paginated<Category>>("/catalog/categories?pageSize=100") });
  const { data: uoms } = useQuery({ queryKey: ["/catalog/uoms", "all"], queryFn: () => api.get<Paginated<UnitOfMeasure>>("/catalog/uoms?pageSize=100") });

  function openNew() {
    setForm({ ...emptyForm, categoryId: categories?.items[0]?.id ?? "", baseUomId: uoms?.items.find((u) => u.isBase)?.id ?? uoms?.items[0]?.id ?? "" });
    setFormError(null);
    setEditing("new");
  }
  function openEdit(row: Product) {
    setForm({
      sku: row.sku, internalCode: row.internalCode, barcode: row.barcode ?? "", description: row.description,
      categoryId: row.categoryId, baseUomId: row.baseUomId, weightKg: row.weightKg, lengthCm: row.lengthCm,
      widthCm: row.widthCm, heightCm: row.heightCm, type: row.type, lotControl: row.lotControl,
      expiryControl: row.expiryControl, serialControl: row.serialControl, minStock: row.minStock, maxStock: row.maxStock, status: row.status,
    });
    setFormError(null);
    setEditing(row);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing === "new") return api.post("/catalog/products", form);
      return api.patch(`/catalog/products/${(editing as Product).id}`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/catalog/products"] });
      setEditing(null);
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Falha ao salvar."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Produtos</h1>
          <p className="page-subtitle">SKU, código de barras, controle de lote/validade/série, estoque mínimo/máximo</p>
        </div>
        {canWrite && <button className="btn primary" onClick={openNew}>+ Novo Produto</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por SKU, código ou descrição..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {error && <ErrorBanner message={error instanceof ApiError ? error.message : "Erro ao carregar."} />}
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <DataTable
            columns={[
              { key: "sku", header: "SKU", render: (r) => <span className="mono">{r.sku}</span> },
              { key: "description", header: "Descrição", render: (r) => r.description },
              { key: "category", header: "Categoria", render: (r) => r.category?.name ?? "-" },
              { key: "controls", header: "Controles", render: (r) => (
                <span className="row" style={{ gap: 4 }}>
                  {r.lotControl && <span className="badge info">Lote</span>}
                  {r.expiryControl && <span className="badge warn">Validade</span>}
                  {r.serialControl && <span className="badge neutral">Série</span>}
                </span>
              ) },
              { key: "minmax", header: "Mín / Máx", render: (r) => <span className="mono">{r.minStock} / {r.maxStock}</span> },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              ...(canWrite ? [{ key: "__edit", header: "", render: (r: Product) => <button className="btn ghost sm" onClick={() => openEdit(r)}>Editar</button> }] : []),
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {editing && (
        <Modal title={editing === "new" ? "Novo Produto" : `Editar — ${(editing as Product).sku}`} onClose={() => setEditing(null)} width={720}>
          {formError && <ErrorBanner message={formError} />}
          <div className="field-row">
            <div className="field"><label>SKU *</label><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div className="field"><label>Código interno *</label><input value={form.internalCode} onChange={(e) => setForm({ ...form, internalCode: e.target.value })} /></div>
            <div className="field"><label>Código de barras</label><input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
          </div>
          <div className="field"><label>Descrição *</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="field-row">
            <div className="field">
              <label>Categoria *</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                {categories?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Unidade base *</label>
              <select value={form.baseUomId} onChange={(e) => setForm({ ...form, baseUomId: e.target.value })}>
                {uoms?.items.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {["STANDARD", "KIT", "BULK", "FRAGILE", "PERISHABLE"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="field-row">
            <div className="field"><label>Peso (kg)</label><input type="number" step="0.01" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: Number(e.target.value) })} /></div>
            <div className="field"><label>Comprimento (cm)</label><input type="number" value={form.lengthCm} onChange={(e) => setForm({ ...form, lengthCm: Number(e.target.value) })} /></div>
            <div className="field"><label>Largura (cm)</label><input type="number" value={form.widthCm} onChange={(e) => setForm({ ...form, widthCm: Number(e.target.value) })} /></div>
            <div className="field"><label>Altura (cm)</label><input type="number" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: Number(e.target.value) })} /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Estoque mínimo</label><input type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} /></div>
            <div className="field"><label>Estoque máximo</label><input type="number" value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: Number(e.target.value) })} /></div>
            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ gap: 18, marginTop: 4, marginBottom: 14 }}>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={form.lotControl} onChange={(e) => setForm({ ...form, lotControl: e.target.checked })} /> Controle de lote</label>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={form.expiryControl} onChange={(e) => setForm({ ...form, expiryControl: e.target.checked })} /> Controle de validade</label>
            <label className="row" style={{ gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={form.serialControl} onChange={(e) => setForm({ ...form, serialControl: e.target.checked })} /> Controle de série</label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
            <button className="btn primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{saveMutation.isPending ? "Salvando..." : "Salvar"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
