const { db_fns } = require("../db");

/**
 * Predefined Agent Tools
 * Validated, typed, safe database operations with audit logging
 */

const tools = {
    // ----------------------------------------
    // EMPLOYEE TOOLS
    // ----------------------------------------
    search_employees: async ({ query, limit = 20 }) => {
        if (!query || typeof query !== "string") return [];
        return await db_fns.searchEmployees(query, limit);
    },

    get_employee_by_id: async ({ id }) => {
        if (!id) throw new Error("Employee ID is required");
        const emp = await db_fns.getById(id);
        if (!emp) throw new Error(`Employee with ID ${id} not found`);
        return emp;
    },

    get_employee_by_name: async ({ name }) => {
        if (!name) throw new Error("Employee name is required");
        return await db_fns.getByName(name);
    },

    get_all_employees: async ({ department, is_active, limit = 50 } = {}) => {
        return await db_fns.getAllEmployees({ department, is_active, limit });
    },

    create_employee: async ({ name, department, is_active = true }) => {
        if (!name || !name.trim()) throw new Error("Employee name is required");
        if (!department || !department.trim()) throw new Error("Department is required");

        const emp = await db_fns.create_employees({
            name: name.trim(),
            department: department.trim(),
            is_active
        });

        await db_fns.createAuditLog({
            action: "CREATE_EMPLOYEE",
            target_table: "employees",
            target_id: emp.id,
            details: { name: emp.name, department: emp.department }
        });

        return emp;
    },

    update_employee: async ({ id, name, department, is_active }) => {
        if (!id) throw new Error("Employee ID is required for update");
        const existing = await db_fns.getById(id);
        if (!existing) throw new Error(`Employee with ID ${id} not found`);

        const updates = {};
        if (name !== undefined) updates.name = name.trim();
        if (department !== undefined) updates.department = department.trim();
        if (is_active !== undefined) updates.is_active = is_active;

        const updated = await db_fns.update_employee(id, updates);

        await db_fns.createAuditLog({
            action: "UPDATE_EMPLOYEE",
            target_table: "employees",
            target_id: id,
            details: { before: existing, after: updated }
        });

        return updated;
    },

    delete_employee: async ({ id, soft = true }) => {
        if (!id) throw new Error("Employee ID is required for deletion");
        const existing = await db_fns.getById(id);
        if (!existing) throw new Error(`Employee with ID ${id} not found`);

        const deleted = await db_fns.delete_employee(id, soft);

        await db_fns.createAuditLog({
            action: soft ? "DEACTIVATE_EMPLOYEE" : "DELETE_EMPLOYEE",
            target_table: "employees",
            target_id: id,
            details: { employee: existing, soft }
        });

        return deleted;
    },

    // ----------------------------------------
    // LEAVE TOOLS
    // ----------------------------------------
    get_leave_records: async ({ employee_name, startDate, endDate, leave_type, limit = 50 } = {}) => {
        return await db_fns.getAllLeaves({ employee_name, startDate, endDate, leave_type, limit });
    },

    get_leave_summary: async ({ employee_name, startDate, endDate } = {}) => {
        return await db_fns.getLeaveSummary({ employee_name, startDate, endDate });
    },

    create_leave: async ({ employee_name, leave_date, leave_type = "FULL_DAY", no_of_leaves = 1, employee_id = null }) => {
        if (!employee_name) throw new Error("Employee name is required");
        if (!leave_date) throw new Error("Leave date is required");

        // Attempt resolving employee_id if not supplied
        let empId = employee_id;
        if (!empId) {
            const matches = await db_fns.getByName(employee_name);
            if (matches.length > 0) empId = matches[0].id;
        }

        const leave = await db_fns.create_leaves({
            employee_name: employee_name.trim(),
            leave_date,
            leave_type,
            no_of_leaves: Number(no_of_leaves),
            employee_id: empId
        });

        await db_fns.createAuditLog({
            action: "CREATE_LEAVE",
            target_table: "leave_records",
            target_id: leave.id,
            details: leave
        });

        return leave;
    },

    create_leave_range: async ({ employee_name, startDate, endDate, leave_type = "FULL_DAY", no_of_leaves_per_day = 1 }) => {
        if (!employee_name) throw new Error("Employee name is required");
        if (!startDate || !endDate) throw new Error("Start date and end date are required");

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new Error("Invalid date format. Please use YYYY-MM-DD.");
        }
        if (start > end) {
            throw new Error("Start date cannot be after end date.");
        }

        const matches = await db_fns.getByName(employee_name);
        const empId = matches.length > 0 ? matches[0].id : null;

        const createdRecords = [];
        const current = new Date(start);

        while (current <= end) {
            // ISO date string YYYY-MM-DD
            const dateStr = current.toISOString().slice(0, 10);
            const record = await db_fns.create_leaves({
                employee_name: employee_name.trim(),
                leave_date: dateStr,
                leave_type,
                no_of_leaves: no_of_leaves_per_day,
                employee_id: empId
            });
            createdRecords.push(record);
            current.setDate(current.getDate() + 1);
        }

        await db_fns.createAuditLog({
            action: "CREATE_LEAVE_RANGE",
            target_table: "leave_records",
            target_id: createdRecords[0]?.id,
            details: { employee_name, startDate, endDate, recordsCount: createdRecords.length }
        });

        return createdRecords;
    },

    update_leave: async ({ id, leave_date, leave_type, no_of_leaves, employee_name }) => {
        if (!id) throw new Error("Leave record ID is required");
        const existing = await db_fns.getLeaveById(id);
        if (!existing) throw new Error(`Leave record ID ${id} not found`);

        const updated = await db_fns.update_leave(id, {
            leave_date,
            leave_type,
            no_of_leaves,
            employee_name
        });

        await db_fns.createAuditLog({
            action: "UPDATE_LEAVE",
            target_table: "leave_records",
            target_id: id,
            details: { before: existing, after: updated }
        });

        return updated;
    },

    delete_leave: async ({ id }) => {
        if (!id) throw new Error("Leave record ID is required");
        const existing = await db_fns.getLeaveById(id);
        if (!existing) throw new Error(`Leave record ID ${id} not found`);

        const deleted = await db_fns.delete_leave(id);

        await db_fns.createAuditLog({
            action: "DELETE_LEAVE",
            target_table: "leave_records",
            target_id: id,
            details: existing
        });

        return deleted;
    },

    // ----------------------------------------
    // WORK FROM HOME TOOLS
    // ----------------------------------------
    get_wfh_records: async ({ employee_name, startDate, endDate, limit = 50 } = {}) => {
        return await db_fns.getAllWfh({ employee_name, startDate, endDate, limit });
    },

    get_wfh_summary: async ({ employee_name, startDate, endDate } = {}) => {
        return await db_fns.getWfhSummary({ employee_name, startDate, endDate });
    },

    create_wfh: async ({ employee_name, wfh_date, reason }) => {
        if (!employee_name) throw new Error("Employee name is required");
        if (!wfh_date) throw new Error("WFH date is required");

        const record = await db_fns.create_wfh({
            employee_name: employee_name.trim(),
            wfh_date,
            reason: reason || "Remote work"
        });

        await db_fns.createAuditLog({
            action: "CREATE_WFH",
            target_table: "wfh",
            target_id: record.id,
            details: record
        });

        return record;
    },

    update_wfh: async ({ id, wfh_date, reason, employee_name }) => {
        if (!id) throw new Error("WFH record ID is required");
        const existing = await db_fns.getWfhById(id);
        if (!existing) throw new Error(`WFH record ID ${id} not found`);

        const updated = await db_fns.update_wfh(id, {
            wfh_date,
            reason,
            employee_name
        });

        await db_fns.createAuditLog({
            action: "UPDATE_WFH",
            target_table: "wfh",
            target_id: id,
            details: { before: existing, after: updated }
        });

        return updated;
    },

    delete_wfh: async ({ id }) => {
        if (!id) throw new Error("WFH record ID is required");
        const existing = await db_fns.getWfhById(id);
        if (!existing) throw new Error(`WFH record ID ${id} not found`);

        const deleted = await db_fns.delete_wfh(id);

        await db_fns.createAuditLog({
            action: "DELETE_WFH",
            target_table: "wfh",
            target_id: id,
            details: existing
        });

        return deleted;
    },

    // ----------------------------------------
    // ANALYTICS TOOLS
    // ----------------------------------------
    get_hr_analytics: async () => {
        return await db_fns.getHrAnalytics();
    }
};

module.exports = { tools };
