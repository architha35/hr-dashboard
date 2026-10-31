import { useState, useEffect } from "react";
import { API_BASE_URL } from "../api/config";
import EmployeeSearchSelect from "../components/EmployeeSearchSelect";

const WFH = () => {
    const [wfh, setwfh] = useState([]);
    const [selected_employee, set_selected_employee] = useState("");
    const [date, setDate] = useState("");
    const [reason, setReason] = useState("");
    const [tableSearch, setTableSearch] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");

    // Get WFH records
    const getwfh = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/wfh`);
            const data = await response.json();
            setwfh(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error fetching WFH:", error);
        }
    };

    // Load WFH records when page opens
    useEffect(() => {
        getwfh();
    }, []);

    // Add WFH
    const addWfh = async (e) => {
        e.preventDefault();
        setErrorMsg("");

        if (!selected_employee) {
            setErrorMsg("Please select an employee.");
            return;
        }

        if (!date || !reason.trim()) {
            setErrorMsg("Please enter the date and reason.");
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch(`${API_BASE_URL}/create/wfh`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    employee_name: selected_employee,
                    wfh_date: date,
                    reason: reason,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || "Failed to add WFH record");
            }

            set_selected_employee("");
            setDate("");
            setReason("");

            await getwfh();
        } catch (error) {
            console.error("Error adding WFH:", error);
            setErrorMsg(error.message || "Failed to add WFH record.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filter WFH table
    const filteredWfh = wfh.filter((record) =>
        (record.employee_name || "").toLowerCase().includes(tableSearch.toLowerCase()) ||
        (record.reason || "").toLowerCase().includes(tableSearch.toLowerCase())
    );

    return (
        <div className="w-full p-4">
            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Work From Home List
                </h1>
                <p className="mt-2 text-sm text-gray-500">
                    Manage and view employee work-from-home records
                </p>
            </div>

            <div className="mx-auto w-full max-w-6xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                {/* Add WFH Form */}
                <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-600">
                        Record Work From Home
                    </h3>

                    {errorMsg && (
                        <div className="mb-3 rounded-md bg-red-50 p-2.5 text-xs text-red-600">
                            {errorMsg}
                        </div>
                    )}

                    <form onSubmit={addWfh} className="flex flex-wrap items-center gap-3">
                        {/* On-demand Employee Search */}
                        <div className="min-w-[220px] flex-1">
                            <EmployeeSearchSelect
                                selectedEmployee={selected_employee}
                                onSelectEmployee={(name) => set_selected_employee(name)}
                                placeholder="Search employee..."
                                required
                            />
                        </div>

                        {/* WFH date */}
                        <input
                            className="rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />

                        {/* Reason */}
                        <input
                            className="min-w-[200px] flex-1 rounded-md border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Reason (e.g. Health, Personal)"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            required
                        />

                        {/* Add button */}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                        >
                            {isSubmitting ? "Adding..." : "Add WFH"}
                        </button>
                    </form>
                </div>

                {/* Table Header & Filter */}
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="text-lg font-semibold text-gray-800">
                        WFH Records ({filteredWfh.length})
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

                {/* WFH table */}
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full border-collapse text-left">
                        <thead>
                            <tr className="bg-gray-100 text-xs uppercase tracking-wide text-gray-700">
                                <th className="border-b border-gray-200 px-6 py-3.5">ID</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">Employee Name</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">WFH Date</th>
                                <th className="border-b border-gray-200 px-6 py-3.5">Reason</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-gray-100">
                            {filteredWfh.map((record) => (
                                <tr
                                    key={record.id}
                                    className="transition hover:bg-blue-50"
                                >
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {record.id}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm font-medium text-gray-800">
                                        {record.employee_name}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {record.wfh_date
                                            ? String(record.wfh_date).slice(0, 10)
                                            : ""}
                                    </td>
                                    <td className="px-6 py-3.5 text-sm text-gray-600">
                                        {record.reason}
                                    </td>
                                </tr>
                            ))}

                            {filteredWfh.length === 0 && (
                                <tr>
                                    <td
                                        colSpan="4"
                                        className="px-6 py-8 text-center text-sm text-gray-500"
                                    >
                                        No work-from-home records found.
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

export default WFH;