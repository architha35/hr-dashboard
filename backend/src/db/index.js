import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool idle client error:", err.message);
});

// ==========================================
// EMPLOYEE OPERATIONS
// ==========================================

const create_employees = async (data) => {
    const result = await pool.query(
        `INSERT INTO employees (name, department, is_active)
         VALUES ($1, $2, COALESCE($3, true))
         RETURNING *`,
        [data.name, data.department, data.is_active ?? true]
    );
    return result.rows[0];
};

const getById = async (id) => {
    const result = await pool.query(
        `SELECT * FROM employees WHERE id = $1`,
        [id]
    );
    return result.rows[0] || null;
};

const getByName = async (name) => {
    if (!name) return [];
    const result = await pool.query(
        `SELECT * FROM employees WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) ORDER BY id ASC`,
        [name]
    );
    return result.rows;
};

const getAllEmployees = async (options = {}) => {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (options.department) {
        conditions.push(`LOWER(department) = LOWER($${paramIndex++})`);
        params.push(options.department);
    }

    if (options.is_active !== undefined) {
        conditions.push(`is_active = $${paramIndex++}`);
        params.push(options.is_active);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ? `LIMIT $${paramIndex++}` : "";
    if (options.limit) params.push(options.limit);

    const result = await pool.query(
        `SELECT * FROM employees ${whereClause} ORDER BY id ASC ${limit}`,
        params
    );
    return result.rows;
};

const searchEmployees = async (searchTerm, limit = 50) => {
    if (!searchTerm || typeof searchTerm !== "string" || !searchTerm.trim()) {
        return [];
    }

    const trimmed = searchTerm.trim();
    const result = await pool.query(
        `SELECT * FROM employees 
         WHERE name ILIKE $1 OR department ILIKE $1
         ORDER BY name ASC 
         LIMIT $2`,
        [`%${trimmed}%`, limit]
    );

    return result.rows;
};

const update_employee = async (id, updates) => {
    const fields = [];
    const params = [];
    let index = 1;

    if (updates.name !== undefined) {
        fields.push(`name = $${index++}`);
        params.push(updates.name);
    }
    if (updates.department !== undefined) {
        fields.push(`department = $${index++}`);
        params.push(updates.department);
    }
    if (updates.is_active !== undefined) {
        fields.push(`is_active = $${index++}`);
        params.push(updates.is_active);
    }

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const query = `
        UPDATE employees 
        SET ${fields.join(", ")}
        WHERE id = $${index}
        RETURNING *
    `;

    const result = await pool.query(query, params);
    return result.rows[0] || null;
};

const delete_employee = async (id, soft = true) => {
    if (soft) {
        const result = await pool.query(
            `UPDATE employees SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        return result.rows[0] || null;
    } else {
        // Check associated records first
        const emp = await getById(id);
        if (!emp) return null;

        await pool.query(`DELETE FROM leave_records WHERE employee_name = $1 OR employee_id = $2`, [emp.name, id]);
        await pool.query(`DELETE FROM wfh WHERE employee_name = $1`, [emp.name]);
        const result = await pool.query(`DELETE FROM employees WHERE id = $1 RETURNING *`, [id]);
        return result.rows[0] || null;
    }
};

const countEmployees = async (options = {}) => {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (options.department) {
        conditions.push(`LOWER(department) = LOWER($${paramIndex++})`);
        params.push(options.department);
    }
    if (options.is_active !== undefined) {
        conditions.push(`is_active = $${paramIndex++}`);
        params.push(options.is_active);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM employees ${whereClause}`, params);
    return result.rows[0].count;
};

// ==========================================
// LEAVE OPERATIONS
// ==========================================

const create_leaves = async (data) => {
    const normalizedType = (data.leave_type && String(data.leave_type).toUpperCase().includes("HALF"))
        ? "HALF_DAY"
        : "FULL_DAY";

    const result = await pool.query(
        `INSERT INTO leave_records (employee_name, leave_date, leave_type, no_of_leaves, employee_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
            data.employee_name,
            data.leave_date,
            normalizedType,
            data.no_of_leaves || (normalizedType === "HALF_DAY" ? 0.5 : 1),
            data.employee_id || null
        ]
    );
    return result.rows[0];
};

const getLeaveById = async (id) => {
    const result = await pool.query(`SELECT * FROM leave_records WHERE id = $1`, [id]);
    return result.rows[0] || null;
};

const getAllLeaves = async (filters = {}) => {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (filters.employee_name) {
        conditions.push(`LOWER(employee_name) = LOWER($${idx++})`);
        params.push(filters.employee_name.trim());
    }
    if (filters.startDate) {
        conditions.push(`leave_date >= $${idx++}`);
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        conditions.push(`leave_date <= $${idx++}`);
        params.push(filters.endDate);
    }
    if (filters.leave_type) {
        conditions.push(`LOWER(leave_type) = LOWER($${idx++})`);
        params.push(filters.leave_type.trim());
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ? `LIMIT $${idx++}` : "LIMIT 100";
    if (filters.limit) params.push(filters.limit);

    const result = await pool.query(
        `SELECT * FROM leave_records ${where} ORDER BY leave_date DESC, id DESC ${limit}`,
        params
    );
    return result.rows;
};

const update_leave = async (id, updates) => {
    const fields = [];
    const params = [];
    let idx = 1;

    if (updates.leave_date !== undefined) {
        fields.push(`leave_date = $${idx++}`);
        params.push(updates.leave_date);
    }
    if (updates.leave_type !== undefined) {
        fields.push(`leave_type = $${idx++}`);
        params.push(updates.leave_type);
    }
    if (updates.no_of_leaves !== undefined) {
        fields.push(`no_of_leaves = $${idx++}`);
        params.push(updates.no_of_leaves);
    }
    if (updates.employee_name !== undefined) {
        fields.push(`employee_name = $${idx++}`);
        params.push(updates.employee_name);
    }

    if (!fields.length) return await getLeaveById(id);

    params.push(id);
    const result = await pool.query(
        `UPDATE leave_records SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
    );
    return result.rows[0] || null;
};

const delete_leave = async (id) => {
    const result = await pool.query(`DELETE FROM leave_records WHERE id = $1 RETURNING *`, [id]);
    return result.rows[0] || null;
};

const getLeaveSummary = async (filters = {}) => {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (filters.employee_name) {
        conditions.push(`LOWER(employee_name) = LOWER($${idx++})`);
        params.push(filters.employee_name.trim());
    }
    if (filters.startDate) {
        conditions.push(`leave_date >= $${idx++}`);
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        conditions.push(`leave_date <= $${idx++}`);
        params.push(filters.endDate);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Total metrics
    const statsQuery = `
        SELECT 
            COUNT(*)::int AS total_records,
            COALESCE(SUM(no_of_leaves), 0)::numeric AS total_days,
            COUNT(DISTINCT employee_name)::int AS unique_employees
        FROM leave_records
        ${where}
    `;
    const statsResult = await pool.query(statsQuery, params);

    // Top leave requesters
    const topQuery = `
        SELECT 
            employee_name,
            COUNT(*)::int AS records_count,
            COALESCE(SUM(no_of_leaves), 0)::numeric AS total_days
        FROM leave_records
        ${where}
        GROUP BY employee_name
        ORDER BY total_days DESC, records_count DESC
        LIMIT 5
    `;
    const topResult = await pool.query(topQuery, params);

    // Department breakdown if employees table joined
    const deptQuery = `
        SELECT 
            COALESCE(e.department, 'Unassigned') AS department,
            COUNT(l.id)::int AS records_count,
            COALESCE(SUM(l.no_of_leaves), 0)::numeric AS total_days
        FROM leave_records l
        LEFT JOIN employees e ON LOWER(l.employee_name) = LOWER(e.name)
        ${where}
        GROUP BY e.department
        ORDER BY total_days DESC
    `;
    const deptResult = await pool.query(deptQuery, params);

    return {
        total_records: statsResult.rows[0].total_records,
        total_days: Number(statsResult.rows[0].total_days),
        unique_employees: statsResult.rows[0].unique_employees,
        top_employees: topResult.rows,
        department_breakdown: deptResult.rows
    };
};

// ==========================================
// WORK FROM HOME OPERATIONS
// ==========================================

const create_wfh = async (data) => {
    const result = await pool.query(
        `INSERT INTO wfh (employee_name, wfh_date, reason)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [data.employee_name, data.wfh_date, data.reason || ""]
    );
    return result.rows[0];
};

const getWfhById = async (id) => {
    const result = await pool.query(`SELECT * FROM wfh WHERE id = $1`, [id]);
    return result.rows[0] || null;
};

const getAllWfh = async (filters = {}) => {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (filters.employee_name) {
        conditions.push(`LOWER(employee_name) = LOWER($${idx++})`);
        params.push(filters.employee_name.trim());
    }
    if (filters.startDate) {
        conditions.push(`wfh_date >= $${idx++}`);
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        conditions.push(`wfh_date <= $${idx++}`);
        params.push(filters.endDate);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ? `LIMIT $${idx++}` : "LIMIT 100";
    if (filters.limit) params.push(filters.limit);

    const result = await pool.query(
        `SELECT * FROM wfh ${where} ORDER BY wfh_date DESC, id DESC ${limit}`,
        params
    );
    return result.rows;
};

const update_wfh = async (id, updates) => {
    const fields = [];
    const params = [];
    let idx = 1;

    if (updates.wfh_date !== undefined) {
        fields.push(`wfh_date = $${idx++}`);
        params.push(updates.wfh_date);
    }
    if (updates.reason !== undefined) {
        fields.push(`reason = $${idx++}`);
        params.push(updates.reason);
    }
    if (updates.employee_name !== undefined) {
        fields.push(`employee_name = $${idx++}`);
        params.push(updates.employee_name);
    }

    if (!fields.length) return await getWfhById(id);

    params.push(id);
    const result = await pool.query(
        `UPDATE wfh SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
    );
    return result.rows[0] || null;
};

const delete_wfh = async (id) => {
    const result = await pool.query(`DELETE FROM wfh WHERE id = $1 RETURNING *`, [id]);
    return result.rows[0] || null;
};

const getWfhSummary = async (filters = {}) => {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (filters.employee_name) {
        conditions.push(`LOWER(employee_name) = LOWER($${idx++})`);
        params.push(filters.employee_name.trim());
    }
    if (filters.startDate) {
        conditions.push(`wfh_date >= $${idx++}`);
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        conditions.push(`wfh_date <= $${idx++}`);
        params.push(filters.endDate);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // Stats
    const statsQuery = `
        SELECT 
            COUNT(*)::int AS total_records,
            COUNT(DISTINCT employee_name)::int AS unique_employees
        FROM wfh
        ${where}
    `;
    const statsResult = await pool.query(statsQuery, params);

    // Top WFH requesters
    const topQuery = `
        SELECT 
            employee_name,
            COUNT(*)::int AS total_requests
        FROM wfh
        ${where}
        GROUP BY employee_name
        ORDER BY total_requests DESC
        LIMIT 5
    `;
    const topResult = await pool.query(topQuery, params);

    // Department breakdown
    const deptQuery = `
        SELECT 
            COALESCE(e.department, 'Unassigned') AS department,
            COUNT(w.id)::int AS total_requests
        FROM wfh w
        LEFT JOIN employees e ON LOWER(w.employee_name) = LOWER(e.name)
        ${where}
        GROUP BY e.department
        ORDER BY total_requests DESC
    `;
    const deptResult = await pool.query(deptQuery, params);

    return {
        total_records: statsResult.rows[0].total_records,
        unique_employees: statsResult.rows[0].unique_employees,
        top_employees: topResult.rows,
        department_breakdown: deptResult.rows
    };
};

// ==========================================
// HR ANALYTICS OVERVIEW
// ==========================================

const getHrAnalytics = async () => {
    const totalEmployees = await pool.query(`SELECT COUNT(*)::int AS count FROM employees`);
    const activeEmployees = await pool.query(`SELECT COUNT(*)::int AS count FROM employees WHERE is_active = true`);
    const totalLeaves = await pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(no_of_leaves), 0)::numeric AS days FROM leave_records`);
    const totalWfh = await pool.query(`SELECT COUNT(*)::int AS count FROM wfh`);

    const deptCounts = await pool.query(`
        SELECT department, COUNT(*)::int AS employee_count
        FROM employees
        WHERE is_active = true
        GROUP BY department
        ORDER BY employee_count DESC
    `);

    return {
        total_employees: totalEmployees.rows[0].count,
        active_employees: activeEmployees.rows[0].count,
        total_leave_records: totalLeaves.rows[0].count,
        total_leave_days: Number(totalLeaves.rows[0].days),
        total_wfh_requests: totalWfh.rows[0].count,
        departments: deptCounts.rows
    };
};

// ==========================================
// AUDIT LOGGING
// ==========================================

const createAuditLog = async ({ actor = "HR Admin", action, target_table, target_id = null, details = {}, status = "SUCCESS" }) => {
    try {
        const result = await pool.query(
            `INSERT INTO audit_logs (actor, action, target_table, target_id, details, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [actor, action, target_table, target_id, JSON.stringify(details), status]
        );
        return result.rows[0];
    } catch (err) {
        console.error("Failed to write audit log:", err.message);
        return null;
    }
};

export const db_fns = {
    // Employees
    create_employees,
    getById,
    getByName,
    getAllEmployees,
    searchEmployees,
    update_employee,
    delete_employee,
    countEmployees,

    // Leaves
    create_leaves,
    getLeaveById,
    getAllLeaves,
    update_leave,
    delete_leave,
    getLeaveSummary,

    // WFH
    create_wfh,
    getWfhById,
    getAllWfh,
    update_wfh,
    delete_wfh,
    getWfhSummary,

    // Analytics & Audit
    getHrAnalytics,
    createAuditLog,
    pool
};
