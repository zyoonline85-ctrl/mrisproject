const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/permission");
const dataService = require("../../services/data-service");

const router = express.Router();

/**
 * @swagger
 * /api/dashboard:
 *   get:
 *     summary: Ringkasan dashboard Admin
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard berhasil dimuat
 *       403:
 *         description: Permission dashboard:view dibutuhkan
 */
router.get(
  "/",
  requireAuth,
  requirePermission("dashboard", "view"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getDashboard(req.query) });
  })
);

router.get(
  "/material-purchase-comparisons",
  requireAuth,
  requirePermission("dashboard", "view"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getDashboardMaterialPurchaseComparisons(req.query) });
  })
);

module.exports = router;
