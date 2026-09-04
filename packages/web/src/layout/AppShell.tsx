import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { NAV } from "@/layout/nav";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador", MANAGER: "Gestor", SUPERVISOR: "Supervisor",
  OPERATOR: "Operador", CHECKER: "Conferente", SHIPPING: "Expedição",
};

export function AppShell() {
  const { user, logout, hasPermission } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">S</span>
          <span>
            STARK<span style={{ color: "var(--amber)" }}>.WMS</span>
            <div className="sub">Warehouse Management System</div>
          </span>
        </div>
        <div className="user-pill">
          <a href="/mobile" className="btn ghost sm">Coletor</a>
          <span>{user?.name}</span>
          <span className="role-badge">{ROLE_LABELS[user?.roleCode ?? ""] ?? user?.roleCode}</span>
          <button className="btn ghost sm" onClick={logout}>Sair</button>
        </div>
      </header>
      <nav className="sidebar">
        {NAV.map((group) => {
          const visibleItems = group.items.filter((item) => hasPermission(...item.permissions));
          if (visibleItems.length === 0) return null;
          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {visibleItems.map((item) => (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} end={item.path === "/"}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
