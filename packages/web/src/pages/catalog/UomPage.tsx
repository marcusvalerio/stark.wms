import { SimpleCrudPage } from "@/components/SimpleCrudPage";
import { UnitOfMeasure } from "@/api/types";

export function UomPage() {
  return (
    <SimpleCrudPage<UnitOfMeasure>
      title="Unidades de Medida"
      subtitle="Unidade, caixa, pacote, pallet e conversões"
      apiPath="/catalog/uoms"
      writePermission="master_data.manage"
      columns={[
        { key: "code", header: "Código", render: (r) => <span className="mono">{r.code}</span> },
        { key: "name", header: "Nome", render: (r) => r.name },
        { key: "isBase", header: "Unidade base", render: (r) => (r.isBase ? "Sim" : "Não") },
      ]}
      fields={[
        { name: "code", label: "Código", type: "text", required: true },
        { name: "name", label: "Nome", type: "text", required: true },
        { name: "isBase", label: "Unidade base", type: "checkbox" },
      ]}
    />
  );
}
