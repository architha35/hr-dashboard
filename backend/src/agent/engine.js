const { GoogleGenAI } = require("@google/genai");
const { tools } = require("./tools");
const { db_fns } = require("../db");

// ============================================================
// GEMINI CLIENT SETUP
// ============================================================

const GEMINI_API_KEY = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").replace(/[" ]/g, "");
const GEMINI_MODEL = "gemini-3-flash-preview";

let genAI = null;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} else {
    console.warn("[Agent] GEMINI_API_KEY not set — using rule-based fallback.");
}

// ============================================================
// SESSION STORE
// ============================================================

const sessions = new Map();

const SESSION_IDLE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const getSession = (sessionId = "default") => {
    let session = sessions.get(sessionId);
    const now = Date.now();

    if (session && session.lastActivity && now - session.lastActivity > SESSION_IDLE_LIMIT_MS) {
        // Drop conversations that have been idle for too long
        sessions.delete(sessionId);
        session = undefined;
    }

    if (!session) {
        session = {
            id: sessionId,
            history: [],
            context: {
                activeEmployee: null,
                activeDepartment: null,
                activeTimeframe: null,
                lastTopic: null,
                lastResults: null,
                lastResultType: null,
                employeeGroup: null,
            },
            pendingProposal: null,
            lastActivity: now,
        };
        sessions.set(sessionId, session);
    }

    session.lastActivity = now;
    return session;
};

// ============================================================
// DATE UTILITIES
// ============================================================

const getToday = () => {
    const now = new Date();
    if (now.getFullYear() < 2026) return new Date("2026-11-01T12:00:00Z");
    return now;
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const parseTimeframe = (text) => {
    const today = getToday();
    const Y = today.getFullYear();
    const M = today.getMonth();

    if (/this\s+month/i.test(text)) {
        return { label: "this month", startDate: formatDate(new Date(Date.UTC(Y, M, 1))), endDate: formatDate(new Date(Date.UTC(Y, M + 1, 0))) };
    }
    if (/last\s+month/i.test(text)) {
        return { label: "last month", startDate: formatDate(new Date(Date.UTC(Y, M - 1, 1))), endDate: formatDate(new Date(Date.UTC(Y, M, 0))) };
    }
    const lastMonthsMatch = text.match(/last\s+(\d+|one|two|three|four|five|six)\s+months?/i);
    if (lastMonthsMatch) {
        const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
        const count = words[lastMonthsMatch[1].toLowerCase()] || parseInt(lastMonthsMatch[1], 10) || 3;
        return { label: `last ${count} months`, startDate: formatDate(new Date(Date.UTC(Y, M - count, 1))), endDate: formatDate(new Date(Date.UTC(Y, M + 1, 0))) };
    }
    if (/this\s+year/i.test(text)) return { label: "this year", startDate: `${Y}-01-01`, endDate: `${Y}-12-31` };
    if (/this\s+week/i.test(text)) {
        const dow = today.getDay();
        const start = new Date(today); start.setDate(today.getDate() - dow);
        const end = new Date(start); end.setDate(start.getDate() + 6);
        return { label: "this week", startDate: formatDate(start), endDate: formatDate(end) };
    }
    const rangeMatch = text.match(/(?:from|between)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(?:to|and)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)?/i);
    if (rangeMatch) {
        const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
        const m1 = months.findIndex(n => rangeMatch[2].toLowerCase().startsWith(n));
        const m2 = rangeMatch[4] ? months.findIndex(n => rangeMatch[4].toLowerCase().startsWith(n)) : m1;
        const start = new Date(Date.UTC(Y, m1 !== -1 ? m1 : M, parseInt(rangeMatch[1], 10)));
        const end   = new Date(Date.UTC(Y, m2 !== -1 ? m2 : M, parseInt(rangeMatch[3], 10)));
        if (!isNaN(start) && !isNaN(end)) {
            const daysCount = Math.max(Math.round((end - start) / 86400000) + 1, 1);
            return { label: `${rangeMatch[1]} ${rangeMatch[2]} to ${rangeMatch[3]} ${rangeMatch[4] || rangeMatch[2]} ${Y}`, startDate: formatDate(start), endDate: formatDate(end), daysCount };
        }
    }
    const singleMatch = text.match(/(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (singleMatch) {
        const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
        const mi = months.findIndex(n => singleMatch[2].toLowerCase().startsWith(n));
        if (mi !== -1) {
            const d = new Date(Date.UTC(Y, mi, parseInt(singleMatch[1], 10)));
            return { label: `${singleMatch[1]} ${singleMatch[2]} ${Y}`, date: formatDate(d), startDate: formatDate(d), endDate: formatDate(d) };
        }
    }
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) return { label: isoMatch[1], date: isoMatch[1], startDate: isoMatch[1], endDate: isoMatch[1] };
    return null;
};

const isValidDateString = (value) => {
    if (typeof value !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !isNaN(parsed.getTime());
};

// ============================================================
// TOOL SCHEMAS FOR GEMINI FUNCTION CALLING
// ============================================================

const TOOL_SCHEMAS = [
    {
        name: "search_employees",
        description: "Search for employees by name or department. Use for listing employees, finding employees in a department, or filtering by active status. Returns employee list.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search term (name or department substring)" },
                department: { type: "string", description: "Filter by exact department name" },
                is_active: { type: "boolean", description: "Filter by active status. Omit for all." },
                limit: { type: "number", description: "Max results (default 50)" }
            },
            required: []
        }
    },
    {
        name: "get_leave_summary",
        description: "Get leave statistics: total days, records count, top leave-takers ranked, department breakdown. Use for 'who took most leaves', 'leave totals', 'leave breakdown'.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string", description: "Filter by specific employee name" },
                employee_names: { type: "array", items: { type: "string" }, description: "Filter by a group of employee names (for follow-ups like 'among them')" },
                startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
                endDate: { type: "string", description: "End date in YYYY-MM-DD format" }
            },
            required: []
        }
    },
    {
        name: "get_leave_records",
        description: "Get individual leave records for an employee or time period.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string" },
                startDate: { type: "string" },
                endDate: { type: "string" },
                leave_type: { type: "string" },
                limit: { type: "number" }
            },
            required: []
        }
    },
    {
        name: "get_wfh_summary",
        description: "Get WFH statistics: totals, department breakdown, top requesters.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string" },
                startDate: { type: "string" },
                endDate: { type: "string" }
            },
            required: []
        }
    },
    {
        name: "get_wfh_records",
        description: "Get individual WFH records for an employee or time period.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string" },
                startDate: { type: "string" },
                endDate: { type: "string" },
                limit: { type: "number" }
            },
            required: []
        }
    },
    {
        name: "get_hr_analytics",
        description: "Get overall HR analytics: total employees, leave days, WFH counts, department breakdown.",
        parameters: { type: "object", properties: {}, required: [] }
    },
    {
        name: "get_employee_by_id",
        description: "Get a single employee by their database ID. Use when the user provides or asks about a specific employee ID.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "number", description: "Employee database ID" }
            },
            required: ["id"]
        }
    },
    {
        name: "get_employee_by_name",
        description: "Get employee(s) by exact name. Use to resolve a specific employee mentioned by name.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Exact employee name" }
            },
            required: ["name"]
        }
    },
    {
        name: "get_all_employees",
        description: "List all employees, optionally filtered by department or active status. Use for broad employee listings.",
        parameters: {
            type: "object",
            properties: {
                department: { type: "string", description: "Filter by exact department name" },
                is_active: { type: "boolean", description: "Filter by active status. Omit for all." },
                limit: { type: "number", description: "Max results (default 50)" }
            },
            required: []
        }
    },
    {
        name: "get_department_leave_comparison",
        description: "Get leave usage comparison across all departments: employee count, leave records, total leave days and average leave days per employee, ranked by usage. Use for 'which department has the highest average leave usage' or department-wise leave comparisons.",
        parameters: { type: "object", properties: {}, required: [] }
    },
    {
        name: "count_employees",
        description: "Count employees, optionally filtered by department or active status.",
        parameters: {
            type: "object",
            properties: {
                department: { type: "string" },
                is_active: { type: "boolean" }
            },
            required: []
        }
    },
    {
        name: "create_employee",
        description: "WRITE OPERATION - requires confirmation: Create a new employee. DO NOT execute directly.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "Full name of the employee" },
                department: { type: "string", description: "Department name" }
            },
            required: ["name", "department"]
        }
    },
    {
        name: "create_leave",
        description: "WRITE OPERATION - requires confirmation: Create a single-day leave record.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string" },
                leave_date: { type: "string", description: "YYYY-MM-DD" },
                leave_type: { type: "string", enum: ["FULL_DAY", "HALF_DAY"] },
                no_of_leaves: { type: "number" }
            },
            required: ["employee_name", "leave_date"]
        }
    },
    {
        name: "create_leave_range",
        description: "WRITE OPERATION - requires confirmation: Create leave records over a date range.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string" },
                startDate: { type: "string" },
                endDate: { type: "string" },
                leave_type: { type: "string", enum: ["FULL_DAY", "HALF_DAY"] }
            },
            required: ["employee_name", "startDate", "endDate"]
        }
    },
    {
        name: "create_wfh",
        description: "WRITE OPERATION - requires confirmation: Create a WFH request.",
        parameters: {
            type: "object",
            properties: {
                employee_name: { type: "string" },
                wfh_date: { type: "string" },
                reason: { type: "string" }
            },
            required: ["employee_name", "wfh_date"]
        }
    },
    {
        name: "update_employee",
        description: "WRITE OPERATION - requires confirmation: Update employee department or status. Requires employee ID.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "number", description: "Employee database ID" },
                department: { type: "string" },
                is_active: { type: "boolean" }
            },
            required: ["id"]
        }
    },
    {
        name: "delete_employee",
        description: "WRITE OPERATION - requires confirmation: Deactivate an employee (soft delete). Requires employee ID.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "number", description: "Employee database ID" },
                soft: { type: "boolean" }
            },
            required: ["id"]
        }
    },
    {
        name: "ask_clarification",
        description: "Ask the user a clarification question when the request is ambiguous.",
        parameters: {
            type: "object",
            properties: {
                question: { type: "string", description: "The clarification question to ask" }
            },
            required: ["question"]
        }
    }
];

const WRITE_TOOLS = new Set(["create_employee", "create_leave", "create_leave_range", "create_wfh", "update_employee", "delete_employee"]);

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================

const buildSystemPrompt = (context) => {
    const today = formatDate(getToday());
    const ctxLines = [
        context.activeDepartment ? `Active department: ${context.activeDepartment}` : null,
        context.activeEmployee ? `Active employee: ${context.activeEmployee}` : null,
        context.activeTimeframe ? `Active timeframe: ${context.activeTimeframe.label} (${context.activeTimeframe.startDate} to ${context.activeTimeframe.endDate})` : null,
        context.lastTopic ? `Last topic: ${context.lastTopic}` : null,
        context.employeeGroup ? `Employee group for follow-ups ("them"/"they"/"among them"): [${context.employeeGroup.slice(0, 10).join(", ")}${context.employeeGroup.length > 10 ? ", ..." : ""}]` : null,
        context.lastResultType ? `Last result type: ${context.lastResultType}` : null,
    ].filter(Boolean).join("\n");

    return `You are an intelligent HR AI Assistant connected to a live PostgreSQL database.
Today's date: ${today}.
${ctxLines ? `\n## Session Context\n${ctxLines}\n` : ""}
## Core Rules
1. NEVER fabricate employee names, leave counts, or any data. Always use database tools.
2. WRITE tools (create_*, update_*, delete_*) must be called as tool calls — they will be intercepted for user confirmation before any DB write.
3. For follow-ups with pronouns ("them", "they", "among them"), use the employee group from session context above.
4. For "who took most leaves" without a department/group qualifier, query all employees.
5. For "who took most among them", use employee_names array parameter with the session group.
6. For timeframe-only follow-ups like "what about last month?", reuse the previous tool with updated dates.
7. For ambiguous references, call ask_clarification instead of assuming.
8. Return structured tool calls — never generate HTML or code in responses.
9. For complex questions that need multiple pieces of information or sequential analysis (e.g. ranking departments by average leave usage, comparing leave across departments), call the required tools in sequence and use earlier results to decide the next step.
10. Use the get_department_leave_comparison tool when the user asks which department has the highest or lowest average leave usage, or wants a department-wise leave comparison.

## Conversation Memory
- Treat conversation history as the source of truth for follow-up context (last employee/group discussed, department, timeframe, filters).
- If a follow-up is ambiguous or conflicts with prior context, ask a concise clarification via ask_clarification instead of guessing.
- Do not silently drop a previously applied department filter; only apply filters the user explicitly mentions or that are clearly carried forward from context.

## Tool Selection Guide
- List/find employees → search_employees / get_all_employees / get_employee_by_id / get_employee_by_name
- Count employees → count_employees
- Leave rankings/totals → get_leave_summary
- Department leave comparison → get_department_leave_comparison
- Specific leave records → get_leave_records
- WFH summary → get_wfh_summary
- WFH records → get_wfh_records
- Dashboard/overview → get_hr_analytics
- Unclear request → ask_clarification`;
};

// ============================================================
// TOOL EXECUTOR
// ============================================================

const executeTool = async (toolName, toolParams, session) => {
    if (toolName === "ask_clarification") {
        return { __clarification: toolParams.question };
    }

    if (WRITE_TOOLS.has(toolName)) {
        return { __proposal: { tool: toolName, params: toolParams } };
    }

    switch (toolName) {
        case "search_employees": {
            let emps;
            if (toolParams.department) {
                emps = await db_fns.getAllEmployees({ department: toolParams.department });
                if (toolParams.is_active !== undefined) emps = emps.filter(e => e.is_active === toolParams.is_active);
            } else if (toolParams.query) {
                emps = await db_fns.searchEmployees(toolParams.query, toolParams.limit || 50);
                if (toolParams.is_active !== undefined) emps = emps.filter(e => e.is_active === toolParams.is_active);
            } else {
                emps = await db_fns.getAllEmployees({ is_active: toolParams.is_active, limit: toolParams.limit || 50 });
            }
            return { employees: emps };
        }

        case "get_leave_summary": {
            if (toolParams.startDate && !isValidDateString(toolParams.startDate)) throw new Error("Invalid startDate. Please use YYYY-MM-DD format.");
            if (toolParams.endDate && !isValidDateString(toolParams.endDate)) throw new Error("Invalid endDate. Please use YYYY-MM-DD format.");
            if (toolParams.startDate && toolParams.endDate && toolParams.startDate > toolParams.endDate) throw new Error("Start date cannot be after end date.");

            if (toolParams.employee_names && toolParams.employee_names.length > 0) {
                const results = await Promise.all(
                    toolParams.employee_names.map(name =>
                        db_fns.getLeaveSummary({ employee_name: name, startDate: toolParams.startDate, endDate: toolParams.endDate })
                    )
                );
                const merged = toolParams.employee_names.map((name, i) => ({
                    employee_name: name,
                    total_days: results[i].total_days,
                    records_count: results[i].total_records
                })).sort((a, b) => b.total_days - a.total_days);
                return { leave_summary: { top_employees: merged, total_days: merged.reduce((s, e) => s + e.total_days, 0), total_records: merged.reduce((s, e) => s + e.records_count, 0), unique_employees: merged.length } };
            }
            const summary = await db_fns.getLeaveSummary({ employee_name: toolParams.employee_name, startDate: toolParams.startDate, endDate: toolParams.endDate });
            return { leave_summary: summary };
        }

        case "get_leave_records": {
            if (toolParams.startDate && !isValidDateString(toolParams.startDate)) throw new Error("Invalid startDate. Please use YYYY-MM-DD format.");
            if (toolParams.endDate && !isValidDateString(toolParams.endDate)) throw new Error("Invalid endDate. Please use YYYY-MM-DD format.");
            if (toolParams.leave_type && !["FULL_DAY", "HALF_DAY"].includes(String(toolParams.leave_type).toUpperCase())) throw new Error("Invalid leave_type. Must be FULL_DAY or HALF_DAY.");
            if (toolParams.limit !== undefined && (!Number.isFinite(Number(toolParams.limit)) || Number(toolParams.limit) < 1)) throw new Error("Invalid limit. Must be a positive number.");
            const records = await db_fns.getAllLeaves(toolParams);
            return { leave_records: records };
        }

        case "get_wfh_summary": {
            if (toolParams.startDate && !isValidDateString(toolParams.startDate)) throw new Error("Invalid startDate. Please use YYYY-MM-DD format.");
            if (toolParams.endDate && !isValidDateString(toolParams.endDate)) throw new Error("Invalid endDate. Please use YYYY-MM-DD format.");
            const summary = await db_fns.getWfhSummary(toolParams);
            return { wfh_summary: summary };
        }

        case "get_wfh_records": {
            if (toolParams.startDate && !isValidDateString(toolParams.startDate)) throw new Error("Invalid startDate. Please use YYYY-MM-DD format.");
            if (toolParams.endDate && !isValidDateString(toolParams.endDate)) throw new Error("Invalid endDate. Please use YYYY-MM-DD format.");
            if (toolParams.limit !== undefined && (!Number.isFinite(Number(toolParams.limit)) || Number(toolParams.limit) < 1)) throw new Error("Invalid limit. Must be a positive number.");
            const records = await db_fns.getAllWfh(toolParams);
            return { wfh_records: records };
        }

        case "get_hr_analytics": {
            const analytics = await db_fns.getHrAnalytics();
            return { hr_analytics: analytics };
        }

        case "get_department_leave_comparison": {
            const comparison = await db_fns.getDepartmentLeaveStats();
            return { department_comparison: comparison };
        }

        case "get_employee_by_id": {
            const id = Number(toolParams.id);
            if (!Number.isFinite(id)) throw new Error("Invalid employee ID. Please provide a valid numeric employee ID.");
            const emp = await db_fns.getById(id);
            if (!emp) throw new Error(`Employee with ID ${id} not found`);
            return { employee: emp };
        }

        case "get_employee_by_name": {
            const name = String(toolParams.name || "").trim();
            if (!name) throw new Error("Employee name is required");
            const emps = await db_fns.getByName(name);
            return { employees: emps };
        }

        case "get_all_employees": {
            const emps = await db_fns.getAllEmployees({
                department: toolParams.department,
                is_active: toolParams.is_active,
                limit: toolParams.limit
            });
            return { employees: emps };
        }

        case "count_employees": {
            const count = await db_fns.countEmployees(toolParams);
            return { count, params: toolParams };
        }

        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
};

// ============================================================
// FORMAT TOOL RESULTS
// ============================================================

const formatToolResult = (toolName, toolParams, result, session) => {
    if (result.employees !== undefined) {
        const emps = result.employees;
        const deptLabel = toolParams.department || (emps.length > 0 && emps.every(e => e.department === emps[0].department) ? emps[0].department : null);
        const statusLabel = toolParams.is_active === true ? "active " : toolParams.is_active === false ? "inactive " : "";

        if (deptLabel) session.context.activeDepartment = deptLabel;
        if (emps.length > 0) {
            session.context.employeeGroup = emps.map(e => e.name);
            session.context.lastResultType = "employees";
            if (emps.length === 1) session.context.activeEmployee = emps[0].name;
        }

        return {
            message: emps.length === 0
                ? `No ${statusLabel}employees found${deptLabel ? ` in the **${deptLabel}** department` : ""}.`
                : `Found **${emps.length} ${statusLabel}employee(s)**${deptLabel ? ` in the **${deptLabel}** department` : ""}:`,
            structuredData: emps.length ? {
                type: "table",
                title: deptLabel ? `Employees in ${deptLabel}` : "Employee Results",
                columns: ["ID", "Name", "Department", "Status"],
                rows: emps.map(e => [e.id, e.name, e.department, e.is_active ? "Active" : "Inactive"])
            } : null
        };
    }

    if (result.employee !== undefined) {
        const emp = result.employee;
        return {
            message: `**${emp.name}** is an **${emp.department}** employee with status **${emp.is_active ? "Active" : "Inactive"}**.`,
            structuredData: {
                type: "card",
                title: `Employee — ${emp.name}`,
                data: {
                    ID: emp.id,
                    Name: emp.name,
                    Department: emp.department,
                    Status: emp.is_active ? "Active" : "Inactive"
                }
            }
        };
    }

    if (result.count !== undefined) {
        const p = result.params || toolParams;
        return {
            message: `There are **${result.count} employee(s)**${p.department ? ` in the **${p.department}** department` : ""}${p.is_active === true ? " that are currently **active**" : p.is_active === false ? " that are **inactive**" : ""}.`,
            structuredData: {
                type: "card",
                title: "Employee Count",
                data: { Count: result.count, ...(p.department ? { Department: p.department } : {}), ...(p.is_active !== undefined ? { Status: p.is_active ? "Active" : "Inactive" } : {}) }
            }
        };
    }

    if (result.leave_summary !== undefined) {
        const summary = result.leave_summary;
        session.context.lastResultType = "leaves";
        session.context.lastTopic = "leaves";
        const timeLabel = toolParams.startDate ? ` from ${toolParams.startDate} to ${toolParams.endDate || "today"}` : "";

        if (summary.top_employees && summary.top_employees.length > 0 && !toolParams.employee_name) {
            session.context.employeeGroup = summary.top_employees.map(e => e.employee_name);
            session.context.lastResultType = "leaves";
            session.context.lastTopic = "leaves";
            return {
                message: `Here are the employees ranked by leave days${timeLabel}:`,
                structuredData: {
                    type: "table",
                    title: `Leave Rankings${timeLabel}`,
                    columns: ["Employee", "Total Days", "Records"],
                    rows: summary.top_employees.map(e => [e.employee_name, `${e.total_days} day(s)`, `${e.records_count} record(s)`])
                }
            };
        }

        if (toolParams.employee_name) {
            return {
                message: `**${toolParams.employee_name}** has taken **${summary.total_days} leave day(s)** across **${summary.total_records} record(s)**${timeLabel}.`,
                structuredData: {
                    type: "card",
                    title: `Leave Summary — ${toolParams.employee_name}`,
                    data: { "Total Days": summary.total_days, "Total Records": summary.total_records, ...(timeLabel ? { Period: timeLabel } : {}) }
                }
            };
        }

        return {
            message: `Leave overview${timeLabel}: **${summary.total_records} records**, **${summary.total_days} total days** across **${summary.unique_employees} employee(s)**.`,
            structuredData: {
                type: "metrics",
                title: `Leave Summary${timeLabel}`,
                metrics: [
                    { label: "Total Records", value: summary.total_records },
                    { label: "Total Days", value: summary.total_days },
                    { label: "Employees on Leave", value: summary.unique_employees }
                ]
            }
        };
    }

    if (result.leave_records !== undefined) {
        const records = result.leave_records;
        session.context.lastResultType = "leaves";
        return {
            message: `Found **${records.length} leave record(s)**${toolParams.employee_name ? ` for **${toolParams.employee_name}**` : ""}:`,
            structuredData: records.length ? {
                type: "table",
                title: `Leave Records${toolParams.employee_name ? ` — ${toolParams.employee_name}` : ""}`,
                columns: ["ID", "Employee", "Date", "Type", "Days"],
                rows: records.map(r => [r.id, r.employee_name, String(r.leave_date).slice(0, 10), r.leave_type, r.no_of_leaves])
            } : null
        };
    }

    if (result.wfh_summary !== undefined) {
        const summary = result.wfh_summary;
        session.context.lastResultType = "wfh";
        session.context.lastTopic = "wfh";
        const topRequester = summary.top_employees[0]
            ? `${summary.top_employees[0].employee_name} (${summary.top_employees[0].total_requests})`
            : "None";
        return {
            message: `WFH summary: **${summary.total_records} request(s)** from **${summary.unique_employees} employee(s)**.`,
            structuredData: {
                type: "metrics",
                title: "WFH Summary",
                metrics: [
                    { label: "Total Requests", value: summary.total_records },
                    { label: "Unique Employees", value: summary.unique_employees },
                    { label: "Top Requester", value: topRequester }
                ]
            }
        };
    }

    if (result.wfh_records !== undefined) {
        const records = result.wfh_records;
        session.context.lastResultType = "wfh";
        return {
            message: `Found **${records.length} WFH record(s)**${toolParams.employee_name ? ` for **${toolParams.employee_name}**` : ""}:`,
            structuredData: records.length ? {
                type: "table",
                title: `WFH Records${toolParams.employee_name ? ` — ${toolParams.employee_name}` : ""}`,
                columns: ["ID", "Employee", "Date", "Reason"],
                rows: records.map(r => [r.id, r.employee_name, String(r.wfh_date).slice(0, 10), r.reason || "N/A"])
            } : null
        };
    }

    if (result.department_comparison !== undefined) {
        const comparison = result.department_comparison;
        const departments = (comparison.departments || []).slice().sort((a, b) => b.avg_leave_days_per_employee - a.avg_leave_days_per_employee);
        const top = departments[0];

        const message = top
            ? `Across all departments, the **${top.department}** department has the highest average leave usage at **${top.avg_leave_days_per_employee.toFixed(1)} day(s) per employee** — **${top.total_days} total day(s)** across **${top.records_count} record(s)** from **${top.employee_count} employee(s)**.`
            : "No department-level leave data is available in the database.";

        return {
            message,
            structuredData: departments.length ? {
                type: "table",
                title: "Department Leave Comparison",
                columns: ["Department", "Employees", "Leave Records", "Total Days", "Avg Days / Employee"],
                rows: departments.map(d => [d.department, d.employee_count, d.records_count, `${d.total_days}`, d.avg_leave_days_per_employee.toFixed(1)])
            } : null
        };
    }

    if (result.hr_analytics !== undefined) {
        const a = result.hr_analytics;
        return {
            message: "Here is the current HR overview:",
            structuredData: {
                type: "metrics",
                title: "HR Analytics Overview",
                metrics: [
                    { label: "Total Employees", value: a.total_employees },
                    { label: "Active Employees", value: a.active_employees },
                    { label: "Total Leave Records", value: a.total_leave_records },
                    { label: "Total Leave Days", value: a.total_leave_days },
                    { label: "Total WFH Requests", value: a.total_wfh_requests }
                ]
            }
        };
    }

    return { message: "Operation completed." };
};

// ============================================================
// WRITE PROPOSAL BUILDER
// ============================================================

const buildWriteProposal = async (toolName, params) => {
    switch (toolName) {
        case "create_leave":
            return {
                id: `act_${Date.now()}`,
                type: "CREATE_LEAVE",
                tool: "create_leave",
                params,
                title: "Create Leave Request",
                summary: `Create ${params.leave_type === "HALF_DAY" ? "half-day" : "full-day"} leave for **${params.employee_name}** on ${params.leave_date}`,
                details: { Employee: params.employee_name, Date: params.leave_date, Type: params.leave_type || "FULL_DAY", Days: params.no_of_leaves || 1 }
            };
        case "create_leave_range":
            return {
                id: `act_${Date.now()}`,
                type: "CREATE_LEAVE",
                tool: "create_leave_range",
                params,
                title: "Create Leave Request",
                summary: `Create leave for **${params.employee_name}** from ${params.startDate} to ${params.endDate}`,
                details: { Employee: params.employee_name, "Start Date": params.startDate, "End Date": params.endDate, Type: params.leave_type || "FULL_DAY" }
            };
        case "create_wfh":
            return {
                id: `act_${Date.now()}`,
                type: "CREATE_WFH",
                tool: "create_wfh",
                params,
                title: "Create WFH Request",
                summary: `Create WFH for **${params.employee_name}** on ${params.wfh_date}`,
                details: { Employee: params.employee_name, Date: params.wfh_date, Reason: params.reason || "Remote work" }
            };
        case "create_employee":
            return {
                id: `act_${Date.now()}`,
                type: "CREATE_EMPLOYEE",
                tool: "create_employee",
                params: { ...params, is_active: true },
                title: "Add New Employee",
                summary: `Add **${params.name}** to the **${params.department}** department`,
                details: { Name: params.name, Department: params.department, Status: "Active" }
            };
        case "update_employee": {
            const emp = await db_fns.getById(params.id).catch(() => null);
            return {
                id: `act_${Date.now()}`,
                type: "UPDATE_EMPLOYEE",
                tool: "update_employee",
                params,
                title: "Update Employee",
                summary: `Update employee${emp ? ` **${emp.name}**` : ` ID ${params.id}`}`,
                details: {
                    "Employee ID": params.id,
                    ...(emp ? { Name: emp.name, "Current Dept": emp.department } : {}),
                    ...(params.department ? { "New Department": params.department } : {}),
                    ...(params.is_active !== undefined ? { "New Status": params.is_active ? "Active" : "Inactive" } : {})
                }
            };
        }
        case "delete_employee": {
            const emp = await db_fns.getById(params.id).catch(() => null);
            return {
                id: `act_${Date.now()}`,
                type: "DELETE_EMPLOYEE",
                tool: "delete_employee",
                params: { ...params, soft: true },
                title: "Deactivate Employee",
                summary: `Deactivate employee${emp ? ` **${emp.name}**` : ` ID ${params.id}`}`,
                details: { "Employee ID": params.id, ...(emp ? { Name: emp.name, Department: emp.department } : {}), Action: "Soft deactivate" },
                warning: "This will mark the employee as inactive. All associated records are preserved."
            };
        }
        default:
            return null;
    }
};

// ============================================================
// LLM CALL (with model fallback chain for 503 high-demand errors)
// ============================================================

const FALLBACK_MODELS = [
    "gemini-3-flash-preview",
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
];

const MAX_TOOL_ROUNDS = 3;

const getFunctionCallsFromResponse = (response) => {
    const candidate = response?.candidates?.[0];
    if (!candidate) return [];
    const functionCalls = [];
    for (const part of candidate.content?.parts || []) {
        if (part.functionCall) {
            functionCalls.push({ id: part.functionCall.id, name: part.functionCall.name, args: part.functionCall.args || {} });
        }
    }
    return functionCalls;
};

const getAssistantTextFromResponse = (response) => {
    const candidate = response?.candidates?.[0];
    if (!candidate) return null;
    let text = null;
    for (const part of candidate.content?.parts || []) {
        if (part.text) text = part.text;
    }
    return text;
};

const runAgentTurn = async (session, userMessage) => {
    const systemInstruction = buildSystemPrompt(session.context);
    const toolDeclarations = TOOL_SCHEMAS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
    }));

    const historyForLLM = session.history.slice(-14).map(h => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }]
    }));

    const modelsToTry = [GEMINI_MODEL, ...FALLBACK_MODELS.filter(m => m !== GEMINI_MODEL)];

    for (const model of modelsToTry) {
        try {
            const chat = genAI.chats.create({
                model,
                config: {
                    systemInstruction,
                    tools: [{ functionDeclarations: toolDeclarations }],
                    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
                    temperature: 0.1,
                },
                history: historyForLLM
            });

            let response = await chat.sendMessage({ message: userMessage });
            if (!response?.candidates?.[0]) continue;

            // Agentic loop: keep feeding tool results back to the LLM until it
            // answers with text, asks a clarification, or requests a write action.
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const functionCalls = getFunctionCallsFromResponse(response);
                const textResponse = getAssistantTextFromResponse(response);

                if (functionCalls.length === 0) {
                    return { text: textResponse, functionCalls: [], pendingProposal: null };
                }

                const outcomes = [];
                for (const fc of functionCalls) {
                    try {
                        const rawResult = await executeTool(fc.name, fc.args, session);

                        if (rawResult?.__clarification) {
                            return { text: rawResult.__clarification, clarification: rawResult.__clarification };
                        }

                        if (rawResult?.__proposal) {
                            const proposal = await buildWriteProposal(rawResult.__proposal.tool, rawResult.__proposal.params);
                            if (proposal) {
                                session.pendingProposal = proposal;
                                session.history.push({ role: "assistant", content: `Proposed: ${proposal.summary}` });
                                return {
                                    text: `I've prepared the following action. Please review and confirm:`,
                                    requiresConfirmation: true,
                                    actionProposal: proposal
                                };
                            }
                        }

                        outcomes.push({ name: fc.name, ok: true, result: rawResult });
                    } catch (err) {
                        console.error(`[Agent] Tool error (${fc.name}):`, err.message);
                        outcomes.push({ name: fc.name, ok: false, error: err });
                    }
                }

                const functionResponseParts = outcomes.map((outcome, i) => {
                    const fc = functionCalls[i];
                    if (outcome.ok) {
                        return { functionResponse: { name: fc.name, response: outcome.result } };
                    }
                    return { functionResponse: { name: fc.name, response: { error: { message: outcome.error.message } } } };
                });

                response = await chat.sendMessage({ message: { parts: functionResponseParts } });
            }

            const finalText = getAssistantTextFromResponse(response);
            if (model !== GEMINI_MODEL) {
                console.log(`[LLM] Using fallback model: ${model}`);
            }
            return { text: finalText, functionCalls: [], pendingProposal: null };

        } catch (err) {
            const is503 = err.message && (err.message.includes("503") || err.message.includes("high demand") || err.message.includes("UNAVAILABLE"));
            const is404 = err.message && (err.message.includes("404") || err.message.includes("not found") || err.message.includes("no longer available"));

            if (is503 || is404) {
                console.warn(`[LLM] Model ${model} unavailable (${is503 ? "503" : "404"}), trying next...`);
                continue;
            }

            console.error("[LLM] Gemini error:", err.message);
            return null;
        }
    }

    console.error("[LLM] All models unavailable — falling back to rule-based engine.");
    return null;
};

const callLLM = async (session, userMessage) => {
    if (!genAI) return null;
    return runAgentTurn(session, userMessage);
};

// ============================================================
// RULE-BASED FALLBACK (no API key mode)
// ============================================================

const ruleBasedFallback = async (text, session) => {
    const lower = text.toLowerCase();
    const timeframe = parseTimeframe(text) || session.context.activeTimeframe;
    if (timeframe) session.context.activeTimeframe = timeframe;

    const deptMatch = text.match(/(?:in|from|for|of)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9\s&]+?)(?:\s+department|\s+team|$)/i);
    let dept = deptMatch ? deptMatch[1].trim() : null;
    if (!dept && /them|those|same|among/i.test(lower)) dept = session.context.activeDepartment;

    if (/(?:list|show|who|find|get|display)\s+.*employee|employee/i.test(lower) && !/leave|wfh/i.test(lower)) {
        if (dept) {
            const emps = await db_fns.getAllEmployees({ department: dept });
            return formatToolResult("search_employees", { department: dept }, { employees: emps }, session);
        }
        const emps = await db_fns.getAllEmployees({ limit: 50 });
        return formatToolResult("search_employees", {}, { employees: emps }, session);
    }

    if (/leave/i.test(lower) && !/create|add|apply|book/i.test(lower)) {
        const useGroup = /them|those|among/i.test(lower) && session.context.employeeGroup;
        if (/most|highest|top/i.test(lower)) {
            const summary = await db_fns.getLeaveSummary({ startDate: timeframe?.startDate, endDate: timeframe?.endDate });
            let top = summary.top_employees;
            if (useGroup) top = top.filter(e => session.context.employeeGroup.includes(e.employee_name));
            return formatToolResult("get_leave_summary", { startDate: timeframe?.startDate, endDate: timeframe?.endDate }, { leave_summary: { ...summary, top_employees: top } }, session);
        }
        const summary = await db_fns.getLeaveSummary({ startDate: timeframe?.startDate, endDate: timeframe?.endDate });
        return formatToolResult("get_leave_summary", { startDate: timeframe?.startDate, endDate: timeframe?.endDate }, { leave_summary: summary }, session);
    }

    if (/wfh|work.from.home/i.test(lower) && !/create|add|apply/i.test(lower)) {
        const summary = await db_fns.getWfhSummary({ startDate: timeframe?.startDate, endDate: timeframe?.endDate });
        return formatToolResult("get_wfh_summary", {}, { wfh_summary: summary }, session);
    }

    if (/overview|analytics|metrics|dashboard|summary/i.test(lower)) {
        const analytics = await db_fns.getHrAnalytics();
        return formatToolResult("get_hr_analytics", {}, { hr_analytics: analytics }, session);
    }

    return {
        message: `To enable full natural language understanding, add your **Gemini API key** to \`backend/.env\`:\n\`\`\`\nGEMINI_API_KEY=your-key-here\n\`\`\`\nGet a free key at **aistudio.google.com/apikey**\n\nIn the meantime, try:\n• **"Show employees in Engineering"**\n• **"Who took the most leaves this year?"**\n• **"Show WFH summary this month"**\n• **"Give me the HR overview"**`,
        suggestedPrompts: [
            "Show me all employees in Engineering",
            "Who took the most leaves this year?",
            "Give me the HR overview",
            "Show WFH summary this month"
        ]
    };
};

// ============================================================
// EMPLOYEE NAME EXTRACTION HELPER
// ============================================================

const extractEmployeeNameFromText = async (text, context) => {
    if (/all\s+employees|everyone/i.test(text)) return null;

    const idMatch = text.match(/(?:employee\s+id|id)\s*[:#]?\s*(\d+)/i);
    if (idMatch) {
        const emp = await db_fns.getById(idMatch[1]);
        if (emp) return emp.name;
    }

    const allEmployees = await db_fns.getAllEmployees();
    for (const emp of allEmployees) {
        if (new RegExp(`\\b${emp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i").test(text)) return emp.name;
    }

    const nameMatch = text.match(/(?:for|named?|about|change|update|delete|remove)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) return nameMatch[1].trim();

    if (context?.activeEmployee && /he|she|they|him|her|same|this\s+employee/i.test(text)) {
        return context.activeEmployee;
    }

    return null;
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

const processMessage = async ({ message, sessionId = "default", confirmationAction = null }) => {
    const session = getSession(sessionId);
    const text = (message || "").trim();

    // ─────────────────────────────────────────
    // 1. CONFIRMATION WORKFLOW
    // ─────────────────────────────────────────

    if (confirmationAction) {
        const { actionId, confirmed } = confirmationAction;
        const proposal = session.pendingProposal;

        if (!proposal || proposal.id !== actionId) {
            return { message: "No matching pending action found or it has expired.", status: "EXPIRED" };
        }

        session.pendingProposal = null;

        if (!confirmed) {
            return { message: `Action cancelled: ${proposal.summary}. No changes were made.`, status: "CANCELLED", actionProposal: null };
        }

        try {
            const toolFn = tools[proposal.tool];
            if (!toolFn) throw new Error(`Unknown tool: ${proposal.tool}`);
            const result = await toolFn(proposal.params);
            session.history.push({ role: "assistant", content: `Executed: ${proposal.summary}` });
            return {
                message: `✅ **Successfully executed**: ${proposal.summary}`,
                status: "COMPLETED",
                actionResult: { type: proposal.type, data: result },
                structuredData: { type: "card", title: "Operation Completed", data: result }
            };
        } catch (err) {
            console.error("[Agent] Confirmed action error:", err);
            return { message: `❌ Failed to execute: ${err.message}`, status: "FAILED", error: err.message };
        }
    }

    // Text-based confirmation
    if (session.pendingProposal) {
        const isConfirm = /\b(yes|confirm|proceed|ok|okay|sure|go ahead|do it|execute|agree|accepted)\b/i.test(text);
        const isCancel = /\b(no|cancel|abort|stop|don't|dont|nevermind|reject)\b/i.test(text);

        if (isConfirm && !isCancel) {
            return processMessage({ sessionId, confirmationAction: { actionId: session.pendingProposal.id, confirmed: true } });
        } else if (isCancel) {
            return processMessage({ sessionId, confirmationAction: { actionId: session.pendingProposal.id, confirmed: false } });
        }
    }

    // ─────────────────────────────────────────
    // 2. FAST PATH: CLEAR WRITE INTENTS (for reliable UX without LLM)
    // ─────────────────────────────────────────

    const lower = text.toLowerCase();

    if (/(?:create|apply|add|book|request)\s+(?:a\s+)?leave/i.test(lower)) {
        const tf = parseTimeframe(text);
        const nameMatch = await extractEmployeeNameFromText(text, session.context);

        if (!nameMatch) return { message: "Which employee should I create the leave for?", needsClarification: true };
        if (!tf) return { message: `What date(s) should the leave be for **${nameMatch}**?`, needsClarification: true };

        const isHalf = /half.?day/i.test(text);
        const startDate = tf.startDate || tf.date;
        const endDate = tf.endDate || tf.date;

        const proposal = await buildWriteProposal(
            startDate === endDate ? "create_leave" : "create_leave_range",
            startDate === endDate
                ? { employee_name: nameMatch, leave_date: startDate, leave_type: isHalf ? "HALF_DAY" : "FULL_DAY", no_of_leaves: isHalf ? 0.5 : 1 }
                : { employee_name: nameMatch, startDate, endDate, leave_type: isHalf ? "HALF_DAY" : "FULL_DAY" }
        );

        session.pendingProposal = proposal;
        session.history.push({ role: "user", content: text });
        return { message: `I've prepared the leave request for **${nameMatch}**. Please review and confirm:`, requiresConfirmation: true, actionProposal: proposal };
    }

    if (/(?:create|apply|add|request)\s+(?:a\s+)?(?:wfh|work.from.home)/i.test(lower)) {
        const tf = parseTimeframe(text);
        const nameMatch = await extractEmployeeNameFromText(text, session.context);

        if (!nameMatch) return { message: "Which employee should I create the WFH request for?", needsClarification: true };
        const wfhDate = tf?.date || tf?.startDate;
        if (!wfhDate) return { message: `What date should the WFH be for **${nameMatch}**?`, needsClarification: true };

        const proposal = await buildWriteProposal("create_wfh", { employee_name: nameMatch, wfh_date: wfhDate, reason: "Remote work" });
        session.pendingProposal = proposal;
        session.history.push({ role: "user", content: text });
        return { message: `I've prepared the WFH request for **${nameMatch}**. Please review and confirm:`, requiresConfirmation: true, actionProposal: proposal };
    }

    if (/(?:create|add|register|hire)\s+(?:a\s+)?(?:new\s+)?employee/i.test(lower)) {
        const nameMatch = text.match(/(?:named?|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        const deptMatch = text.match(/(?:in|to)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9\s&]+?)(?:\s+department|$)/i);
        const name = nameMatch ? nameMatch[1] : null;
        const dept = deptMatch ? deptMatch[1].trim() : null;

        if (!name) return { message: "What is the name of the new employee? (e.g. 'Create employee named Rohit in Engineering')", needsClarification: true };
        if (!dept) return { message: `Which department should **${name}** be assigned to?`, needsClarification: true };

        const proposal = await buildWriteProposal("create_employee", { name, department: dept });
        session.pendingProposal = proposal;
        session.history.push({ role: "user", content: text });
        return { message: `I've prepared the registration for **${name}**. Please review and confirm:`, requiresConfirmation: true, actionProposal: proposal };
    }

    // ─────────────────────────────────────────
    // 3. LLM REASONING LAYER (agentic tool loop with confirmation + clarification handling)
    // ─────────────────────────────────────────

    session.history.push({ role: "user", content: text });

    const llmResult = await callLLM(session, text);

    if (llmResult) {
        // The agentic tool loop returns a final answer, a clarification, or a write proposal.

        // Write actions require explicit user confirmation before execution
        if (llmResult.requiresConfirmation && llmResult.actionProposal) {
            return {
                message: llmResult.text || "I've prepared the following action. Please review and confirm:",
                requiresConfirmation: true,
                actionProposal: llmResult.actionProposal
            };
        }

        // Ask the user a clarification question when the request is ambiguous
        if (llmResult.clarification) {
            session.history.push({ role: "assistant", content: llmResult.clarification });
            return { message: llmResult.clarification, needsClarification: true };
        }

        // Final answer produced by the LLM after (optionally) running tools
        if (llmResult.text) {
            session.history.push({ role: "assistant", content: llmResult.text });
            return { message: llmResult.text };
        }
    }

    // ─────────────────────────────────────────
    // 4. RULE-BASED FALLBACK
    // ─────────────────────────────────────────

    const fallbackResult = await ruleBasedFallback(text, session);
    session.history.push({ role: "assistant", content: fallbackResult.message });
    return fallbackResult;
};

module.exports = { processMessage, getSession };
