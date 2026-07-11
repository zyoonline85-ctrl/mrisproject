const { runActivityRequest, wasActivityWritten } = require("../modules/activity-logs/activity-request-context");

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function activityAuditContext(req, res, next) {
  runActivityRequest(() => {
    res.on("finish", () => {
      const excluded = /\/api\/(?:auth\/(?:login|pin-login)|(?:admin|pos)\/activity-logs)(?:\?|$)/.test(req.originalUrl || "");
      if (!mutationMethods.has(req.method) || excluded || res.statusCode >= 400 || !req.auth?.id || wasActivityWritten()) return;

      const source = String(req.originalUrl || "").startsWith("/api/pos/") ? "kasir_app" : "admin_web";
      const outletId = req.body?.outlet_id || req.body?.outletId || req.query?.outletId || null;
      const segments = String(req.path || "").split("/").filter(Boolean);
      const surfaceIndex = segments.findIndex((segment) => segment === "admin" || segment === "pos");
      const module = segments[surfaceIndex + 1] || "api";
      const dataService = require("../services/data-service");
      dataService.createActivityLog({
        actor_user_id: req.auth.id,
        actor_role: req.auth.role_id,
        outlet_id: req.auth.outlet_ids?.includes(outletId) ? outletId : null,
        source,
        event_type: "business",
        outcome: "succeeded",
        module,
        action: "request_succeeded",
        description: `${req.method} ${req.path} berhasil.`,
        correlation_id: req.get("x-correlation-id") || null,
        metadata_json: { method: req.method, path: req.path, status: res.statusCode },
        ip_address: req.ip
      }).catch(() => {});
    });
    next();
  });
}

module.exports = { activityAuditContext };
