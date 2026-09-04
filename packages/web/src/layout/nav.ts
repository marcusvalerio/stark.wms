export interface NavItem {
  label: string;
  path: string;
  permissions: string[];
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Operação",
    items: [
      { label: "Dashboard", path: "/", permissions: ["dashboard.read"] },
      { label: "Control Tower", path: "/control-tower", permissions: ["dashboard.read"] },
    ],
  },
  {
    label: "Armazém",
    items: [
      { label: "Mapa do Armazém", path: "/warehouse", permissions: ["warehouse.read", "warehouse.manage"] },
      { label: "Estoque", path: "/inventory", permissions: ["inventory.read", "inventory.adjust"] },
      { label: "Movimentações", path: "/inventory/movements", permissions: ["inventory.read", "inventory.adjust"] },
    ],
  },
  {
    label: "Recebimento",
    items: [
      { label: "Recebimentos", path: "/receiving", permissions: ["receiving.read", "receiving.manage", "receiving.check"] },
      { label: "Divergências", path: "/discrepancies", permissions: ["discrepancy.read"] },
      { label: "Qualidade", path: "/quality", permissions: ["quality.manage"] },
    ],
  },
  {
    label: "Pedidos & Separação",
    items: [
      { label: "Pedidos", path: "/orders", permissions: ["order.read", "order.manage"] },
      { label: "Ondas de Picking", path: "/waves", permissions: ["wave.manage"] },
      { label: "Reabastecimento", path: "/replenishment", permissions: ["task.read"] },
      { label: "Tarefas", path: "/tasks", permissions: ["task.read"] },
    ],
  },
  {
    label: "Inventário",
    items: [{ label: "Contagens", path: "/counts", permissions: ["count.read", "count.manage"] }],
  },
  {
    label: "Cadastros",
    items: [
      { label: "Produtos", path: "/catalog/products", permissions: ["master_data.read", "master_data.manage"] },
      { label: "Categorias", path: "/catalog/categories", permissions: ["master_data.read", "master_data.manage"] },
      { label: "Unidades de Medida", path: "/catalog/uoms", permissions: ["master_data.read", "master_data.manage"] },
      { label: "Fornecedores", path: "/partners/suppliers", permissions: ["master_data.read", "master_data.manage"] },
      { label: "Clientes", path: "/partners/customers", permissions: ["master_data.read", "master_data.manage"] },
      { label: "Transportadoras", path: "/partners/carriers", permissions: ["master_data.read", "master_data.manage"] },
    ],
  },
  {
    label: "Administração",
    items: [
      { label: "Usuários", path: "/users", permissions: ["users.manage"] },
      { label: "Relatórios", path: "/reports", permissions: ["reports.read"] },
      { label: "Auditoria", path: "/audit", permissions: ["audit.read"] },
    ],
  },
];
