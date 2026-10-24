import { useState, useEffect } from "react";

const BASE_URL = "https://hr-dashboard-5.onrender.com/api"


const WFH = () => {
    const [wfh, setwfh] = useState([]);
    const [search, setSearch] = useState("");
    const [employee, setEmployee] = useState("");
    const [date, setDate] = useState("");
    const [reason, setReason] = useState("");

    // add WFH
    const addWfh = async (e) => {
        e.preventDefault();

         const url = BASE_URL + "/create/wfh"

        const resp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                employee_name: employee,
                wfh_date: date,
                reason: reason
            })
        });

        console.log("resp", resp);

        setEmployee("");
        setDate("");
        setReason("");

        getwfh();
    };

    // get WFH
    const getwfh = async () => {
        const url = BASE_URL + "/wfh"
        const response = await fetch(
    url
);
        const data = await response.json();
        setwfh(data);
    };

    useEffect(() => {
        getwfh();
    }, []);

    return (
        <div className="w-full p-4">

            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Work From Home List
                </h1>
                <p className="mt-2 text-sm text-gray-500">
                    View employee work-from-home records
                </p>
            </div>

            {/* Search Bar */}
            <input
                type="text"
                placeholder="Search employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-4 w-full rounded border p-2"
            />

            <div className="mx-auto w-full max-w-6xl overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">

                {/* Add WFH */}
                <div className="mb-4 flex flex-wrap gap-2">
                    <input
                        className="border p-2"
                        placeholder="Employee Name"
                        value={employee}
                        onChange={(e) => setEmployee(e.target.value)}
                    />

                    <input
                        className="border p-2"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />

                    <input
                        className="border p-2"
                        placeholder="Reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                    />

                    <button
                        onClick={addWfh}
                        className="rounded bg-blue-500 px-4 py-2 text-white"
                    >
                        Add
                    </button>
                </div>

                <table className="w-full border-collapse text-left">

                    <thead>
                        <tr className="bg-gray-100 text-sm uppercase tracking-wide text-gray-700">
                            <th className="border-b border-gray-200 px-6 py-4">ID</th>
                            <th className="border-b border-gray-200 px-6 py-4">Employee Name</th>
                            <th className="border-b border-gray-200 px-6 py-4">WFH Date</th>
                            <th className="border-b border-gray-200 px-6 py-4">Reason</th>
                        </tr>
                    </thead>

                    <tbody>
                        {wfh
                            .filter((record) =>
                                record.employee_name.toLowerCase().includes(search.toLowerCase())
                            )
                            .map((record) => (
                                <tr
                                    key={record.id}
                                    className="border-b border-gray-100 hover:bg-blue-50"
                                >
                                    <td className="px-6 py-4 text-sm text-gray-600">{record.id}</td>
                                    <td className="px-6 py-4 text-sm font-medium text-gray-800">{record.employee_name}</td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {record.wfh_date ? String(record.wfh_date).slice(0, 10) : ""}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{record.reason}</td>
                                </tr>
                            ))}

                        {wfh.filter((record) =>
                            record.employee_name.toLowerCase().includes(search.toLowerCase())
                        ).length === 0 && (
                            <tr>
                                <td colSpan="4" className="px-6 py-8 text-center text-sm text-gray-500">
                                    No work-from-home records found.
                                </td>
                            </tr>
                        )}
                    </tbody>

                </table>
            </div>
        </div>
    );
};

export default WFH;