import { SimpleCrudPage } from "@/components/SimpleCrudPage";
import { Category } from "@/api/types";
import { Badge } from "@/components/Badge";

export function CategoriesPage() {
  return (
    <SimpleCrudPage<Category>
      title="Categorias"
      subtitle="Classificação de produtos"
      apiPath="/catalog/categories"
      writePermission="master_data.manage"
      columns={[
        { key: "code", header: "Código", render: (r) => <span className="mono">{r.code}</span> },
        { key: "name", header: "Nome", render: (r) => r.name },
        { key: "description", header: "Descrição", render: (r) => r.description ?? "-" },
        { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      ]}
      fields={[
        { name: "code", label: "Código", type: "text", required: true },
        { name: "name", label: "Nome", type: "text", required: true },
        { name: "description", label: "Descrição", type: "text" },
        { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Ativo" }, { value: "INACTIVE", label: "Inativo" }] },
      ]}
    />
  );
}
