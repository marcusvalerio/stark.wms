import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { Location as Loc, Paginated, Task } from "@/api/types";
import { Loading, ErrorBanner } from "@/components/Loading";
import { Badge } from "@/components/Badge";

const TYPE_LABEL: Record<string, string> = { PICKING: "Separação", PUTAWAY: "Armazenagem", REPLENISHMENT: "Reabastecimento" };

type Step = "start" | "scan" | "qty" | "location" | "confirm" | "done";

export function MobileTaskPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("start");
  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [qty, setQty] = useState(0);
  const [destLocationId, setDestLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: task, isLoading } = useQuery({
    queryKey: ["mobile-task", id],
    queryFn: () => api.get<Task>(`/tasks/${id}`),
  });
  const { data: locations } = useQuery({
    queryKey: ["mobile-locations"],
    queryFn: () => api.get<Paginated<Loc>>("/warehouse/locations?pageSize=200"),
    enabled: task?.type === "PUTAWAY",
  });

  const startMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/start`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mobile-task", id] }); setStep("scan"); setQty(task?.qty ?? 1); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao iniciar tarefa."),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!task) return;
      if (task.type === "PICKING") return api.post(`/orders/picking-tasks/${task.refId}/pick`, { qtyPicked: qty });
      if (task.type === "PUTAWAY") return api.post(`/receiving/putaway-tasks/${task.id}/execute`, { destLocationId });
      if (task.type === "REPLENISHMENT") return api.post(`/replenishment/${task.refId}/execute`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mobile-my-tasks"] }); setStep("done"); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha ao concluir tarefa."),
  });

  if (isLoading || !task) return <Loading />;

  const expectedScan = task.type === "PUTAWAY" ? (task.product?.sku ?? "") : (task.originLocation?.fullCode ?? task.product?.sku ?? "");
  const alreadyRunning = task.status === "IN_PROGRESS" || task.status === "ASSIGNED";

  function checkScan() {
    if (scanValue.trim().toUpperCase() === expectedScan.toUpperCase()) {
      setScanError(null);
      setQty(task!.qty ?? 1);
      setStep(task!.type === "PUTAWAY" ? "location" : "qty");
    } else {
      setScanError("Código não confere. Verifique o endereço/produto e tente novamente.");
    }
  }

  return (
    <div>
      <button className="btn ghost sm" onClick={() => navigate("/mobile")} style={{ marginBottom: 12 }}>‹ Voltar</button>

      <div className="mobile-card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{TYPE_LABEL[task.type] ?? task.type}</strong>
          <Badge value={task.status} />
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="page-subtitle">Produto</div>
          <div className="mono" style={{ fontSize: 15 }}>{task.product?.sku} — {task.product?.description}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="page-subtitle">{task.type === "PUTAWAY" ? "Origem" : "Endereço"}</div>
          <div className="mono" style={{ fontSize: 15 }}>{task.originLocation?.fullCode ?? "Recebimento"}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="page-subtitle">Quantidade sugerida</div>
          <div className="mono" style={{ fontSize: 15 }}>{task.qty ?? "-"}</div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {step === "start" && (
        <button className="big-btn" disabled={startMutation.isPending} onClick={() => (alreadyRunning ? setStep("scan") : startMutation.mutate())}>
          {alreadyRunning ? "Continuar tarefa" : "Iniciar tarefa"}
        </button>
      )}

      {step === "scan" && (
        <>
          <div className="scan-box">
            📷 Aponte para o código de barras
            <div style={{ marginTop: 6, fontSize: 11 }}>ou digite manualmente abaixo</div>
          </div>
          <input className="big-input" placeholder={task.type === "PUTAWAY" ? "SKU do produto" : "Código do endereço"} value={scanValue} onChange={(e) => setScanValue(e.target.value)} />
          {scanError && <div className="field-hint" style={{ textAlign: "center", marginTop: 8 }}>{scanError}</div>}
          <button className="big-btn" style={{ marginTop: 14 }} onClick={checkScan}>Confirmar leitura</button>
        </>
      )}

      {step === "location" && task.type === "PUTAWAY" && (
        <>
          <div className="field"><label>Selecione o endereço de destino</label>
            <select value={destLocationId} onChange={(e) => setDestLocationId(e.target.value)}>
              <option value="">Selecione...</option>
              {(locations?.items ?? []).filter((l) => ["RESERVE", "PICKING"].includes(l.type)).map((l) => (
                <option key={l.id} value={l.id}>{l.fullCode} ({l.occupiedQty}/{l.capacityQty})</option>
              ))}
            </select>
          </div>
          <button className="big-btn" disabled={!destLocationId} onClick={() => setStep("confirm")}>Continuar</button>
        </>
      )}

      {step === "qty" && (
        <>
          <div className="page-subtitle" style={{ textAlign: "center", marginBottom: 8 }}>Quantidade separada</div>
          <input className="big-input" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          <button className="big-btn" style={{ marginTop: 14 }} disabled={qty <= 0} onClick={() => setStep("confirm")}>Continuar</button>
        </>
      )}

      {step === "confirm" && (
        <>
          <div className="mobile-card">
            <div className="row" style={{ justifyContent: "space-between" }}><span>Produto</span><strong className="mono">{task.product?.sku}</strong></div>
            {task.type !== "PUTAWAY" && <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}><span>Quantidade</span><strong className="mono">{qty}</strong></div>}
            {task.type === "PUTAWAY" && <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}><span>Destino</span><strong className="mono">{locations?.items.find((l) => l.id === destLocationId)?.fullCode}</strong></div>}
          </div>
          <button className="big-btn" disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>Concluir tarefa</button>
        </>
      )}

      {step === "done" && (
        <div className="mobile-card" style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 34 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 700, margin: "8px 0" }}>Tarefa concluída</div>
          <button className="big-btn" onClick={() => navigate("/mobile")}>Voltar para tarefas</button>
        </div>
      )}
    </div>
  );
}
