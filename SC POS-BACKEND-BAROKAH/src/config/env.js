const path = require("node:path");
const dotenv = require("dotenv");

const explicitEnv = { ...process.env };
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
Object.assign(process.env, explicitEnv);

function required(value, name) {
  if (!value) {
    throw new Error(`${name} wajib diisi di environment.`);
  }
  return value;
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function parseBoolean(value) {
  return String(value || "").toLowerCase() === "true";
}

function parsePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const port = Number(process.env.PORT || 4000);
const corsOrigins = parseList(
  process.env.CORS_ORIGIN || `http://localhost:5173,http://localhost:5174,http://localhost:${port}`
);

if (!corsOrigins.includes("*")) {
  corsOrigins.push(`http://localhost:${port}`);
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  dataMode: process.env.DATA_MODE || "mock",
  port,
  jwtSecret:
    process.env.NODE_ENV === "production"
      ? required(process.env.JWT_SECRET, "JWT_SECRET")
      : process.env.JWT_SECRET || "barokah-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  corsOrigins: unique(corsOrigins),
  telegramLog: {
    enabled: parseBoolean(process.env.TELEGRAM_LOG_ENABLED),
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    timeoutMs: parsePositiveNumber(process.env.TELEGRAM_LOG_TIMEOUT_MS, 2500)
  }
};

module.exports = env;
