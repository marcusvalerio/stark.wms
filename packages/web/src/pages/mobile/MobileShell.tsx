import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export function MobileShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="mobile-shell">
      <div className="mobile-topbar">
        <div className="row" style={{ gap: 8 }} onClick={() => navigate("/mobile")}>
          <span className="mark" style={{ width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg, var(--amber), var(--amber-strong))", display: "flex", alignItems: "center", justifyContent: "center", color: "#241300", fontWeight: 800, fontSize: 13 }}>S</span>
          <strong style={{ letterSpacing: "0.04em" }}>STARK<span style={{ color: "var(--amber)" }}>.WMS</span></strong>
        </div>
        <div className="row" style={{ gap: 8, fontSize: 12 }}>
          <span>{user?.name?.split(" ")[0]}</span>
          <button className="btn ghost sm" onClick={() => { logout(); navigate("/login"); }}>Sair</button>
        </div>
      </div>
      <div className="mobile-body">
        <Outlet />
      </div>
    </div>
  );
}
