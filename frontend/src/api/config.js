// API configuration
// In production VITE_API_URL is the backend origin. Locally, Vite proxies /api.
const backendUrl = import.meta.env.VITE_API_URL?.replace(/\/+$/, "");

export const API_BASE_URL = backendUrl ? `${backendUrl}/api` : "/api";

