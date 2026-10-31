import { useState, useEffect } from "react";
import { API_BASE_URL } from "../api/config";
import EmployeeSearchSelect from "../components/EmployeeSearchSelect";

const Leaves = () => {
    const [leaves, setLeaves] = useState([]);
    const [selected_employee, set_selected_employee] = useState("");
    const [date, setDate] = useState("");
    const [type, setType] = useState("");
    const [number, setNumber] = useState("");
    const [tableSearch, setTableSearch] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");

    // Get leaves records
    const getLeaves = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/leaves`);
            const data = await response.json();
            setLeaves(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Error fetching leaves:", err);
        }
    };

    useEffect(() => {
        getLeaves();
    }, []);

    // Add leave record
    const addLeave = async (e) => {
        e.preventDefault();
        setErrorMsg("");

        if (!selected_employee) {
            setErrorMsg("Please select an employee.");
            return;
        }

        if (!date || !type.trim() || !number) {
            setErrorMsg("Please fill in all fields.");
            return;
        }

        setIsSubmitting(true);
        try {
            const resp = await fetch(`${API_BASE_URL}/create/leaves`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    employee_name: selected_employee,
                    leave_date: date,
                    leave_type: type,
                    no_of_leaves: number,
                }),
            });

            if (!resp.ok) {
                const errData = await resp.text();
                throw new Error(errData || "Failed to add leave record");
            }

            // Reset form
            set_selected_employee("");
            setDate("");
            setType("");
            setNumber("");

            await getLeaves();
        } catch (err) {
            console.error("Error adding leave:", err);
            setErrorMsg(err.message || "Failed to add leave.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filter leave records in table
    const filteredLeaves = leaves.filter((leave) =>
        (leave.employee_name || "").toLowerCase().includes(tableSearch.toLowerCase()) ||
        (leave.leave_type || "").toLowerCase().includes(tableSearch.toLowerCase())
    );

    return (
        <div className="w-full p-4">
            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Leaves List
                </h1>
                <p className="mt-2 text-sm text-gray-500">
                    Manage and view employee leave records
                </p>
            </div>

            <div className="mx-auto w-full max-w-6xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                {/* Add Leave Form */}
                <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-600">
                        Record New Leave
                    </h3>

                    {errorMsg && (
                        <div className="mb-3 rounded-md bg-red-50 p-2.5 text-xs text-red-600">
                            {errorMsg}
                        </div>
                    )}

                    <form onSubmit={addLeave} className="flex flex-wrap items-center gap-3">
                        {/* On-demand Employee Search */}
                        <div className="min-w-[220px] flex-1">
                            <EmployeeSearchSelect
                                selectedEmployee={selected_employee}
                                onSelectEmployee={(name) => set_selected_employee(name)}
                                placeholder="Search employee..."
                                required
                            />
                        </div>

                        <input
                            className="rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />

                        <select
                            className="w-36 rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={type || "FULL_DAY"}
                            onChange={(e) => setType(e.target.value)}
                        >
                            <option value="FULL_DAY">Full Day</option>
                            <option value="HALF_DAY">Half Day</option>
                        </select>

                        <input
                            className="w-28 rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            type="number"
                            min="1"
                            step="0.5"
                            placeholder="Days"
                            value={number}
                            onChange={(e) => setNumber(e.target.value)}
                            required
                        />

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? "Adding..." : "Add Leave"}
                        </button>
                    </form>
                </div>

                {/* Leaves Table Header & Filter */}
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="text-lg font-semibold text-gray-800">
                        Leave Records ({filteredLeaves.length})
                    </div>
                    <div>
                        <input
                            type="text"
                            placeholder="Filter table records..."
                            value={tableSearch}
                            onChange={(e) => setTableSearch(e.target.value)}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full border-collapse text-left">
                        <thead>
                            <tr className="bg-gray-100 text-xs uppercase tracking-wide text-gray-700">
                                <th className="border-b border-gray-200 px-6 py-3.5">ID</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">Employee</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">Leave Date</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">Leave Type</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">Days</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-gray-100">
                            {filteredLeaves.map((leave) => (
                                <tr
                                    key={leave.id}
                                    className="transition hover:bg-blue-50"
                                >
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {leave.id}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm font-medium text-gray-800">
                                        {leave.employee_name}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {leave.leave_date
                                            ? String(leave.leave_date).slice(0, 10)
                                            : ""}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                            {leave.leave_type}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {leave.no_of_leaves}
                                    </td>
                                </tr>
                            ))}

                            {filteredLeaves.length === 0 && (
                                <tr>
                                    <td
                                        colSpan="5"
                                        className="px-6 py-8 text-center text-sm text-gray-500"
                                    >
                                        No leave records found.
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

export default Leaves;