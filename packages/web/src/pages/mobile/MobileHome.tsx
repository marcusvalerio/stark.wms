import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Paginated, Task } from "@/api/types";
import { Loading } from "@/components/Loading";
import { Badge } from "@/components/Badge";
import { useAuth } from "@/auth/AuthContext";

const SUPPORTED_TYPES = ["PICKING", "PUTAWAY", "REPLENISHMENT"];

const TYPE_LABEL: Record<string, string> = { PICKING: "Separação", PUTAWAY: "Armazenagem (Put-away)", REPLENISHMENT: "Reabastecimento" };

export function MobileHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: mine, isLoading: l1 } = useQuery({
    queryKey: ["mobile-my-tasks"],
    queryFn: () => api.get<Paginated<Task>>(`/tasks/my?pageSize=50`),
    refetchInterval: 15_000,
  });
  const { data: pool, isLoading: l2 } = useQuery({
    queryKey: ["mobile-pool-tasks"],
    queryFn: () => api.get<Paginated<Task>>(`/tasks?status=PENDING&pageSize=100`),
    refetchInterval: 15_000,
  });

  if (l1 || l2) return <Loading label="Carregando tarefas..." />;

  const myTasks = (mine?.items ?? []).filter((t) => SUPPORTED_TYPES.includes(t.type) && t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const available = (pool?.items ?? []).filter((t) => SUPPORTED_TYPES.includes(t.type) && !t.assignedToId);

  return (
    <div>
      <h2 style={{ margin: "4px 0 2px" }}>Olá, {user?.name?.split(" ")[0]}</h2>
      <p className="page-subtitle" style={{ marginBottom: 18 }}>Tarefa → Endereço → Escanear → Produto → Quantidade → Confirmar</p>

      <div className="section-title" style={{ marginTop: 0 }}>Minhas tarefas ({myTasks.length})</div>
      {myTasks.length === 0 && <p className="page-subtitle">Nenhuma tarefa em andamento.</p>}
      {myTasks.map((t) => (
        <div className="mobile-card" key={t.id} onClick={() => navigate(`/mobile/task/${t.id}`)}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{TYPE_LABEL[t.type] ?? t.type}</strong>
            <Badge value={t.priority} />
          </div>
          <div className="page-subtitle" style={{ marginTop: 4 }}>{t.product?.sku} — {t.product?.description}</div>
          <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
            <span className="mono">{t.originLocation?.fullCode ?? t.destLocation?.fullCode ?? "-"}</span>
            <Badge value={t.status} />
          </div>
        </div>
      ))}

      <div className="section-title">Disponíveis para iniciar ({available.length})</div>
      {available.length === 0 && <p className="page-subtitle">Nenhuma tarefa disponível no momento.</p>}
      {available.map((t) => (
        <div className="mobile-card" key={t.id} onClick={() => navigate(`/mobile/task/${t.id}`)}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{TYPE_LABEL[t.type] ?? t.type}</strong>
            <Badge value={t.priority} />
          </div>
          <div className="page-subtitle" style={{ marginTop: 4 }}>{t.product?.sku} — {t.product?.description}</div>
          <span className="mono">{t.originLocation?.fullCode ?? t.destLocation?.fullCode ?? "-"}</span>
        </div>
      ))}
    </div>
  );
}
