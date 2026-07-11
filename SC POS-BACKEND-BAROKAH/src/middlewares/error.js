const { HttpError } = require("../utils/http-error");

function notFoundHandler(req, res, next) {
  next(new HttpError(404, `Route ${req.method} ${req.originalUrl} tidak ditemukan.`));
}

function errorHandler(err, req, res, next) {
  res.locals.telegramError = err;

  const status = err.status || 500;
  const isProduction = req.app.get("env") === "production";
  const payload = {
    success: false,
    message: status >= 500 ? "Terjadi kesalahan server." : err.message,
    details: err.details || undefined,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  };

  if (!isProduction && status >= 500) {
    payload.message = err.message || payload.message;
    payload.stack = err.stack;
  }

  if (req.app.get("env") !== "test") {
    console.error(err);
  }

  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const isActivityEndpoint = /\/activity-logs(?:\?|$)/.test(req.originalUrl || "");
  const isLoginEndpoint = /\/auth\/(?:login|pin-login)(?:\?|$)/.test(req.originalUrl || "");
  if (isMutation && req.auth?.id && !isActivityEndpoint && !isLoginEndpoint) {
    try {
      const dataService = require("../services/data-service");
      const source = String(req.originalUrl || "").startsWith("/api/pos/") ? "kasir_app" : "admin_web";
      const outletId = req.body?.outlet_id || req.body?.outletId || req.query?.outletId || null;
      dataService.createActivityLog({
        actor_user_id: req.auth.id,
        actor_role: req.auth.role_id,
        outlet_id: req.auth.outlet_ids?.includes(outletId) ? outletId : null,
        source,
        event_type: "business",
        outcome: "failed",
        module: "api",
        action: "request_failed",
        description: `${req.method} ${req.path} gagal.`,
        correlation_id: req.get("x-correlation-id") || null,
        metadata_json: { method: req.method, path: req.path, status, error_code: err.code || null },
        ip_address: req.ip
      }).catch(() => {
        // Audit tidak boleh menahan atau mengganti respons error utama.
      });
    } catch {
      // Audit tidak boleh mengganti respons error utama.
    }
  }

  res.status(status).json(payload);
}

module.exports = {
  notFoundHandler,
  errorHandler
};
