import { useEffect, useState } from "react";
import { API_BASE_URL } from "./api/config";
import { login } from "./api/request";
import View from "./pages/View";
import Create from "./pages/Create";
import Leaves from "./pages/Xleaves";
import WFH from "./pages/WFH";
import AgentChat from "./pages/AgentChat";

function App() {
  const [page, setPage] = useState("agent"); // Default to the newly requested AI Agent interface
  const [authenticated, setAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem("hr_dashboard_token");
    if (!token) {
      setAuthChecked(true);
    } else {
      fetch(`${API_BASE_URL}/auth/session`, { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => {
          if (active && response.ok) setAuthenticated(true);
          if (!response.ok) sessionStorage.removeItem("hr_dashboard_token");
        })
        .catch(() => sessionStorage.removeItem("hr_dashboard_token"))
        .finally(() => active && setAuthChecked(true));
    }
    const onExpired = () => setAuthenticated(false);
    window.addEventListener("hr-dashboard-auth-expired", onExpired);
    return () => {
      active = false;
      window.removeEventListener("hr-dashboard-auth-expired", onExpired);
    };
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      await login(password);
      setAuthenticated(true);
      setPassword("");
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoggingIn(false);
    }
  };

  if (!authChecked) {
    return <main className="min-h-screen grid place-items-center bg-gray-100 text-gray-600">Checking sign-in…</main>;
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen grid place-items-center bg-gray-100 px-4 font-sans text-gray-900">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 font-bold text-white">HR</div>
            <div>
              <h1 className="text-xl font-bold">HR PORTAL</h1>
              <p className="text-sm text-gray-500">Admin sign-in</p>
            </div>
          </div>
          <label htmlFor="admin-password" className="mb-2 block text-sm font-medium">Admin password</label>
          <input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          {loginError && <p role="alert" className="mt-3 text-sm text-red-600">{loginError}</p>}
          <button type="submit" disabled={loggingIn} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{loggingIn ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-sans antialiased text-gray-900">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
            HR
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-none">
              HR PORTAL
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Management Dashboard & Agentic AI</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage("agent")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-xs ${
              page === "agent"
                ? "bg-indigo-600 text-white"
                : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
            }`}
          >
            <span>✨ AI Agent</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>
          <button
            onClick={() => { sessionStorage.removeItem("hr_dashboard_token"); setAuthenticated(false); }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-col md:flex-row min-h-[calc(100vh-65px)]">

        {/* Sidebar */}
        <div className="w-full md:w-64 bg-white border-r border-gray-200 p-4 shrink-0">

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">
            Intelligence
          </p>

          <button
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl mb-4 transition font-medium text-sm ${
              page === "agent"
                ? "bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-sm"
                : "text-gray-700 hover:bg-indigo-50/70 hover:text-indigo-900 border border-transparent"
            }`}
            onClick={() => setPage("agent")}
          >
            <span className="flex items-center gap-2.5">
              <span className="text-base">✨</span>
              <span>AI Agent</span>
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
              page === "agent" ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700"
            }`}>
              Live
            </span>
          </button>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">
            Management
          </p>

          <div className="flex flex-row flex-wrap gap-1.5 md:flex-col">

            <button
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                page === "view"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("view")}
            >
              View Employees
            </button>

            <button
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                page === "create"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("create")}
            >
              Create Employee
            </button>

            <button
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                page === "leaves"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("leaves")}
            >
              Leaves Management
            </button>

            <button
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                page === "wfh"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("wfh")}
            >
              Work From Home
            </button>

          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0 p-4 md:p-6 bg-gray-50/50">

          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
              {page === "agent" && "Agentic AI HR Assistant"}
              {page === "view" && "Employees Directory"}
              {page === "create" && "Create Employee"}
              {page === "leaves" && "Leaves Management"}
              {page === "wfh" && "Work From Home"}
            </h2>
          </div>

          <div>
            {page === "agent" && (
              <AgentChat />
            )}

            {page === "view" && (
              <View />
            )}

            {page === "create" && (
              <Create />
            )}

            {page === "leaves" && (
              <Leaves />
            )}

            {page === "wfh" && (
              <WFH />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
