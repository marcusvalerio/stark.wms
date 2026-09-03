import { SimpleCrudPage } from "@/components/SimpleCrudPage";
import { Carrier } from "@/api/types";
import { Badge } from "@/components/Badge";

export function CarriersPage() {
  return (
    <SimpleCrudPage<Carrier>
      title="Transportadoras"
      subtitle="Cadastro de transportadoras para expedição"
      apiPath="/partners/carriers"
      writePermission="master_data.manage"
      columns={[
        { key: "code", header: "Código", render: (r) => <span className="mono">{r.code}</span> },
        { key: "name", header: "Nome", render: (r) => r.name },
        { key: "document", header: "Documento", render: (r) => r.document },
        { key: "status", header: "Status", render: (r) => <Badge value={r.status} /> },
      ]}
      fields={[
        { name: "code", label: "Código", type: "text", required: true },
        { name: "name", label: "Nome", type: "text", required: true },
        { name: "document", label: "Documento", type: "text", required: true },
        { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Ativo" }, { value: "INACTIVE", label: "Inativo" }] },
      ]}
    />
  );
}
