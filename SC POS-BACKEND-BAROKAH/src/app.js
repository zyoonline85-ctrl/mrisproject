const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const path = require("path");

const env = require("./config/env");
const swaggerSpec = require("./docs/swagger");
const { notFoundHandler, errorHandler } = require("./middlewares/error");
const { telegramRequestLogger } = require("./middlewares/telegram-request-logger");
const { HttpError } = require("./utils/http-error");
const { activityAuditContext } = require("./middlewares/activity-audit");

const authRoutes = require("./modules/auth/auth.routes");
const bootstrapRoutes = require("./modules/bootstrap/bootstrap.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const masterDataRoutes = require("./modules/master-data/master-data.routes");
const inventoryRoutes = require("./modules/inventory/inventory.routes");
const reportsRoutes = require("./modules/reports/reports.routes");
const settingsRoutes = require("./modules/settings/settings.routes");
const mobileRoutes = require("./modules/mobile/mobile.routes");
const posRoutes = require("./modules/pos/pos.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const dailyReportsRoutes = require("./modules/daily-reports/daily-reports.routes");
const manualReportsRoutes = require("./modules/manual-reports/manual-reports.routes");

const app = express();


// Normalize case-sensitive API route (e.g., /API/admin to /api/admin)
app.use((req, res, next) => {
  if (req.url.startsWith("/API")) {
    req.url = "/api" + req.url.slice(4);
  }
  next();
});

app.set("trust proxy", 1);
app.use(telegramRequestLogger());
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes("*") || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new HttpError(403, `Origin ${origin} tidak diizinkan CORS.`, {
          origin,
          allowedOrigins: env.corsOrigins,
          fix: "Tambahkan origin frontend ke CORS_ORIGIN di .env, pisahkan dengan koma. Untuk development boleh pakai CORS_ORIGIN=*."
        })
      );
    }
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(activityAuditContext);
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false
  })
);

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check backend
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Backend aktif
 */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "pos-backend-barokah",
    status: "ok",
    time: new Date().toISOString()
  });
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api/docs.json", (req, res) => res.json(swaggerSpec));

app.use("/api/auth", authRoutes);
app.use("/api/bootstrap", bootstrapRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/master-data", masterDataRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/daily-reports", dailyReportsRoutes);
app.use("/api/admin/manual-reports", manualReportsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
