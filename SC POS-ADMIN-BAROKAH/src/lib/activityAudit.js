import { apiClient } from "@/lib/apiClient";
import { useAppStore } from "@/store/appStore";

const DEVICE_KEY = "pos-barokah-admin-device-id";
const QUEUE_PREFIX = "pos-barokah-admin-audit-queue";
const sensitiveKeyPattern = /(password|passwd|pin|token|secret|authorization|cookie|card|cvv|otp|keyword|search_text|query)/i;

function randomId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${value}`;
}

function deviceId() {
  let value = globalThis.localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = randomId("admin_device");
    globalThis.localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

function sanitize(value, depth = 0) {
  if (depth > 3 || value == null) return null;
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.entries(value).reduce((result, [key, item]) => {
    if (!sensitiveKeyPattern.test(key)) result[key] = sanitize(item, depth + 1);
    return result;
  }, {});
}

function queueKey(userId) {
  return `${QUEUE_PREFIX}:${userId}`;
}

function readQueue(userId) {
  try {
    return JSON.parse(globalThis.localStorage.getItem(queueKey(userId)) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(userId, events) {
  if (events.length) globalThis.localStorage.setItem(queueKey(userId), JSON.stringify(events));
  else globalThis.localStorage.removeItem(queueKey(userId));
}

function enqueue(userId, event) {
  const events = readQueue(userId);
  if (!events.some((item) => item.clientEventId === event.clientEventId)) events.push(event);
  writeQueue(userId, events);
}

export async function flushActivityQueue() {
  const { session, token } = useAppStore.getState();
  if (!session?.id || !token) return;
  const events = readQueue(session.id);
  if (!events.length) return;

  const batch = events.slice(0, 100);
  await apiClient.post("/admin/activity-logs", { logs: batch });
  writeQueue(session.id, events.slice(batch.length));
  if (events.length > batch.length) await flushActivityQueue();
}

export async function recordActivity({
  action,
  module = "admin",
  outcome = "succeeded",
  eventType = "interaction",
  entityType,
  entityId,
  description,
  metadata = {},
  outletId,
  correlationId
}) {
  const { session, token, selectedOutletId } = useAppStore.getState();
  if (!session?.id || !token) return;
  const event = {
    clientEventId: randomId("admin_event"),
    correlationId: correlationId || randomId("correlation"),
    eventType,
    outcome,
    module,
    action,
    entityType,
    entityId,
    description,
    outletId: outletId || (selectedOutletId !== "all" ? selectedOutletId : null),
    deviceId: deviceId(),
    appVersion: import.meta.env.VITE_APP_VERSION || "web",
    occurredAt: new Date().toISOString(),
    metadata: sanitize(metadata)
  };

  try {
    await apiClient.post("/admin/activity-logs", event);
    await flushActivityQueue();
  } catch (error) {
    if (!error.status || error.status >= 500) enqueue(session.id, event);
  }
}

export async function trackLocalAction(event, action) {
  try {
    const result = await action();
    await recordActivity({ ...event, outcome: "succeeded" });
    return result;
  } catch (error) {
    await recordActivity({
      ...event,
      outcome: "failed",
      metadata: { ...event.metadata, error: String(error?.message || "Aksi gagal").slice(0, 240) }
    });
    throw error;
  }
}
