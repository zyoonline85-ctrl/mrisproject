const express = require("express");
const asyncHandler = require("../../utils/async-handler");
const { requireAuth } = require("../../middlewares/auth");
const { can } = require("../../middlewares/permission");
const { forbidden } = require("../../utils/http-error");
const dataService = require("../../services/data-service");

const router = express.Router();

function requireSettingsAccess(req, res, next) {
  const allowed =
    can(req.auth, "settings.permissions", "view") ||
    can(req.auth, "settings.printing", "view") ||
    can(req.auth, "settings.app_security", "view") ||
    can(req.auth, "settings.profile", "view");

  if (!allowed) {
    return next(forbidden("Butuh salah satu permission settings untuk membuka pengaturan."));
  }

  return next();
}

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Pengaturan role, permission, dan print
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings berhasil dimuat
 *       403:
 *         description: Permission settings.permissions:view dibutuhkan
 */
router.get(
  "/",
  requireAuth,
  requireSettingsAccess,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await dataService.getSettings() });
  })
);

module.exports = router;
