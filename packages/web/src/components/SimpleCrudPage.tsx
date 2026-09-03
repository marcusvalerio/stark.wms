import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/api/client";
import { Paginated } from "@/api/types";
import { DataTable, Column, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/auth/AuthContext";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "checkbox" | "select" | "number";
  required?: boolean;
  options?: { value: string; label: string }[];
}

export function SimpleCrudPage<T extends { id: string }>({
  title,
  subtitle,
  apiPath,
  columns,
  fields,
  writePermission,
  defaultValues,
}: {
  title: string;
  subtitle: string;
  apiPath: string;
  columns: Column<T>[];
  fields: FieldDef[];
  writePermission: string;
  defaultValues?: Record<string, unknown>;
}) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(writePermission);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<T | null | "new">(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: [apiPath, page, search],
    queryFn: () => api.get<Paginated<T>>(`${apiPath}${qs({ page, pageSize: 15, q: search })}`),
  });

  function openNew() {
    setForm({ status: "ACTIVE", isBase: false, ...defaultValues });
    setFormError(null);
    setEditing("new");
  }
  function openEdit(row: T) {
    setForm({ ...row });
    setFormError(null);
    setEditing(row);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing === "new") return api.post(apiPath, form);
      return api.patch(`${apiPath}/${(editing as T).id}`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [apiPath] });
      setEditing(null);
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Falha ao salvar."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {canWrite && <button className="btn primary" onClick={openNew}>+ Novo</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      {error && <ErrorBanner message={error instanceof ApiError ? error.message : "Erro ao carregar."} />}
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <DataTable columns={canWrite ? [...columns, { key: "__edit", header: "", render: (row) => <button className="btn ghost sm" onClick={() => openEdit(row)}>Editar</button> }] : columns} rows={data?.items ?? []} />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {editing && (
        <Modal title={editing === "new" ? `Novo registro — ${title}` : `Editar — ${title}`} onClose={() => setEditing(null)}>
          {formError && <ErrorBanner message={formError} />}
          <div className="field-row">
            {fields.map((f) => (
              <div className="field" key={f.name}>
                <label>{f.label}{f.required ? " *" : ""}</label>
                {f.type === "checkbox" ? (
                  <input type="checkbox" checked={Boolean(form[f.name])} onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} style={{ width: 18, height: 18 }} />
                ) : f.type === "select" ? (
                  <select value={String(form[f.name] ?? "")} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    value={(form[f.name] as string | number | undefined) ?? ""}
                    required={f.required}
                    onChange={(e) => setForm({ ...form, [f.name]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
            <button className="btn primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
