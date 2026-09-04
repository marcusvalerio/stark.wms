import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/api/client";

export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("admin@starkwms.com");
  const [password, setPassword] = useState("stark@123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink-950)" }}>
      <div className="card" style={{ width: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <span className="mark" style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg, var(--amber), var(--amber-strong))", display: "flex", alignItems: "center", justifyContent: "center", color: "#241300", fontWeight: 800 }}>S</span>
          <div>
            <div style={{ fontWeight: 700, letterSpacing: "0.06em" }}>STARK<span style={{ color: "var(--amber)" }}>.WMS</span></div>
            <div style={{ fontSize: 11, color: "var(--ink-400)" }}>Warehouse Management System</div>
          </div>
        </div>
        {error && <div className="banner danger">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <p style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 18 }}>
          Demo: admin@starkwms.com · supervisor@starkwms.com · diego.souza@starkwms.com (senha stark@123)
        </p>
      </div>
    </div>
  );
}
