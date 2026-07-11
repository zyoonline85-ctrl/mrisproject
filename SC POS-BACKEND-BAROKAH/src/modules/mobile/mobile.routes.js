const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { requireApkAccess } = require("../../middlewares/permission");
const dataService = require("../../services/data-service");

const router = express.Router();

/**
 * @swagger
 * /api/mobile/catalog:
 *   get:
 *     summary: Catalog aktif untuk APK Kasir
 *     tags: [Mobile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Catalog mobile berhasil dimuat
 *       401:
 *         description: Token wajib
 */
router.get(
  "/catalog",
  requireAuth,
  requireApkAccess,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getMobileCatalog(req.auth) });
  })
);

module.exports = router;
