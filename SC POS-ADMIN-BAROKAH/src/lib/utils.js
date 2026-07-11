import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const APP_TIME_ZONE = "Asia/Jakarta";
export const DEFAULT_API_PORT = "4000";
export const DEFAULT_REMOTE_API_BASE_URL = "";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function resolveApiBaseUrl() {
  const explicitBaseUrl = String(
    import.meta.env.VITE_API_BASE_URL || "",
  ).trim();
  if (explicitBaseUrl) return explicitBaseUrl;

  const apiMode = String(import.meta.env.VITE_API_MODE || "local")
    .trim()
    .toLowerCase();
  const localBaseUrl = String(
    import.meta.env.VITE_LOCAL_API_BASE_URL || "",
  ).trim();
  const remoteBaseUrl = String(
    import.meta.env.VITE_REMOTE_API_BASE_URL || DEFAULT_REMOTE_API_BASE_URL,
  ).trim();

  if (apiMode === "remote" || apiMode === "base_url") {
    return remoteBaseUrl;
  }

  if (apiMode === "local" && localBaseUrl) {
    return localBaseUrl;
  }

  if (
    typeof globalThis.window !== "undefined" &&
    globalThis.window.location?.hostname
  ) {
    const { protocol, hostname } = globalThis.window.location;
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}/api`;
  }

  return `http://localhost:${DEFAULT_API_PORT}/api`;
}

export function resolveBackendAssetUrl(value) {
  if (!value) return "";
  const rawValue = String(value);
  if (/^https?:\/\//i.test(rawValue)) return rawValue;

  const apiBaseUrl = resolveApiBaseUrl();
  try {
    const origin = new globalThis.URL(apiBaseUrl).origin;
    return `${origin}${rawValue.startsWith("/") ? rawValue : `/${rawValue}`}`;
  } catch {
    return rawValue;
  }
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(value || 0);
}

export function parseThousands(value, { allowDecimal = false } = {}) {
  if (value === null || value === undefined) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  if (!allowDecimal) {
    const digits = raw.replace(/\D/g, "");
    return digits ? Number(digits) : "";
  }

  const normalized = raw
    .replace(/[^\d,.]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parts = normalized.split(".");
  const clean =
    parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0];

  if (!clean || clean === ".") return "";
  return Number(clean);
}

export function formatThousands(value, { allowDecimal = false } = {}) {
  if (value === null || value === undefined || value === "") return "";

  const parsed =
    typeof value === "number" ? value : parseThousands(value, { allowDecimal });
  if (parsed === "" || Number.isNaN(parsed)) return "";

  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: allowDecimal ? 3 : 0,
  }).format(parsed);
}

export function formatDate(value) {
  if (!value) return "-";
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? parseDateString(value)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function toDateInput(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function parseDateString(value) {
  if (!value) return undefined;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? undefined : value;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return undefined;

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toDateString(date) {
  if (!date) return "";
  const parsed = date instanceof Date ? date : parseDateString(date);
  if (!parsed) return "";

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLocalDateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getLocalHour(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);
  if (!Number.isFinite(hour)) return null;
  return hour === 24 ? 0 : hour;
}

export function includesText(value, keyword) {
  if (!keyword) return true;
  return String(value || "")
    .toLowerCase()
    .includes(keyword.toLowerCase());
}
