import { useState } from "react";
import View from "./pages/View";
import Create from "./pages/Create";
import Leaves from "./pages/Xleaves";
import WFH from "./pages/WFH";
import AgentChat from "./pages/AgentChat";

function App() {
  const [page, setPage] = useState("agent"); // Default to the newly requested AI Agent interface

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