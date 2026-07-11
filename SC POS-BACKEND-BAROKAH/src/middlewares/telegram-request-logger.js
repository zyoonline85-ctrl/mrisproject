const { randomUUID } = require("node:crypto");
const telegramLogService = require("../services/telegram-log-service");

function requestIdFromHeader(value) {
  if (Array.isArray(value)) return value.find(Boolean);
  return value || null;
}

function captureResponseBody(res) {
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function jsonWithCapture(body) {
    res.locals.telegramResponseBody = body;
    res.locals.telegramResponseBodyType = "json";
    return originalJson.call(this, body);
  };

  res.send = function sendWithCapture(body) {
    if (res.locals.telegramResponseBody === undefined) {
      res.locals.telegramResponseBody = body;
      res.locals.telegramResponseBodyType = Buffer.isBuffer(body) ? "buffer" : typeof body;
    }

    return originalSend.call(this, body);
  };
}

function telegramRequestLogger({
  createLog = telegramLogService.createRequestLog,
  notifier = telegramLogService.sendTelegramLog
} = {}) {
  return function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const requestId = requestIdFromHeader(req.headers["x-request-id"]) || randomUUID();

    req.requestId = requestId;
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    captureResponseBody(res);

    let logged = false;

    function handleNotifierError(error) {
      if (req.app?.get("env") !== "test") {
        console.error("Telegram request log gagal:", error);
      }
    }

    function finalize(event) {
      if (logged) return;
      logged = true;

      const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const log = createLog({
        req,
        res,
        durationMs,
        event,
        error: res.locals.telegramError || null
      });

      try {
        Promise.resolve(notifier(log)).catch(handleNotifierError);
      } catch (error) {
        handleNotifierError(error);
      }
    }

    res.on("finish", () => finalize("finish"));
    res.on("close", () => finalize("close"));

    next();
  };
}

module.exports = { telegramRequestLogger };
