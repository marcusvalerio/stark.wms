import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RequireAuth, RequirePermission } from "@/auth/RequireAuth";
import { AppShell } from "@/layout/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ControlTowerPage } from "@/pages/ControlTowerPage";
import { ProductsPage } from "@/pages/catalog/ProductsPage";
import { CategoriesPage } from "@/pages/catalog/CategoriesPage";
import { UomPage } from "@/pages/catalog/UomPage";
import { SuppliersPage } from "@/pages/partners/SuppliersPage";
import { CustomersPage } from "@/pages/partners/CustomersPage";
import { CarriersPage } from "@/pages/partners/CarriersPage";
import { WarehousePage } from "@/pages/warehouse/WarehousePage";
import { InventoryPage } from "@/pages/inventory/InventoryPage";
import { MovementsPage } from "@/pages/inventory/MovementsPage";
import { ReceivingListPage } from "@/pages/receiving/ReceivingListPage";
import { ReceivingDetailPage } from "@/pages/receiving/ReceivingDetailPage";
import { DiscrepanciesPage } from "@/pages/discrepancies/DiscrepanciesPage";
import { OrdersListPage } from "@/pages/orders/OrdersListPage";
import { OrderDetailPage } from "@/pages/orders/OrderDetailPage";
import { TasksPage } from "@/pages/tasks/TasksPage";
import { WavesPage } from "@/pages/waves/WavesPage";
import { ReplenishmentPage } from "@/pages/replenishment/ReplenishmentPage";
import { CountsPage } from "@/pages/counts/CountsPage";
import { CountDetailPage } from "@/pages/counts/CountDetailPage";
import { QualityPage } from "@/pages/quality/QualityPage";
import { UsersPage } from "@/pages/users/UsersPage";
import { AuditPage } from "@/pages/audit/AuditPage";
import { ReportsPage } from "@/pages/reports/ReportsPage";
import { MobileShell } from "@/pages/mobile/MobileShell";
import { MobileHome } from "@/pages/mobile/MobileHome";
import { MobileTaskPage } from "@/pages/mobile/MobileTaskPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/mobile" element={<MobileShell />}>
            <Route index element={<MobileHome />} />
            <Route path="task/:id" element={<MobileTaskPage />} />
          </Route>

          <Route element={<AppShell />}>
            <Route index element={<RequirePermission codes={["dashboard.read"]}><DashboardPage /></RequirePermission>} />
            <Route path="/control-tower" element={<RequirePermission codes={["dashboard.read"]}><ControlTowerPage /></RequirePermission>} />

            <Route path="/catalog/products" element={<RequirePermission codes={["master_data.read", "master_data.manage"]}><ProductsPage /></RequirePermission>} />
            <Route path="/catalog/categories" element={<RequirePermission codes={["master_data.read", "master_data.manage"]}><CategoriesPage /></RequirePermission>} />
            <Route path="/catalog/uoms" element={<RequirePermission codes={["master_data.read", "master_data.manage"]}><UomPage /></RequirePermission>} />
            <Route path="/partners/suppliers" element={<RequirePermission codes={["master_data.read", "master_data.manage"]}><SuppliersPage /></RequirePermission>} />
            <Route path="/partners/customers" element={<RequirePermission codes={["master_data.read", "master_data.manage"]}><CustomersPage /></RequirePermission>} />
            <Route path="/partners/carriers" element={<RequirePermission codes={["master_data.read", "master_data.manage"]}><CarriersPage /></RequirePermission>} />

            <Route path="/warehouse" element={<RequirePermission codes={["warehouse.read", "warehouse.manage"]}><WarehousePage /></RequirePermission>} />
            <Route path="/inventory" element={<RequirePermission codes={["inventory.read", "inventory.adjust"]}><InventoryPage /></RequirePermission>} />
            <Route path="/inventory/movements" element={<RequirePermission codes={["inventory.read", "inventory.adjust"]}><MovementsPage /></RequirePermission>} />

            <Route path="/receiving" element={<RequirePermission codes={["receiving.read", "receiving.manage", "receiving.check"]}><ReceivingListPage /></RequirePermission>} />
            <Route path="/receiving/:id" element={<RequirePermission codes={["receiving.read", "receiving.manage", "receiving.check"]}><ReceivingDetailPage /></RequirePermission>} />
            <Route path="/discrepancies" element={<RequirePermission codes={["discrepancy.read"]}><DiscrepanciesPage /></RequirePermission>} />
            <Route path="/quality" element={<RequirePermission codes={["quality.manage"]}><QualityPage /></RequirePermission>} />

            <Route path="/orders" element={<RequirePermission codes={["order.read", "order.manage"]}><OrdersListPage /></RequirePermission>} />
            <Route path="/orders/:id" element={<RequirePermission codes={["order.read", "order.manage"]}><OrderDetailPage /></RequirePermission>} />
            <Route path="/waves" element={<RequirePermission codes={["wave.manage"]}><WavesPage /></RequirePermission>} />
            <Route path="/replenishment" element={<RequirePermission codes={["task.read"]}><ReplenishmentPage /></RequirePermission>} />
            <Route path="/tasks" element={<RequirePermission codes={["task.read"]}><TasksPage /></RequirePermission>} />

            <Route path="/counts" element={<RequirePermission codes={["count.read", "count.manage"]}><CountsPage /></RequirePermission>} />
            <Route path="/counts/:id" element={<RequirePermission codes={["count.read", "count.manage"]}><CountDetailPage /></RequirePermission>} />

            <Route path="/users" element={<RequirePermission codes={["users.manage"]}><UsersPage /></RequirePermission>} />
            <Route path="/reports" element={<RequirePermission codes={["reports.read"]}><ReportsPage /></RequirePermission>} />
            <Route path="/audit" element={<RequirePermission codes={["audit.read"]}><AuditPage /></RequirePermission>} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
