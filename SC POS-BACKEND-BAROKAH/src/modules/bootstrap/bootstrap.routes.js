const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const dataService = require("../../services/data-service");

const router = express.Router();

/**
 * @swagger
 * /api/bootstrap:
 *   get:
 *     summary: Data awal Admin setelah login
 *     tags: [Bootstrap]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bootstrap data berhasil dimuat
 *       401:
 *         description: Token wajib
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getBootstrap() });
  })
);

module.exports = router;
