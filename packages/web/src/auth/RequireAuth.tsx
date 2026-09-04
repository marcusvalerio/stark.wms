import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function RequirePermission({ codes, children }: { codes: string[]; children: React.ReactNode }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(...codes)) {
    return (
      <div className="empty-state">
        <p>Você não tem permissão para acessar esta área.</p>
      </div>
    );
  }
  return <>{children}</>;
}
