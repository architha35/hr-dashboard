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

    if (filters.employee_id && filters.employee_name) {
        const employeeIdIndex = idx++;
        const employeeNameIndex = idx++;
        conditions.push(`(employee_id = $${employeeIdIndex} OR (employee_id IS NULL AND LOWER(TRIM(employee_name)) = LOWER(TRIM($${employeeNameIndex})) AND NOT EXISTS (
            SELECT 1 FROM employees same_name
            WHERE same_name.id <> $${employeeIdIndex} AND LOWER(TRIM(same_name.name)) = LOWER(TRIM($${employeeNameIndex}))
        )))`);
        params.push(Number(filters.employee_id), filters.employee_name.trim());
    } else if (filters.employee_id) {
        conditions.push(`employee_id = $${idx++}`);
        params.push(Number(filters.employee_id));
    } else if (filters.employee_name) {
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

    if (filters.employee_id && filters.employee_name) {
        const employeeIdIndex = idx++;
        const employeeNameIndex = idx++;
        conditions.push(`(employee_id = $${employeeIdIndex} OR (employee_id IS NULL AND LOWER(TRIM(employee_name)) = LOWER(TRIM($${employeeNameIndex})) AND NOT EXISTS (
            SELECT 1 FROM employees same_name
            WHERE same_name.id <> $${employeeIdIndex} AND LOWER(TRIM(same_name.name)) = LOWER(TRIM($${employeeNameIndex}))
        )))`);
        params.push(Number(filters.employee_id), filters.employee_name.trim());
    } else if (filters.employee_id) {
        conditions.push(`employee_id = $${idx++}`);
        params.push(Number(filters.employee_id));
    } else if (filters.employee_name) {
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
            CASE
                WHEN l.employee_id IS NULL AND (SELECT COUNT(*) FROM employees same_name WHERE LOWER(TRIM(same_name.name)) = LOWER(TRIM(l.employee_name))) > 1 THEN 'Ambiguous'
                ELSE COALESCE(e.department, 'Unassigned')
            END AS department,
            COUNT(l.id)::int AS records_count,
            COALESCE(SUM(l.no_of_leaves), 0)::numeric AS total_days
        FROM leave_records l
        LEFT JOIN employees e ON (l.employee_id IS NOT NULL AND e.id = l.employee_id)
            OR (l.employee_id IS NULL AND LOWER(TRIM(l.employee_name)) = LOWER(TRIM(e.name))
                AND (SELECT COUNT(*) FROM employees same_name WHERE LOWER(TRIM(same_name.name)) = LOWER(TRIM(l.employee_name))) = 1)
        ${where}
        GROUP BY 1
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
        WITH employee_departments AS (
            SELECT LOWER(TRIM(name)) AS employee_key,
                   CASE WHEN COUNT(DISTINCT department) = 1 THEN MIN(department) ELSE 'Ambiguous' END AS department
            FROM employees
            GROUP BY LOWER(TRIM(name))
        )
        SELECT 
            COALESCE(e.department, 'Unassigned') AS department,
            COUNT(w.id)::int AS total_requests
        FROM wfh w
        LEFT JOIN employee_departments e ON LOWER(TRIM(w.employee_name)) = e.employee_key
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
// DEPARTMENT LEAVE COMPARISON
// ==========================================

const getDepartmentLeaveStats = async (filters = {}) => {
    const params = [];
    const dateConditions = [];
    if (filters.startDate) {
        params.push(filters.startDate);
        dateConditions.push(`l.leave_date >= $${params.length}`);
    }
    if (filters.endDate) {
        params.push(filters.endDate);
        dateConditions.push(`l.leave_date <= $${params.length}`);
    }
    const leavesQuery = `
        SELECT
            e.department AS department,
            COUNT(DISTINCT e.id)::int AS employee_count,
            COUNT(l.id)::int AS records_count,
            COALESCE(SUM(l.no_of_leaves), 0)::numeric AS total_days
        FROM employees e
        LEFT JOIN leave_records l ON (
            (l.employee_id IS NOT NULL AND l.employee_id = e.id)
            OR (l.employee_id IS NULL AND LOWER(TRIM(l.employee_name)) = LOWER(TRIM(e.name))
                AND (SELECT COUNT(*) FROM employees same_name WHERE LOWER(TRIM(same_name.name)) = LOWER(TRIM(l.employee_name))) = 1)
        )${dateConditions.length ? ` AND ${dateConditions.join(" AND ")}` : ""}
        GROUP BY e.department
        ORDER BY total_days DESC, employee_count DESC
    `;

    const leavesResult = await pool.query(leavesQuery, params);
    const departments = leavesResult.rows.map((row) => {
        const employeeCount = Number(row.employee_count) || 0;
        const totalDays = Number(row.total_days) || 0;
        return {
            department: row.department,
            employee_count: employeeCount,
            records_count: Number(row.records_count) || 0,
            total_days: totalDays,
            avg_leave_days_per_employee: employeeCount > 0 ? totalDays / employeeCount : 0
        };
    });

    const unmappedQuery = `
        SELECT
            CASE WHEN l.employee_id IS NULL AND EXISTS (
                SELECT 1 FROM employees e WHERE LOWER(TRIM(e.name)) = LOWER(TRIM(l.employee_name))
            ) THEN 'Ambiguous' ELSE 'Unassigned' END AS department,
            COUNT(*)::int AS records_count,
            COALESCE(SUM(l.no_of_leaves), 0)::numeric AS total_days
        FROM leave_records l
        WHERE NOT EXISTS (
            SELECT 1 FROM employees e
            WHERE (l.employee_id IS NOT NULL AND e.id = l.employee_id)
               OR (l.employee_id IS NULL AND LOWER(TRIM(l.employee_name)) = LOWER(TRIM(e.name))
                   AND (SELECT COUNT(*) FROM employees same_name WHERE LOWER(TRIM(same_name.name)) = LOWER(TRIM(l.employee_name))) = 1)
        )${dateConditions.length ? ` AND ${dateConditions.join(" AND ")}` : ""}
        GROUP BY 1
    `;
    const unmappedResult = await pool.query(unmappedQuery, params);
    for (const row of unmappedResult.rows) {
        departments.push({
            department: row.department,
            employee_count: 0,
            records_count: Number(row.records_count) || 0,
            total_days: Number(row.total_days) || 0,
            avg_leave_days_per_employee: 0
        });
    }

    return { departments };
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
    getDepartmentLeaveStats,
    createAuditLog,
    pool
};
