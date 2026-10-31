import { useEffect, useState, useRef } from "react";
import { API_BASE_URL } from "../api/config";

const View = () => {
    const [employees, setEmployees] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const abortControllerRef = useRef(null);

    const fetchEmployees = async (search = "") => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsLoading(true);
        setError(null);

        try {
            const url = search.trim()
                ? `${API_BASE_URL}/employees/search?q=${encodeURIComponent(search.trim())}`
                : `${API_BASE_URL}/employees`;

            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error("Failed to load employees");
            }

            const data = await response.json();
            setEmployees(Array.isArray(data) ? data : []);
        } catch (err) {
            if (err.name !== "AbortError") {
                console.error("Error loading employees:", err);
                setError(err.message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    // Debounce search on backend
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchEmployees(searchTerm);
        }, 250);

        return () => clearTimeout(timer);
    }, [searchTerm]);

    return (
        <div className="w-full p-4">
            {/* Heading */}
            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Employees List
                </h1>
                <p className="mt-2 text-sm text-gray-500">
                    Search and view employees from the database
                </p>
            </div>

            {/* Container */}
            <div className="mx-auto w-full max-w-6xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                {/* Search Bar */}
                <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="relative w-full max-w-md">
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search employee by name (e.g. ARCN, Architha)..."
                            className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-9 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        {/* Search Icon */}
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <svg
                                className="h-4 w-4 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="2"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                />
                            </svg>
                        </div>

                        {/* Loading spinner or clear button */}
                        {isLoading ? (
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                <svg
                                    className="h-4 w-4 animate-spin text-blue-500"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                >
                                    <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                    ></circle>
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                    ></path>
                                </svg>
                            </div>
                        ) : searchTerm ? (
                            <button
                                type="button"
                                onClick={() => setSearchTerm("")}
                                className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-gray-400 hover:text-gray-600"
                            >
                                ✕
                            </button>
                        ) : null}
                    </div>

                    <div className="text-sm text-gray-500">
                        {searchTerm.trim() ? (
                            <span>
                                Matching results: <strong className="text-gray-700">{employees.length}</strong>
                            </span>
                        ) : (
                            <span>
                                Total shown: <strong className="text-gray-700">{employees.length}</strong>
                            </span>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
                        {error}
                    </div>
                )}

                {/* Table Container */}
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full border-collapse text-left">
                        {/* Table Head */}
                        <thead>
                            <tr className="bg-gray-100 text-xs uppercase tracking-wide text-gray-700">
                                <th className="border-b border-gray-200 px-6 py-3.5">
                                    ID
                                </th>
                                <th className="border-b border-gray-200 px-6 py-3.5">
                                    Employee Name
                                </th>
                                <th className="border-b border-gray-200 px-6 py-3.5">
                                    Department
                                </th>
                            </tr>
                        </thead>

                        {/* Table Body */}
                        <tbody className="divide-y divide-gray-100">
                            {employees.map((employee) => (
                                <tr
                                    key={employee.id}
                                    className="transition hover:bg-blue-50"
                                >
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {employee.id}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm font-medium text-gray-800">
                                        {employee.name}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                            {employee.department || "N/A"}
                                        </span>
                                    </td>
                                </tr>
                            ))}

                            {!isLoading && employees.length === 0 && (
                                <tr>
                                    <td
                                        colSpan="3"
                                        className="px-6 py-8 text-center text-sm text-gray-500"
                                    >
                                        {searchTerm.trim()
                                            ? `No employees found matching "${searchTerm}".`
                                            : "No employees found."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default View;