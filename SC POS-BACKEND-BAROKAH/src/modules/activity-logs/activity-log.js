const allowedEventTypes = new Set(["business", "interaction", "system"]);
const allowedOutcomes = new Set(["succeeded", "failed", "cancelled"]);
const sensitiveKeyPattern = /(password|passwd|pin|token|secret|authorization|cookie|card|cvv|otp|keyword|search_text|query)/i;

function cleanText(value, maxLength = 160) {
  if (value == null) return null;
  return String(value).trim().slice(0, maxLength) || null;
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 3 || value == null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" ? value.slice(0, 500) : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value !== "object") return null;

  return Object.entries(value).slice(0, 100).reduce((result, [key, item]) => {
    if (sensitiveKeyPattern.test(key)) return result;
    result[String(key).slice(0, 80)] = sanitizeMetadata(item, depth + 1);
    return result;
  }, {});
}

function normalizeActivityPayload(payload = {}, defaults = {}) {
  const eventType = payload.event_type || payload.eventType || defaults.event_type || "business";
  const outcome = payload.outcome || defaults.outcome || "succeeded";
  const occurredAt = payload.occurred_at || payload.occurredAt || payload.created_at || payload.createdAt;
  const parsedOccurredAt = occurredAt ? new Date(occurredAt) : new Date();
  const localId = cleanText(payload.id, 80);
  const clientEventId = cleanText(
    payload.client_event_id || payload.clientEventId || (localId?.startsWith("activity_local_") ? localId : null),
    80
  );

  return {
    actor_user_id: payload.actor_user_id || payload.actorUserId || defaults.actor_user_id || null,
    actor_role: cleanText(payload.actor_role || payload.actorRole || defaults.actor_role, 40),
    outlet_id: cleanText(payload.outlet_id || payload.outletId || defaults.outlet_id, 40),
    source: cleanText(defaults.source || payload.source || "backend", 40) || "backend",
    event_type: allowedEventTypes.has(eventType) ? eventType : "interaction",
    outcome: allowedOutcomes.has(outcome) ? outcome : "succeeded",
    module: cleanText(payload.module || defaults.module || "system", 80) || "system",
    action: cleanText(payload.action || defaults.action || "unknown", 80) || "unknown",
    entity_type: cleanText(payload.entity_type || payload.entityType, 80),
    entity_id: cleanText(payload.entity_id || payload.entityId, 80),
    description: cleanText(payload.description, 1000),
    metadata_json: sanitizeMetadata(payload.metadata_json || payload.metadata || {}),
    ip_address: cleanText(defaults.ip_address || payload.ip_address || payload.ipAddress, 80),
    device_id: cleanText(payload.device_id || payload.deviceId, 120),
    app_version: cleanText(payload.app_version || payload.appVersion, 80),
    client_event_id: clientEventId,
    correlation_id: cleanText(payload.correlation_id || payload.correlationId, 80),
    occurred_at: Number.isNaN(parsedOccurredAt.getTime()) ? new Date() : parsedOccurredAt
  };
}

module.exports = {
  allowedEventTypes,
  allowedOutcomes,
  normalizeActivityPayload,
  sanitizeMetadata
};
