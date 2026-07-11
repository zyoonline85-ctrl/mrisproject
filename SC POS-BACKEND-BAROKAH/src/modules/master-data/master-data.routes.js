const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { can } = require("../../middlewares/permission");
const { forbidden } = require("../../utils/http-error");
const dataService = require("../../services/data-service");

const router = express.Router();
const masterViewPermissions = [
  "master.products",
  "master.categories",
  "master.expense_categories",
  "master.customers",
  "master.tables",
  "master.users",
  "master.outlets",
  "master.suppliers",
  "master.materials",
  "master.units"
];

function requireAnyMasterDataAccess(req, res, next) {
  const allowed = masterViewPermissions.some((permissionKey) => can(req.auth, permissionKey, "view"));

  if (!allowed) {
    return next(forbidden("Butuh salah satu permission master data untuk membuka endpoint ini."));
  }

  return next();
}

/**
 * @swagger
 * /api/master-data:
 *   get:
 *     summary: Data master awal untuk Admin
 *     tags: [Master Data]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Master data berhasil dimuat
 *       403:
 *         description: Salah satu permission master data view dibutuhkan
 */
router.get(
  "/",
  requireAuth,
  requireAnyMasterDataAccess,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getMasterData(req.query) });
  })
);

module.exports = router;
