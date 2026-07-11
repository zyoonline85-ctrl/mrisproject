const env = require("../config/env");

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 3900;
const INLINE_SECTION_LIMIT = 1200;
const COMPACT_SECTION_LIMIT = 350;

function safeClone(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "bigint") return value.toString();
  if (type === "function") return `[Function ${value.name || "anonymous"}]`;
  if (type !== "object") return value;

  if (value instanceof Error) return serializeError(value, seen);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      size: value.length,
      base64: value.toString("base64")
    };
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const cloned = value.map((item) => safeClone(item, seen));
    seen.delete(value);
    return cloned;
  }

  const cloned = {};
  for (const key of Object.keys(value)) {
    cloned[key] = safeClone(value[key], seen);
  }

  seen.delete(value);
  return cloned;
}

function serializeError(error, seen = new WeakSet()) {
  if (!error) return null;
  if (seen.has(error)) return "[Circular]";
  seen.add(error);

  const output = {
    name: error.name,
    message: error.message,
    stack: error.stack
  };

  for (const key of Object.getOwnPropertyNames(error)) {
    output[key] = safeClone(error[key], seen);
  }

  for (const key of Object.keys(error)) {
    output[key] = safeClone(error[key], seen);
  }

  seen.delete(error);
  return output;
}

function safeStringify(value, space = 2) {
  return JSON.stringify(safeClone(value), null, space);
}

function responseHeaders(res) {
  if (!res || typeof res.getHeaders !== "function") return {};
  return safeClone(res.getHeaders());
}

function createRequestLog({ req, res, durationMs, event = "finish", error = null }) {
  const statusCode = res?.statusCode || 0;

  const log = {
    timestamp: new Date().toISOString(),
    env: {
      node_env: env.nodeEnv,
      data_mode: env.dataMode
    },
    request_id: req.requestId || req.headers?.["x-request-id"] || null,
    method: req.method,
    url: req.originalUrl || req.url,
    path: req.path,
    status_code: statusCode,
    success: statusCode < 400,
    duration_ms: durationMs,
    event,
    ip: req.ip,
    user_agent: req.headers?.["user-agent"] || null,
    origin: req.headers?.origin || null,
    headers: safeClone(req.headers || {}),
    query: safeClone(req.query || {}),
    params: safeClone(req.params || {}),
    body: safeClone(req.body),
    auth: safeClone(req.auth || null),
    response: {
      status_code: statusCode,
      status_message: res?.statusMessage || null,
      headers_sent: Boolean(res?.headersSent),
      headers: responseHeaders(res),
      body_type: res?.locals?.telegramResponseBodyType || null,
      body: safeClone(res?.locals?.telegramResponseBody)
    }
  };

  if (error) {
    log.error = serializeError(error);
  }

  return log;
}

function severityForStatus(statusCode) {
  if (statusCode >= 500) return "ERROR";
  if (statusCode >= 400) return "WARN";
  return "OK";
}

function authLabel(auth) {
  if (!auth) return "-";
  return [auth.id, auth.username, auth.role_id].filter(Boolean).join(" / ") || "-";
}

function inlineJson(value, emptyLabel = "-", limit = INLINE_SECTION_LIMIT) {
  if (value === undefined || value === null) return emptyLabel;

  const json = typeof value === "string" ? value : safeStringify(value);
  if (!json || json === "{}" || json === "[]") return emptyLabel;

  if (json.length <= limit) return json;
  return `${json.slice(0, limit)}\n...dipotong, full JSON ada di attachment.`;
}

function formatSection(title, lines) {
  return [`=== ${title} ===`, ...lines].join("\n");
}

function formatTelegramSummary(log) {
  return [
    `[${severityForStatus(log.status_code)}] POS Backend Request`,
    `${log.method} ${log.url}`,
    `status_code: ${log.status_code}`,
    `duration_ms: ${log.duration_ms}`,
    `request_id: ${log.request_id || "-"}`,
    `env: ${log.env?.node_env || "-"} / ${log.env?.data_mode || "-"}`,
    `user: ${authLabel(log.auth)}`,
    `ip: ${log.ip || "-"}`,
    `origin: ${log.origin || "-"}`,
    `time: ${log.timestamp}`
  ].join("\n");
}

function formatTelegramMessage(log, sectionLimit = INLINE_SECTION_LIMIT) {
  const requestLines = [
    `time: ${log.timestamp}`,
    `request_id: ${log.request_id || "-"}`,
    `method: ${log.method}`,
    `url: ${log.url}`,
    `path: ${log.path || "-"}`,
    `status_code: ${log.status_code}`,
    `success: ${log.success}`,
    `duration_ms: ${log.duration_ms}`,
    `ip: ${log.ip || "-"}`,
    `origin: ${log.origin || "-"}`,
    `user_agent: ${log.user_agent || "-"}`,
    `auth: ${authLabel(log.auth)}`,
    `env: ${log.env?.node_env || "-"} / ${log.env?.data_mode || "-"}`
  ];

  const payloadLines = [
    `params:\n${inlineJson(log.params, "-", sectionLimit)}`,
    `query:\n${inlineJson(log.query, "-", sectionLimit)}`,
    `body:\n${inlineJson(log.body, "-", sectionLimit)}`
  ];

  const responseLines = [
    `status_code: ${log.response?.status_code || log.status_code}`,
    `status_message: ${log.response?.status_message || "-"}`,
    `headers_sent: ${Boolean(log.response?.headers_sent)}`,
    `body_type: ${log.response?.body_type || "-"}`,
    `body:\n${inlineJson(log.response?.body, "-", sectionLimit)}`
  ];

  const sections = [
    formatTelegramSummary(log),
    formatSection("REQUEST", requestLines),
    formatSection("PAYLOAD", payloadLines),
    formatSection("RESPONSE", responseLines)
  ];

  if (log.error) {
    sections.push(formatSection("ERROR RAW", [inlineJson(log.error, "-", sectionLimit)]));
  }

  sections.push(
    formatSection("HEADERS RAW", [
      `request:\n${inlineJson(log.headers, "-", sectionLimit)}`,
      `response:\n${inlineJson(log.response?.headers, "-", sectionLimit)}`
    ])
  );

  return sections.join("\n\n");
}

function formatTelegramCompactMessage(log) {
  return formatTelegramMessage(log, COMPACT_SECTION_LIMIT);
}

function telegramEnabled(config) {
  return Boolean(config?.enabled && config?.botToken && config?.chatId);
}

async function requestTelegram(method, options, config, fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API tidak tersedia untuk mengirim log Telegram.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 2500);
  timeout.unref?.();

  try {
    const response = await fetchImpl(`${TELEGRAM_API_BASE_URL}/bot${config.botToken}/${method}`, {
      ...options,
      method: "POST",
      signal: controller.signal
    });
    const text = await response.text();

    if (!response.ok) {
      const error = new Error(`Telegram ${method} gagal dengan status ${response.status}.`);
      error.status = response.status;
      error.response_body = text;
      throw error;
    }

    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function jsonFilename(log) {
  const requestId = String(log.request_id || "request").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `telegram-request-log-${requestId}.json`;
}

async function sendTelegramMessage(text, config, fetchImpl) {
  return requestTelegram(
    "sendMessage",
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true
      })
    },
    config,
    fetchImpl
  );
}

async function sendTelegramDocument(log, fullJson, config, fetchImpl) {
  const form = new FormData();
  form.append("chat_id", String(config.chatId));
  form.append("caption", `Full JSON log ${log.request_id || ""}`.trim());
  form.append("document", new Blob([fullJson], { type: "application/json" }), jsonFilename(log));

  return requestTelegram("sendDocument", { body: form }, config, fetchImpl);
}

async function sendTelegramLog(log, config = env.telegramLog, fetchImpl = globalThis.fetch) {
  if (!telegramEnabled(config)) {
    return { skipped: true, reason: "telegram_log_disabled" };
  }

  const fullJson = safeStringify(log);
  const fullMessage = formatTelegramMessage(log);

  if (fullMessage.length <= TELEGRAM_MESSAGE_LIMIT) {
    await sendTelegramMessage(fullMessage, config, fetchImpl);
    return { sent: true, mode: "message" };
  }

  const compactMessage = formatTelegramCompactMessage(log);
  await sendTelegramMessage(compactMessage.length <= TELEGRAM_MESSAGE_LIMIT ? compactMessage : formatTelegramSummary(log), config, fetchImpl);
  await sendTelegramDocument(log, fullJson, config, fetchImpl);
  return { sent: true, mode: "document" };
}

module.exports = {
  TELEGRAM_MESSAGE_LIMIT,
  createRequestLog,
  formatTelegramCompactMessage,
  formatTelegramMessage,
  formatTelegramSummary,
  safeClone,
  safeStringify,
  sendTelegramLog,
  serializeError
};
