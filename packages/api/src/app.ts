import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "@/config/env";
import { errorHandler, notFoundHandler } from "@/common/error-handler";
import { authRouter } from "@/modules/auth/auth.routes";
import { usersRouter } from "@/modules/users/users.routes";
import { rolesRouter } from "@/modules/roles/roles.routes";
import { catalogRouter } from "@/modules/catalog/catalog.routes";
import { partnersRouter } from "@/modules/partners/partners.routes";
import { auditRouter } from "@/modules/audit/audit.routes";
import { warehouseRouter } from "@/modules/warehouse/warehouse.routes";
import { inventoryRouter } from "@/modules/inventory/inventory.routes";
import { receivingRouter } from "@/modules/receiving/receiving.routes";
import { discrepancyRouter } from "@/modules/discrepancy/discrepancy.routes";
import { taskRouter } from "@/modules/tasks/task.routes";
import { orderRouter } from "@/modules/orders/order.routes";
import { waveRouter } from "@/modules/waves/wave.routes";
import { replenishmentRouter } from "@/modules/replenishment/replenishment.routes";
import { countRouter } from "@/modules/counts/count.routes";
import { qualityRouter } from "@/modules/quality/quality.routes";
import { packingRouter } from "@/modules/packing/packing.routes";
import { shippingRouter } from "@/modules/shipping/shipping.routes";
import { dashboardRouter } from "@/modules/dashboard/dashboard.routes";
import { reportsRouter } from "@/modules/reports/reports.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "5mb" }));
  if (env.nodeEnv !== "test") {
    app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  }

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "stark-wms-api", time: new Date().toISOString() }));

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/partners", partnersRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/warehouse", warehouseRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/receiving", receivingRouter);
  app.use("/api/discrepancies", discrepancyRouter);
  app.use("/api/tasks", taskRouter);
  app.use("/api/orders", orderRouter);
  app.use("/api/waves", waveRouter);
  app.use("/api/replenishment", replenishmentRouter);
  app.use("/api/counts", countRouter);
  app.use("/api/quality", qualityRouter);
  app.use("/api/packing", packingRouter);
  app.use("/api/shipping", shippingRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/reports", reportsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
