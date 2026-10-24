import { useState } from "react";
import View from "./pages/View";
import Create from "./pages/Create";
import leaves from "./pages/leaves";
import WFH from "./pages/WFH";

function App() {
  const [page, setPage] = useState("view");

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-800">
          HR PORTAL
        </h1>
      </header>

      {/* Main Layout */}
      <div className="flex flex-col md:flex-row min-h-screen">

        {/* Sidebar */}
        <div className="w-full md:w-60 bg-white border-r border-gray-200 p-4">

          <p className="text-xs font-semibold text-gray-400 uppercase mb-4">
            Menu
          </p>

          <div className="flex flex-row flex-wrap gap-2 md:flex-col">

            <button
              className={`w-full text-left px-4 py-3 rounded-lg transition ${
                page === "view"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("view")}
            >
              View Employees
            </button>

            <button
              className={`w-full text-left px-4 py-3 rounded-lg transition ${
                page === "create"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("create")}
            >
              Create Employee
            </button>

            <button
              className={`w-full text-left px-4 py-3 rounded-lg transition ${
                page === "leaves"
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              onClick={() => setPage("leaves")}
            >
              Leaves
            </button>

            <button
              className={`w-full text-left px-4 py-3 rounded-lg transition ${
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
        <div className="flex-1 min-w-0 p-4 md:p-6">

          <div className="mb-5">
            <h2 className="text-xl font-semibold text-gray-800">
              {page === "view" && "Employees"}
              {page === "create" && "Create Employee"}
              {page === "leaves" && "Leaves"}
              {page === "wfh" && "Work From Home"}
            </h2>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 md:p-6 shadow-sm">

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