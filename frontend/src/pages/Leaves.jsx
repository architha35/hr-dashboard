import { useState, useEffect } from "react";


const leaves = () => {
    const [leaves, setLeaves] = useState([]);
    const [search, setSearch] = useState("");
    const [employee, setEmployee] = useState("");
    const [date, setDate] = useState("");
    const [type, setType] = useState("");
    const [number, setNumber] = useState("");


// add leave
    const addLeave = async (e) => {
        e.preventDefault();
        console.log(e)
        const resp = await fetch("/api/create/leaves", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ 

            employee_name: employee,
            leave_date: date,

            leave_type: type,

            no_of_leaves: number
            
             })
        });

        console.log('resp',resp)

    setEmployee("");

    setDate("");

    setType("");

    setNumber("");

    getLeaves();
    };




//get leaves
    const getLeaves = async () => {
        const response = await fetch("/api/leaves");
        const data = await response.json();
        setLeaves(data);
    };

    useEffect(() => {
        getLeaves();
    }, []);

    return (
        <div className="w-full p-4">

            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Leaves List
                </h1>
                <p className="mt-2 text-sm text-gray-500">
                    View employee leave records
                </p>
            </div>

            
            <input
                type="text"
                placeholder="Search employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-4 w-full rounded border p-2"
            />

            <div className="mx-auto w-full max-w-6xl overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="mb-4 flex gap-2">
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
        placeholder="Leave Type"
        value={type}
        onChange={(e) => setType(e.target.value)}
    />

    <input
        className="border p-2"
        type="number"
        placeholder="Number of Leaves"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
    />

    <button
        onClick={addLeave}
        className="rounded bg-blue-500 px-4 py-2 text-white"
    >
        Add
    </button>
</div>

                <table className="w-full border-collapse text-left">

                    <thead>
                        <tr className="bg-gray-100 text-sm uppercase tracking-wide text-gray-700">
                            <th className="border-b border-gray-200 px-6 py-4">ID</th>
                            <th className="border-b border-gray-200 px-6 py-4">Employee</th>
                            <th className="border-b border-gray-200 px-6 py-4">Leave Date</th>
                            <th className="border-b border-gray-200 px-6 py-4">Leave Type</th>
                            <th className="border-b border-gray-200 px-6 py-4">Number of Leaves</th>
                        </tr>
                    </thead>

                    <tbody>
                        {leaves
                            .filter((leave) =>
                                leave.employee_name.toLowerCase().includes(search.toLowerCase())
                            )
                            .map((leave) => (
                                <tr
                                    key={leave.id}
                                    className="border-b border-gray-100 hover:bg-blue-50"
                                >
                                    <td className="px-6 py-4 text-sm text-gray-600">{leave.id}</td>
                                    <td className="px-6 py-4 text-sm font-medium text-gray-800">{leave.employee_name}</td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        {leave.leave_date ? leave.leave_date.slice(0, 10) : ""}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{leave.leave_type}</td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{leave.no_of_leaves}</td>
                                </tr>
                            ))}

                        {leaves.filter((leave) =>
                            leave.employee_name.toLowerCase().includes(search.toLowerCase())
                        ).length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-sm text-gray-500">
                                    No leave records found.
                                </td>
                            </tr>
                        )}
                    </tbody>

                </table>
            </div>
        </div>
    );
};

export default leaves;