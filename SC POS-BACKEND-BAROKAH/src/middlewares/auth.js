const jwt = require("jsonwebtoken");
const env = require("../config/env");
const asyncHandler = require("../utils/async-handler");
const { unauthorized } = require("../utils/http-error");
const dataService = require("../services/data-service");

const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) throw unauthorized("Bearer token wajib dikirim.");

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized("Token tidak valid atau sudah expired.");
  }

  const session = await dataService.userById(payload.sub);
  if (!session || session.status !== "active") {
    throw unauthorized("User tidak aktif atau tidak ditemukan.");
  }

  delete session.password_hash;
  req.auth = session;
  next();
});

module.exports = { requireAuth };
