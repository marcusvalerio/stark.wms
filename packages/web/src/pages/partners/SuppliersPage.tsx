import { SimpleCrudPage } from "@/components/SimpleCrudPage";
import { Supplier } from "@/api/types";
import { Badge } from "@/components/Badge";

export function SuppliersPage() {
  return (
    <SimpleCrudPage<Supplier>
      title="Fornecedores"
      subtitle="Cadastro de fornecedores para recebimento"
      apiPath="/partners/suppliers"
      writePermission="master_data.manage"
      columns={[
        { key: "code", header: "Código", render: (r) => <span className="mono">{r.code}</span> },
        { key: "legalName", header: "Razão social", render: (r) => r.legalName },
        { key: "cnpj", header: "CNPJ", render: (r) => r.cnpj },
        { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      ]}
      fields={[
        { name: "code", label: "Código", type: "text", required: true },
        { name: "legalName", label: "Razão social", type: "text", required: true },
        { name: "cnpj", label: "CNPJ", type: "text", required: true },
        { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Ativo" }, { value: "INACTIVE", label: "Inativo" }] },
      ]}
    />
  );
}
