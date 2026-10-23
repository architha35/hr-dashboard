import { useState } from "react";

const Create = () => {
    const [name, setName] = useState("");
    const [department, setDepartment] = useState("");

    const addEmployee = async (e) => {
        e.preventDefault();

        await fetch("/api/create/employee", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ name, department }),
        });

        setName("");
        setDepartment("");
    };

    return (
        <div className="w-full p-4">

            {/* Heading */}
            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Create Employee
                </h1>

                <p className="mt-2 text-sm text-gray-500">
                    Add a new employee to your organization
                </p>
            </div>

            
            <div className="mx-auto w-full max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">

                <form onSubmit={addEmployee} className="space-y-5">

                    
                    <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                            Employee Name
                        </label>

                        <input
                            type="text"
                            placeholder="Enter employee name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            required
                        />
                    </div>

                    
                    <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                            Department
                        </label>

                        <input
                            type="text"
                            placeholder="Enter department"
                            value={department}
                            onChange={(e) => setDepartment(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            required
                        />
                    </div>

                    
                    <div className="pt-2">
                        <button
                            type="submit"
                            className="w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                        >
                            Add Employee
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
};

export default Create;