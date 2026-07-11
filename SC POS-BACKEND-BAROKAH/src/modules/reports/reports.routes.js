const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { can, requireAnyPermission } = require("../../middlewares/permission");
const dataService = require("../../services/data-service");

const router = express.Router();

/**
 * @swagger
 * /api/reports:
 *   get:
 *     summary: Data laporan awal untuk Admin
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Laporan berhasil dimuat
 *       403:
 *         description: Salah satu permission laporan view dibutuhkan
 */
router.get(
  "/sales-outlet-comparison",
  requireAuth,
  requireAnyPermission([{ permissionKey: "reports.sales", action: "view" }]),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getSalesOutletComparison(req.query) });
  })
);

router.get(
  "/account-detail",
  requireAuth,
  (req, res, next) => {
    const report = req.query.report === "balance_sheet" ? "balance_sheet" : "profit_loss";
    const permissionKey = report === "balance_sheet" ? "reports.balance_sheet" : "reports.profit_loss";
    if (!can(req.auth, permissionKey, "view")) {
      return res.status(403).json({
        success: false,
        message: `Butuh permission ${permissionKey}:view.`
      });
    }
    return next();
  },
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getReportAccountDetail(req.query) });
  })
);

router.get(
  "/",
  requireAuth,
  requireAnyPermission([
    { permissionKey: "reports.sales", action: "view" },
    { permissionKey: "reports.transactions", action: "view" },
    { permissionKey: "reports.profit_loss", action: "view" },
    { permissionKey: "reports.balance_sheet", action: "view" },
    { permissionKey: "reports.purchases", action: "view" },
    { permissionKey: "reports.expenses", action: "view" }
  ]),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getReports(req.query) });
  })
);

module.exports = router;
