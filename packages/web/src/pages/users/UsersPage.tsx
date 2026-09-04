import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/api/client";
import { Paginated, User } from "@/api/types";
import { DataTable, Pagination } from "@/components/DataTable";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";

const ROLES = ["ADMIN", "MANAGER", "SUPERVISOR", "OPERATOR", "CHECKER", "SHIPPING"];

export function UsersPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["/users", page, search], queryFn: () => api.get<Paginated<User>>(`/users${qs({ page, pageSize: 15, q: search })}`) });

  function openNew() {
    setForm({ matricula: "", name: "", email: "", password: "", roleCode: "OPERATOR", shift: "" });
    setError(null);
    setEditing("new");
  }
  function openEdit(u: User) {
    setForm({ name: u.name, email: u.email, roleCode: u.role, shift: u.shift ?? "", status: u.status, operatorStatus: u.operatorStatus });
    setError(null);
    setEditing(u);
  }

  const saveMutation = useMutation({
    mutationFn: () => (editing === "new" ? api.post("/users", form) : api.patch(`/users/${(editing as User).id}`, form)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/users"] }); setEditing(null); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao salvar."),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuários</h1>
          <p className="page-subtitle">Perfis, permissões, turnos e status operacional</p>
        </div>
        <button className="btn primary" onClick={openNew}>+ Novo Usuário</button>
      </div>

      <div className="toolbar"><input className="search" placeholder="Buscar..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>

      {isLoading ? <Loading /> : (
        <>
          <DataTable<User>
            columns={[
              { key: "matricula", header: "Matrícula", render: (r) => <span className="mono">{r.matricula}</span> },
              { key: "name", header: "Nome", render: (r) => r.name },
              { key: "email", header: "E-mail", render: (r) => r.email },
              { key: "role", header: "Perfil", render: (r) => r.roleName ?? r.role },
              { key: "shift", header: "Turno", render: (r) => r.shift ?? "-" },
              { key: "operatorStatus", header: "Status operacional", render: (r) => <Badge value={r.operatorStatus} /> },
              { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
              { key: "edit", header: "", render: (r) => <button className="btn ghost sm" onClick={() => openEdit(r)}>Editar</button> },
            ]}
            rows={data?.items ?? []}
          />
          {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} />}
        </>
      )}

      {editing && (
        <Modal title={editing === "new" ? "Novo Usuário" : `Editar — ${(editing as User).name}`} onClose={() => setEditing(null)}>
          {error && <ErrorBanner message={error} />}
          {editing === "new" && (
            <div className="field-row">
              <div className="field"><label>Matrícula *</label><input value={form.matricula as string} onChange={(e) => setForm({ ...form, matricula: e.target.value })} /></div>
            </div>
          )}
          <div className="field-row">
            <div className="field"><label>Nome *</label><input value={form.name as string} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>E-mail *</label><input value={form.email as string} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Perfil *</label>
              <select value={form.roleCode as string} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field"><label>Turno</label><input value={form.shift as string} onChange={(e) => setForm({ ...form, shift: e.target.value })} /></div>
            {editing === "new" && <div className="field"><label>Senha *</label><input type="password" value={form.password as string} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>}
            {editing !== "new" && (
              <div className="field">
                <label>Status</label>
                <select value={form.status as string} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option>
                </select>
              </div>
            )}
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
            <button className="btn primary" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
