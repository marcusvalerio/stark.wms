// Central catalog of permission codes. Every module declares the permission
// it needs at the route level via requirePermission(); the seed script maps
// these codes onto roles so authorization stays data-driven instead of
// hard-coded per role.

export const PERMISSIONS = {
  USERS_MANAGE: "users.manage",
  ROLES_READ: "roles.read",

  MASTER_DATA_READ: "master_data.read",
  MASTER_DATA_MANAGE: "master_data.manage",

  WAREHOUSE_READ: "warehouse.read",
  WAREHOUSE_MANAGE: "warehouse.manage",

  INVENTORY_READ: "inventory.read",
  INVENTORY_ADJUST: "inventory.adjust",

  RECEIVING_READ: "receiving.read",
  RECEIVING_MANAGE: "receiving.manage",
  RECEIVING_CHECK: "receiving.check",

  DISCREPANCY_READ: "discrepancy.read",
  DISCREPANCY_MANAGE: "discrepancy.manage",
  DISCREPANCY_RESOLVE: "discrepancy.resolve",

  TASK_READ: "task.read",
  TASK_ASSIGN: "task.assign",
  TASK_EXECUTE: "task.execute",

  ORDER_READ: "order.read",
  ORDER_MANAGE: "order.manage",
  ORDER_RELEASE: "order.release",

  WAVE_MANAGE: "wave.manage",

  QUALITY_MANAGE: "quality.manage",

  COUNT_READ: "count.read",
  COUNT_MANAGE: "count.manage",
  COUNT_APPROVE: "count.approve",

  PACKING_MANAGE: "packing.manage",
  SHIPPING_MANAGE: "shipping.manage",

  AUDIT_READ: "audit.read",
  REPORTS_READ: "reports.read",
  DASHBOARD_READ: "dashboard.read",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: { code: PermissionCode; description: string }[] = [
  { code: PERMISSIONS.USERS_MANAGE, description: "Gerenciar usuários e permissões" },
  { code: PERMISSIONS.ROLES_READ, description: "Consultar perfis e permissões" },
  { code: PERMISSIONS.MASTER_DATA_READ, description: "Consultar cadastros (produtos, parceiros, UOM)" },
  { code: PERMISSIONS.MASTER_DATA_MANAGE, description: "Gerenciar cadastros (produtos, parceiros, UOM)" },
  { code: PERMISSIONS.WAREHOUSE_READ, description: "Consultar estrutura do armazém" },
  { code: PERMISSIONS.WAREHOUSE_MANAGE, description: "Gerenciar estrutura do armazém" },
  { code: PERMISSIONS.INVENTORY_READ, description: "Consultar estoque" },
  { code: PERMISSIONS.INVENTORY_ADJUST, description: "Ajustar estoque manualmente" },
  { code: PERMISSIONS.RECEIVING_READ, description: "Consultar recebimentos" },
  { code: PERMISSIONS.RECEIVING_MANAGE, description: "Gerenciar recebimentos (agendar, atribuir doca)" },
  { code: PERMISSIONS.RECEIVING_CHECK, description: "Executar conferência de recebimento" },
  { code: PERMISSIONS.DISCREPANCY_READ, description: "Consultar divergências" },
  { code: PERMISSIONS.DISCREPANCY_MANAGE, description: "Registrar divergências" },
  { code: PERMISSIONS.DISCREPANCY_RESOLVE, description: "Resolver/cancelar divergências" },
  { code: PERMISSIONS.TASK_READ, description: "Consultar tarefas" },
  { code: PERMISSIONS.TASK_ASSIGN, description: "Atribuir/priorizar tarefas" },
  { code: PERMISSIONS.TASK_EXECUTE, description: "Executar tarefas operacionais" },
  { code: PERMISSIONS.ORDER_READ, description: "Consultar pedidos" },
  { code: PERMISSIONS.ORDER_MANAGE, description: "Gerenciar pedidos" },
  { code: PERMISSIONS.ORDER_RELEASE, description: "Liberar pedidos para separação" },
  { code: PERMISSIONS.WAVE_MANAGE, description: "Gerenciar ondas de picking" },
  { code: PERMISSIONS.QUALITY_MANAGE, description: "Gerenciar inspeções de qualidade" },
  { code: PERMISSIONS.COUNT_READ, description: "Consultar inventários" },
  { code: PERMISSIONS.COUNT_MANAGE, description: "Executar contagens de inventário" },
  { code: PERMISSIONS.COUNT_APPROVE, description: "Aprovar ajustes de inventário" },
  { code: PERMISSIONS.PACKING_MANAGE, description: "Gerenciar packing/volumes" },
  { code: PERMISSIONS.SHIPPING_MANAGE, description: "Gerenciar expedição" },
  { code: PERMISSIONS.AUDIT_READ, description: "Consultar trilha de auditoria" },
  { code: PERMISSIONS.REPORTS_READ, description: "Consultar relatórios" },
  { code: PERMISSIONS.DASHBOARD_READ, description: "Consultar dashboard e control tower" },
];

export const ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  ADMIN: ALL_PERMISSIONS.map((p) => p.code),
  MANAGER: ALL_PERMISSIONS.map((p) => p.code).filter((c) => c !== PERMISSIONS.USERS_MANAGE),
  SUPERVISOR: [
    PERMISSIONS.ROLES_READ,
    PERMISSIONS.MASTER_DATA_READ,
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.WAREHOUSE_MANAGE,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_ADJUST,
    PERMISSIONS.RECEIVING_READ,
    PERMISSIONS.RECEIVING_MANAGE,
    PERMISSIONS.DISCREPANCY_READ,
    PERMISSIONS.DISCREPANCY_MANAGE,
    PERMISSIONS.DISCREPANCY_RESOLVE,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_ASSIGN,
    PERMISSIONS.TASK_EXECUTE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_MANAGE,
    PERMISSIONS.ORDER_RELEASE,
    PERMISSIONS.WAVE_MANAGE,
    PERMISSIONS.QUALITY_MANAGE,
    PERMISSIONS.COUNT_READ,
    PERMISSIONS.COUNT_MANAGE,
    PERMISSIONS.COUNT_APPROVE,
    PERMISSIONS.PACKING_MANAGE,
    PERMISSIONS.SHIPPING_MANAGE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DASHBOARD_READ,
  ],
  OPERATOR: [
    PERMISSIONS.MASTER_DATA_READ,
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.RECEIVING_READ,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_EXECUTE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.COUNT_READ,
    PERMISSIONS.COUNT_MANAGE,
    PERMISSIONS.DASHBOARD_READ,
  ],
  CHECKER: [
    PERMISSIONS.MASTER_DATA_READ,
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.RECEIVING_READ,
    PERMISSIONS.RECEIVING_CHECK,
    PERMISSIONS.DISCREPANCY_READ,
    PERMISSIONS.DISCREPANCY_MANAGE,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_EXECUTE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.QUALITY_MANAGE,
    PERMISSIONS.DASHBOARD_READ,
  ],
  SHIPPING: [
    PERMISSIONS.MASTER_DATA_READ,
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_EXECUTE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.PACKING_MANAGE,
    PERMISSIONS.SHIPPING_MANAGE,
    PERMISSIONS.DASHBOARD_READ,
  ],
};
