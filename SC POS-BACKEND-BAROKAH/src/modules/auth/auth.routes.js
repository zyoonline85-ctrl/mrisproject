const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("../../config/env");
const { hasAdminAccess, hasApkAccess } = require("../../config/permission-catalog");
const { requireAuth } = require("../../middlewares/auth");
const asyncHandler = require("../../utils/async-handler");
const validate = require("../../utils/validate");
const { unauthorized } = require("../../utils/http-error");
const dataService = require("../../services/data-service");

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const pinLoginSchema = z.object({
  user_id: z.string().min(1),
  pin: z.string().regex(/^\d{6}$/, "PIN wajib 6 digit angka.")
});

function sanitizeSession(session) {
  if (!session) return session;
  delete session.password_hash;
  delete session.pin_hash;
  delete session.cashier_pin;
  return session;
}

function createToken(session) {
  return jwt.sign({ sub: session.id }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });
}

async function writeLoginActivity(session, req, loginType) {
  const isPinLogin = loginType === "pin";
  try {
    await dataService.createActivityLog({
      actor_user_id: session.id,
      actor_role: session.role_id,
      outlet_id: (session.outlet_ids || [])[0] || null,
      source: isPinLogin ? "kasir_app" : "admin_web",
      event_type: "business",
      outcome: "succeeded",
      module: "auth",
      action: "login",
      entity_type: "user",
      entity_id: session.id,
      description: `${session.name} login ke ${isPinLogin ? "APK Kasir" : "Admin Web"}.`,
      metadata_json: {
        username: session.username,
        login_type: loginType
      },
      ip_address: req.ip
    });
  } catch {
    // Activity log should never block login.
  }
}

async function writeLoginFailure(req, loginType, candidate = {}) {
  try {
    await dataService.createActivityLog({
      actor_user_id: candidate.userId || null,
      source: loginType === "pin" ? "kasir_app" : "admin_web",
      event_type: "business",
      outcome: "failed",
      module: "auth",
      action: "login",
      entity_type: "user",
      entity_id: candidate.userId || null,
      description: `Percobaan login ${loginType === "pin" ? "APK Kasir" : "Admin Web"} gagal.`,
      metadata_json: { username: candidate.username || null, login_type: loginType },
      ip_address: req.ip
    });
  } catch {
    // Kegagalan audit tidak boleh mengubah hasil login.
  }
}

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user Admin atau Kasir
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: owner
 *               password:
 *                 type: string
 *                 example: admin123
 *     responses:
 *       200:
 *         description: Login berhasil
 *       401:
 *         description: Username/password salah atau user nonaktif
 *       422:
 *         description: Validasi gagal
 */
router.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const session = await dataService.userByUsername(username);

    if (!session || session.status !== "active") {
      await writeLoginFailure(req, "password", { username });
      throw unauthorized("Username atau password tidak valid.");
    }
    const passwordValid = await dataService.verifyPassword(session, password);
    if (!passwordValid) {
      await writeLoginFailure(req, "password", { userId: session.id, username });
      throw unauthorized("Username atau password tidak valid.");
    }
    if (!hasAdminAccess(session.role)) {
      await writeLoginFailure(req, "password", { userId: session.id, username });
      throw unauthorized("Role ini tidak memiliki akses Admin Web.");
    }

    await dataService.updateLastLogin(session.id);
    await writeLoginActivity(session, req, "password");
    sanitizeSession(session);

    const token = createToken(session);

    res.json({
      success: true,
      token,
      user: session
    });
  })
);

/**
 * @swagger
 * /api/auth/cashiers:
 *   get:
 *     summary: Daftar kasir aktif untuk login PIN APK
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Daftar kasir aktif
 */
router.get(
  "/cashiers",
  asyncHandler(async (req, res) => {
    const cashiers = await dataService.cashiersForPinLogin();
    res.json({
      success: true,
      cashiers
    });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = sanitizeSession({ ...req.auth });
    res.json({ success: true, user: session, data: session });
  })
);

/**
 * @swagger
 * /api/auth/pin-login:
 *   post:
 *     summary: Login APK Kasir memakai PIN 6 digit
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, pin]
 *             properties:
 *               user_id:
 *                 type: string
 *               pin:
 *                 type: string
 *                 example: "000000"
 *     responses:
 *       200:
 *         description: Login berhasil
 *       401:
 *         description: PIN salah atau kasir tidak valid
 *       422:
 *         description: Validasi gagal
 */
router.post(
  "/pin-login",
  validate(pinLoginSchema),
  asyncHandler(async (req, res) => {
    const { user_id: userId, pin } = req.body;
    const session = await dataService.userById(userId);

    if (!session || session.status !== "active" || !hasApkAccess(session.role)) {
      await writeLoginFailure(req, "pin", { userId });
      throw unauthorized("Kasir atau PIN tidak valid.");
    }

    const pinValid = await dataService.verifyCashierPin(session, pin);
    if (!pinValid) {
      await writeLoginFailure(req, "pin", { userId });
      throw unauthorized("Kasir atau PIN tidak valid.");
    }

    await dataService.updateLastLogin(session.id);
    await writeLoginActivity(session, req, "pin");
    sanitizeSession(session);

    const token = createToken(session);

    res.json({
      success: true,
      token,
      user: session
    });
  })
);

module.exports = router;
