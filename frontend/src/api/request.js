import { API_BASE_URL } from "./config";

export const apiFetch = (url, options = {}) => {
    const token = sessionStorage.getItem("hr_dashboard_token");
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers }).then((response) => {
        if (response.status === 401 && !url.endsWith("/auth/login")) {
            sessionStorage.removeItem("hr_dashboard_token");
            window.dispatchEvent(new Event("hr-dashboard-auth-expired"));
        }
        return response;
    });
};

export const login = async (password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to sign in");
    sessionStorage.setItem("hr_dashboard_token", data.token);
};
