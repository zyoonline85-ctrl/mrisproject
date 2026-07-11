const bcrypt = require("bcryptjs");

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

exports.up = async function up(knex) {
  const defaultSecurity = {
    report_pin_enabled: true,
    report_pin_hash: bcrypt.hashSync("000000", 10)
  };
  const securityRow = await knex("metadata").where({ key: "app_security" }).first();
  if (securityRow) {
    const current = parseJson(securityRow.value, {});
    await knex("metadata")
      .where({ key: "app_security" })
      .update({ value: JSON.stringify({ ...defaultSecurity, ...current, report_pin_hash: current.report_pin_hash || defaultSecurity.report_pin_hash }) });
  } else {
    await knex("metadata").insert({ key: "app_security", value: JSON.stringify(defaultSecurity) });
  }

  const permission = {
    key: "settings.app_security",
    group: "settings",
    label: "Keamanan APK",
    route: "/pengaturan/keamanan-apk",
    actions: JSON.stringify(["view", "update"])
  };
  const permissionRow = await knex("permissions").where({ key: permission.key }).first();
  if (permissionRow) {
    await knex("permissions").where({ key: permission.key }).update(permission);
  } else {
    await knex("permissions").insert(permission);
  }

  const roles = await knex("roles");
  await Promise.all(
    roles.map((role) => {
      const permissions = parseJson(role.permissions, {});
      if (role.id === "role_owner" || role.id === "role_admin") {
        permissions["settings.app_security"] = ["view", "update"];
      }
      return knex("roles").where({ id: role.id }).update({ permissions: JSON.stringify(permissions) });
    })
  );
};

exports.down = async function down(knex) {
  await knex("metadata").where({ key: "app_security" }).del();
  await knex("permissions").where({ key: "settings.app_security" }).del();
  const roles = await knex("roles");
  await Promise.all(
    roles.map((role) => {
      const permissions = parseJson(role.permissions, {});
      delete permissions["settings.app_security"];
      return knex("roles").where({ id: role.id }).update({ permissions: JSON.stringify(permissions) });
    })
  );
};
