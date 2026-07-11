import axios from "axios";
import { resolveApiBaseUrl } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";

const API_BASE_URL = resolveApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json"
  }
});

apiClient.interceptors.request.use((config) => {
  const token = useAppStore.getState().token;

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const body = response.data;

    if (body && body.success === true && Object.prototype.hasOwnProperty.call(body, "data")) {
      return body.data;
    }

    return body;
  },
  (error) => {
    const status = error.response?.status;
    const method = String(error.config?.method || "get").toUpperCase();
    const path = String(error.config?.url || "");
    const body = error.response?.data;
    const details = body?.details;
    const detailText =
      details && typeof details === "object"
        ? Object.values(details)
            .flat()
            .filter(Boolean)
            .join(", ")
        : "";
    const message = [body?.message, detailText].filter(Boolean).join(" - ") || error.message || "Request gagal.";
    const normalizedError = new Error(message);

    normalizedError.status = status;
    normalizedError.details = details;

    if (!status && ["POST", "PUT", "PATCH", "DELETE"].includes(method) && !path.includes("/activity-logs")) {
      import("@/lib/activityAudit").then(({ recordActivity }) => recordActivity({
        module: "api",
        action: "request_failed",
        outcome: "failed",
        eventType: "business",
        description: `${method} ${path} gagal sebelum mencapai backend.`,
        metadata: { method, path, error: normalizedError.message }
      })).catch(() => {});
    }

    if (status === 401) {
      useAppStore.getState().logout();
    }

    return Promise.reject(normalizedError);
  }
);
