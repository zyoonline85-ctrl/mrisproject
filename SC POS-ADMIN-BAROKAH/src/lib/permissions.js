import { permissionCatalog } from "@/config/permissionCatalog";

const parentRoutes = ["/", "/master-data", "/inventory", "/laporan", "/finance", "/pengaturan"];

const legacyPermissionMap = {
  dashboard: { module: "dashboard" },
  "master.products": { module: "products" },
  "master.categories": { module: "products" },
  "master.expense_categories": { module: "reports", actionMap: { toggle_status: "update" } },
  "master.customers": { module: "customers", actionMap: { print_barcode: "print", generate_barcode: "create", toggle_status: "update" } },
  "master.tables": { module: "master.outlets", actionMap: { toggle_status: "update" } },
  "master.users": { module: "users", actionMap: { toggle_status: "update", reset_password: "update" } },
  "master.outlets": { module: "outlets", actionMap: { toggle_status: "update" } },
  "master.suppliers": { module: "inventory", actionMap: { toggle_status: "update" } },
  "master.materials": { module: "inventory", actionMap: { toggle_status: "update" } },
  "master.units": { module: "inventory", actionMap: { toggle_status: "update" } },
  "master.imports": { module: "settings", actionMap: { create: "update" } },
  "inventory.stocks": { module: "inventory", actionMap: { detail: "view", purchase: "create", transfer: "create", opname: "create" } },
  "inventory.purchases": { module: "inventory" },
  "inventory.transfers": { module: "inventory" },
  "inventory.opnames": { module: "inventory" },
  "reports.sales": { module: "reports" },
  "reports.transactions": { module: "reports" },
  "reports.profit_loss": { module: "reports" },
  "reports.balance_sheet": { module: "reports" },
  "reports.purchases": { module: "reports" },
  "reports.expenses": { module: "reports" },
  "finance.accounts": { module: "reports", actionMap: { toggle_status: "update" } },
  "finance.entries": { module: "reports", actionMap: { toggle_status: "update" } },
  "settings.permissions": { module: "settings" },
  "settings.printing": { module: "settings", actionMap: { update: "update" } },
  "settings.app_security": { module: "settings", actionMap: { update: "update" } },
  "settings.profile": { module: "settings" }
};

function matchesPath(pathname, target) {
  return pathname === target || pathname.startsWith(`${target}/`);
}

export function getRoutePermission(pathname) {
  return permissionCatalog.find((permission) => permission.route && matchesPath(pathname, permission.route));
}

export function getPermission(permissionKey) {
  return permissionCatalog.find((permission) => permission.key === permissionKey);
}

function canLegacy(session, permissionKey, action) {
  const legacy = legacyPermissionMap[permissionKey];
  if (!legacy) return false;

  const legacyAction = legacy.actionMap?.[action] || action;
  const actions = session?.role?.permissions?.[legacy.module] || [];
  return actions.includes(legacyAction);
}

export function can(session, permissionKey, action = "view") {
  const actions = session?.role?.permissions?.[permissionKey] || [];
  if (actions.includes(action)) return true;

  return canLegacy(session, permissionKey, action);
}

export function canAny(session, permissionKey, actions = []) {
  return actions.some((action) => can(session, permissionKey, action));
}

export function canAccessPath(session, pathname) {
  if (pathname === "/login" || parentRoutes.includes(pathname)) return true;

  const permission = getRoutePermission(pathname);
  if (!permission) return true;

  return can(session, permission.key, "view");
}

export function getFirstAccessiblePath(session) {
  return permissionCatalog.find(
    (permission) => permission.route?.startsWith("/") && can(session, permission.key, "view")
  )?.route || "/login";
}

export function filterNavigationByPermission(groups, session) {
  return groups
    .map((group) => {
      if (!group.children) {
        return canAccessPath(session, group.to) ? group : null;
      }

      const children = group.children.filter((child) => {
        if (child.permissionKey) return can(session, child.permissionKey, "view");
        return canAccessPath(session, child.to);
      });
      return children.length ? { ...group, children } : null;
    })
    .filter(Boolean);
}
