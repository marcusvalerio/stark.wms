const TONE_MAP: Record<string, string> = {
  // generic
  ACTIVE: "ok", INACTIVE: "neutral", COMPLETED: "ok", CANCELLED: "danger", CANCELED: "danger",
  // receipt / task / order-ish
  PENDING: "neutral", SCHEDULED: "neutral", ARRIVED: "info", AT_DOCK: "info", IN_CONFERENCE: "warn",
  CONFERRED: "info", PUTAWAY: "info", ASSIGNED: "info", IN_PROGRESS: "warn",
  RECEIVED: "neutral", RELEASED: "info", ALLOCATED: "info", PICKING: "warn", PICKED: "info",
  CONFERENCE: "warn", PACKING: "warn", STAGING: "warn", READY: "ok", SHIPPED: "ok",
  // discrepancy / quality / count
  OPEN: "danger", IN_REVIEW: "warn", RESOLVED: "ok", REJECTED: "danger", APPROVED: "ok",
  DISCREPANCY: "danger", RECOUNT: "warn", APPROVAL: "warn", ADJUSTMENT: "warn", COUNTING: "warn", REVIEW: "warn",
  DIVERGENT: "danger", CHECKED: "ok", PUT_AWAY: "ok",
  // wave
  CREATED: "neutral", PAUSED: "warn",
  // priority
  CRITICAL: "danger", HIGH: "warn", NORMAL: "neutral", LOW: "neutral",
  // operator
  AVAILABLE: "ok", BUSY: "warn", OFFLINE: "neutral",
};

const LABELS: Record<string, string> = {
  ACTIVE: "Ativo", INACTIVE: "Inativo",
  SCHEDULED: "Agendado", ARRIVED: "Chegou", AT_DOCK: "Na doca", IN_CONFERENCE: "Em conferência",
  CONFERRED: "Conferido", PUTAWAY: "Put-away", COMPLETED: "Concluído", CANCELLED: "Cancelado",
  PENDING: "Pendente", ASSIGNED: "Atribuída", IN_PROGRESS: "Em andamento",
  RECEIVED: "Recebido", RELEASED: "Liberado", ALLOCATED: "Alocado", PICKING: "Separando",
  PICKED: "Separado", CONFERENCE: "Conferência", PACKING: "Embalagem", STAGING: "Staging",
  READY: "Pronto", SHIPPED: "Expedido",
  OPEN: "Aberta", IN_REVIEW: "Em análise", RESOLVED: "Resolvida", REJECTED: "Reprovado", APPROVED: "Aprovado",
  DISCREPANCY: "Divergência", RECOUNT: "Recontagem", APPROVAL: "Aprovação", ADJUSTMENT: "Ajuste",
  COUNTING: "Contando", REVIEW: "Revisão", DIVERGENT: "Divergente", CHECKED: "Conferido", PUT_AWAY: "Armazenado",
  CREATED: "Criada", PAUSED: "Pausada",
  CRITICAL: "Crítica", HIGH: "Alta", NORMAL: "Normal", LOW: "Baixa",
  AVAILABLE: "Disponível", BUSY: "Ocupado", OFFLINE: "Offline",
};

export function Badge({ value }: { value: string }) {
  const tone = TONE_MAP[value] ?? "neutral";
  const label = LABELS[value] ?? value;
  return <span className={`badge ${tone}`}>{label}</span>;
}
