import { useEffect, useState } from "react";

const View = () => {
    const [employees, setEmployees] = useState([]);

    const getEmployees = async () => {
        const response = await fetch("https://hr-dashboard-1-i7m5.onrender.com/api/employees");
        const data = await response.json();
        console.log(data);
        setEmployees(data);
    };

    useEffect(() => {
        getEmployees();
    }, []);

    return (
        <div className="w-full p-4">

            {/* Heading */}
            <div className="mb-6 text-center">
                <h1 className="text-2xl font-bold text-gray-800">
                    Employees List
                </h1>

                <p className="mt-2 text-sm text-gray-500">
                    View all employees in your organization
                </p>
            </div>

            {/* Table Container */}
            <div className="mx-auto w-full max-w-6xl overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">

                <table className="w-full border-collapse text-left">

                    {/* Table Head */}
                    <thead>
                        <tr className="bg-gray-100 text-sm uppercase tracking-wide text-gray-700">
                            <th className="border-b border-gray-200 px-6 py-4">
                                ID
                            </th>

                            <th className="border-b border-gray-200 px-6 py-4">
                                Employee Name
                            </th>

                            <th className="border-b border-gray-200 px-6 py-4">
                                Department
                            </th>
                        </tr>
                    </thead>

                    {/* Table Body */}
                    <tbody>
                        {employees.map((employee) => (
                            <tr
                                key={employee.id}
                                className="border-b border-gray-100 transition hover:bg-blue-50"
                            >
                                <td className="px-6 py-4 text-sm text-gray-600">
                                    {employee.id}
                                </td>

                                <td className="px-6 py-4 text-sm font-medium text-gray-800">
                                    {employee.name}
                                </td>

                                <td className="px-6 py-4 text-sm text-gray-600">
                                    {employee.department}
                                </td>
                            </tr>
                        ))}

                        {employees.length === 0 && (
                            <tr>
                                <td
                                    colSpan="3"
                                    className="px-6 py-8 text-center text-sm text-gray-500"
                                >
                                    No employees found.
                                </td>
                            </tr>
                        )}
                    </tbody>

                </table>
            </div>
        </div>
    );
};

export default View;