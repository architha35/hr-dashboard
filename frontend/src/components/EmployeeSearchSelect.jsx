import { useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "../api/config";

const EmployeeSearchSelect = ({
    selectedEmployee,
    onSelectEmployee,
    placeholder = "Search employee (e.g. Architha)...",
    className = "",
    required = false,
}) => {
    const [searchQuery, setSearchQuery] = useState(selectedEmployee || "");
    const [results, setResults] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const containerRef = useRef(null);
    const abortControllerRef = useRef(null);

    // Synchronize local input with selectedEmployee prop if updated externally
    useEffect(() => {
        setSearchQuery(selectedEmployee || "");
    }, [selectedEmployee]);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    // Perform debounced search on backend on demand
    useEffect(() => {
        const trimmed = searchQuery.trim();

        // If the query is empty or matches the currently selected employee, don't re-query
        if (!trimmed) {
            const clearTimer = setTimeout(() => {
                setResults([]);
                setIsOpen(false);
                setIsLoading(false);
                setHasSearched(false);
            }, 0);
            return () => clearTimeout(clearTimer);
        }

        if (trimmed === selectedEmployee) {
            return;
        }

        setIsLoading(true);
        setIsOpen(true);

        // Cancel previous pending request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const timer = setTimeout(async () => {
            try {
                const response = await fetch(
                    `${API_BASE_URL}/employees/search?q=${encodeURIComponent(trimmed)}`,
                    { signal: controller.signal }
                );

                if (!response.ok) {
                    throw new Error("Failed to search employees");
                }

                const data = await response.json();
                setResults(Array.isArray(data) ? data : []);
                setHasSearched(true);
            } catch (err) {
                if (err.name !== "AbortError") {
                    console.error("Employee search error:", err);
                    setResults([]);
                }
            } finally {
                setIsLoading(false);
            }
        }, 250);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [searchQuery, selectedEmployee]);

    const handleSelect = (emp) => {
        setSearchQuery(emp.name);
        setIsOpen(false);
        setResults([]);
        setHasSearched(false);
        onSelectEmployee(emp.name, emp);
    };

    const handleClear = () => {
        setSearchQuery("");
        setResults([]);
        setIsOpen(false);
        setHasSearched(false);
        onSelectEmployee("", null);
    };

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <div className="relative flex items-center">
                <input
                    type="text"
                    required={required}
                    className="w-full rounded-md border border-gray-300 p-2 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder={placeholder}
                    value={searchQuery}
                    onFocus={() => {
                        if (results.length > 0) {
                            setIsOpen(true);
                        }
                    }}
                    onChange={(e) => {
                        const val = e.target.value;
                        setSearchQuery(val);
                        if (val !== selectedEmployee) {
                            onSelectEmployee("", null);
                        }
                    }}
                />

                {isLoading ? (
                    <div className="absolute right-2.5 flex items-center">
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
                ) : searchQuery ? (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="absolute right-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
                        title="Clear"
                    >
                        ✕
                    </button>
                ) : null}
            </div>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {isLoading && (
                        <div className="p-3 text-center text-xs text-gray-500">
                            Searching database...
                        </div>
                    )}

                    {!isLoading && results.length > 0 && (
                        <ul className="divide-y divide-gray-100">
                            {results.map((emp) => (
                                <li
                                    key={emp.id}
                                    onClick={() => handleSelect(emp)}
                                    className="flex cursor-pointer items-center justify-between p-2.5 transition hover:bg-blue-50"
                                >
                                    <span className="text-sm font-medium text-gray-800">
                                        {emp.name}
                                    </span>
                                    {emp.department && (
                                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                            {emp.department}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {!isLoading && hasSearched && results.length === 0 && (
                        <div className="p-3 text-center text-xs text-gray-500">
                            No matching employees found in database.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default EmployeeSearchSelect;
