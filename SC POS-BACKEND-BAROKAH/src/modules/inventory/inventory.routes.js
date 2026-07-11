const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/permission");
const dataService = require("../../services/data-service");

const router = express.Router();

/**
 * @swagger
 * /api/inventory:
 *   get:
 *     summary: Data inventory awal untuk Admin
 *     tags: [Inventory]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inventory berhasil dimuat
 *       403:
 *         description: Permission inventory.stocks:view dibutuhkan
 */
router.get(
  "/",
  requireAuth,
  requirePermission("inventory.stocks", "view"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getInventory(req.query) });
  })
);

router.get(
  "/stock-opname-worksheet",
  requireAuth,
  requirePermission("inventory.opnames", "view"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getStockOpnameWorksheet(req.query) });
  })
);

module.exports = router;
