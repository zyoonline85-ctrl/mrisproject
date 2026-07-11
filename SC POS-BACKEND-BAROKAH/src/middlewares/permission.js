const { forbidden } = require("../utils/http-error");
const { hasApkAccess } = require("../config/permission-catalog");

function can(session, permissionKey, action = "view") {
  const actions = session?.role?.permissions?.[permissionKey] || [];
  return actions.includes(action);
}

function requirePermission(permissionKey, action = "view") {
  return function permissionGuard(req, res, next) {
    if (!can(req.auth, permissionKey, action)) {
      return next(forbidden(`Butuh permission ${permissionKey}:${action}.`));
    }
    return next();
  };
}

function requireAnyPermission(requirements = []) {
  return function anyPermissionGuard(req, res, next) {
    const allowed = requirements.some(({ permissionKey, action = "view" }) => can(req.auth, permissionKey, action));
    if (!allowed) {
      const labels = requirements.map(({ permissionKey, action = "view" }) => `${permissionKey}:${action}`).join(", ");
      return next(forbidden(`Butuh salah satu permission: ${labels}.`));
    }
    return next();
  };
}

function requireApkAccess(req, res, next) {
  if (!hasApkAccess(req.auth?.role)) {
    return next(forbidden("Role tidak memiliki akses APK Kasir."));
  }
  return next();
}

module.exports = {
  can,
  requireApkAccess,
  requireAnyPermission,
  requirePermission
};
