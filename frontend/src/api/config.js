// API configuration
// When running locally via Vite, requests to /api are proxied to the backend at http://localhost:4000
// When VITE_API_URL is provided in environment variables, it uses that URL.
export const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
