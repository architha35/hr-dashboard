const { GoogleGenAI } = require("@google/genai");
const { tools } = require("./tools");
const { db_fns } = require("../db");

// ============================================================
// GEMINI CLIENT SETUP
// ============================================================

const GEMINI_API_KEY = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").replace(/[" ]/g, "");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_REQUEST_TIMEOUT_MS = 45000;

let genAI = null;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenAI({
        apiKey: GEMINI_API_KEY,
        httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS },
        retry_config: { strategy: "none" },
    });
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
                employeeDetails: null,
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
    if (/last\s+year/i.test(text)) return { label: "last year", startDate: `${Y - 1}-01-01`, endDate: `${Y - 1}-12-31` };
    if (/today/i.test(text)) {
        const date = formatDate(today);
        return { label: "today", date, startDate: date, endDate: date };
    }
    if (/yesterday/i.test(text)) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - 1);
        const value = formatDate(date);
        return { label: "yesterday", date: value, startDate: value, endDate: value };
    }
    const lastDaysMatch = text.match(/last\s+(\d+)\s+days?/i);
    if (lastDaysMatch) {
        const end = new Date(today);
        const start = new Date(today);
        start.setUTCDate(start.getUTCDate() - Number(lastDaysMatch[1]) + 1);
        return { label: `last ${lastDaysMatch[1]} days`, startDate: formatDate(start), endDate: formatDate(end) };
    }
    if (/this\s+quarter/i.test(text)) {
        const quarterStartMonth = Math.floor(M / 3) * 3;
        return { label: "this quarter", startDate: formatDate(new Date(Date.UTC(Y, quarterStartMonth, 1))), endDate: formatDate(new Date(Date.UTC(Y, quarterStartMonth + 3, 0))) };
    }
    if (/last\s+quarter/i.test(text)) {
        const currentQuarterStart = Math.floor(M / 3) * 3;
        return { label: "last quarter", startDate: formatDate(new Date(Date.UTC(Y, currentQuarterStart - 3, 1))), endDate: formatDate(new Date(Date.UTC(Y, currentQuarterStart, 0))) };
    }
    if (/last\s+week/i.test(text)) {
        const thisWeekStart = new Date(today);
        thisWeekStart.setUTCDate(today.getUTCDate() - today.getUTCDay());
        const start = new Date(thisWeekStart);
        start.setUTCDate(start.getUTCDate() - 7);
        const end = new Date(thisWeekStart);
        end.setUTCDate(end.getUTCDate() - 1);
        return { label: "last week", startDate: formatDate(start), endDate: formatDate(end) };
    }
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

const isHrDataQuestion = (text) => /\b(employee|employees|staff|department|team|leave|leaves|absence|wfh|work\s*from\s*home|record|records|analytics|headcount|count|who|how many|which|most|least|highest|lowest|top|bottom)\b/i.test(text);

const extractDepartmentFromQuestion = (text) => {
    const match = text.match(/\b(?:in|from|within)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9& -]*?)(?=\s+(?:department|team|this\s+month|last\s+month|this\s+year|last\s+year|between|on\s+\d|as\s+(?:a\s+)?follow.?up|among|who|what)\b|[?.!,]*$)/i);
    return match?.[1]?.trim().replace(/\s+(?:department|team)$/i, "") || null;
};

const dedupeNames = (employees) => [...new Map(employees.map(e => [String(e.name).trim().toLowerCase(), String(e.name).trim()])).values()];
const followsPreviousGroup = (text) => /\b(?:follow.?up|them|those|among|which of|same group|their|these|that group)\b/i.test(text) || /^\s*(?:and\s+)?(?:what|how) about\b/i.test(text);
const joinNames = (names) => names.length < 2 ? (names[0] || "") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

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
        parameters: {
            type: "object",
            properties: {
                startDate: { type: "string", description: "Optional start date in YYYY-MM-DD format" },
                endDate: { type: "string", description: "Optional end date in YYYY-MM-DD format" }
            },
            required: []
        }
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
11. Every HR data answer must be grounded in a tool result. Preserve the employee, department, status, group, and date filters stated or clearly carried forward by the user.
12. If the available result doesn't answer the requested metric or scope, ask a brief clarification or say the data isn't available; never substitute a nearby metric (for example, don't use a top-five list to answer who has the least).
13. Personalize the wording to the user's actual question and explicitly name the scope used. Report zero results as zero; do not imply missing data means zero unless the query returned zero.

## Conversation Memory
- Treat conversation history as the source of truth for follow-up context (last employee/group discussed, department, timeframe, filters).
- A follow-up asking who took the most leave after an employee list (including "as a follow up", "among them", or "which of them") means rank that previously listed group, preserving any timeframe unless the user changes it.
- Generic employee questions such as "who are the employees in Engineering?" must query the employee list tool with the department filter.
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
            if (toolParams.startDate && !isValidDateString(toolParams.startDate)) throw new Error("Invalid startDate. Please use YYYY-MM-DD format.");
            if (toolParams.endDate && !isValidDateString(toolParams.endDate)) throw new Error("Invalid endDate. Please use YYYY-MM-DD format.");
            if (toolParams.startDate && toolParams.endDate && toolParams.startDate > toolParams.endDate) throw new Error("Start date cannot be after end date.");
            const comparison = await db_fns.getDepartmentLeaveStats(toolParams);
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

const formatToolResult = (toolName, toolParams, result, session, userText = "") => {
    if (toolName === "get_employee_by_name" && Array.isArray(result.employees)) {
        if (result.employees.length === 1) return formatToolResult(toolName, toolParams, { employee: result.employees[0] }, session, userText);
        if (result.employees.length === 0) return { message: `I couldn't find an employee named **${toolParams.name}**.` };
    }

    if (result.employees !== undefined) {
        const emps = result.employees;
        const deptLabel = toolParams.department || (emps.length > 0 && emps.every(e => e.department === emps[0].department) ? emps[0].department : null);
        const statusLabel = toolParams.is_active === true ? "active " : toolParams.is_active === false ? "inactive " : "";

        session.context.activeDepartment = toolParams.department || null;
        session.context.employeeGroup = emps.map(e => e.name);
        session.context.employeeDetails = emps.map(e => ({ id: e.id, name: e.name, department: e.department }));
        session.context.lastResultType = "employees";
        session.context.lastTopic = "employees";
        session.context.activeEmployee = emps.length === 1 ? emps[0].name : null;

        return {
            message: emps.length === 0
                ? `No ${statusLabel}employees found${deptLabel ? ` in the **${deptLabel}** department` : ""}.`
                : `${deptLabel ? `In **${deptLabel}**, ` : ""}I found **${emps.length} ${statusLabel}employee${emps.length === 1 ? "" : "s"}**${emps.length <= 12 ? `: ${emps.map(e => `**${e.name}**`).join(", ")}.` : ". The full list is below."}`,
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
        session.context.activeEmployee = emp.name;
        session.context.activeDepartment = emp.department;
        session.context.employeeGroup = [emp.name];
        session.context.employeeDetails = [{ id: emp.id, name: emp.name, department: emp.department }];
        session.context.lastResultType = "employees";
        session.context.lastTopic = "employees";
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
            message: result.count === 0
                ? `There are no employees${p.department ? ` in the **${p.department}** department` : ""}${p.is_active === true ? " who are currently active" : p.is_active === false ? " who are inactive" : ""}.`
                : `There ${result.count === 1 ? "is" : "are"} **${result.count} employee${result.count === 1 ? "" : "s"}**${p.department ? ` in the **${p.department}** department` : ""}${p.is_active === true ? " who are currently **active**" : p.is_active === false ? " who are **inactive**" : ""}.`,
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

        if (summary.top_employees && summary.top_employees.length > 0 && !toolParams.employee_name && (!toolParams.employee_names?.length || /\b(?:most|highest|top|max(?:imum)?|greatest|biggest|least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(userText))) {
            session.context.employeeGroup = summary.top_employees.map(e => e.employee_name);
            session.context.employeeDetails = summary.top_employees.filter(e => e.employee_id).map(e => ({ id: e.employee_id, name: e.employee_real_name || e.employee_name, department: e.department }));
            session.context.lastResultType = "leaves";
            session.context.lastTopic = "leaves";
            const ranking = summary.top_employees.slice();
            const asksForLeast = /\b(?:least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(userText);
            if (asksForLeast) ranking.reverse();
            const leaders = ranking.filter(e => e.total_days === ranking[0].total_days);
            const leaderNames = joinNames(leaders.map(e => `**${e.employee_name}**`));
            const scope = toolParams.scopeLabel
                ? `${toolParams.scopeLabel}, `
                : toolParams.employee_names?.length
                ? `Among the ${toolParams.employee_names.length} employees we just discussed, `
                : "Across all employees, ";
            const rankWord = asksForLeast ? "least" : "most";
            const leadSentence = `${scope}${leaders.length === 1 ? `${leaderNames} took the ${rankWord} leave` : `${leaderNames} are tied for the ${rankWord} leave`} with **${leaders[0].total_days} day(s)**${timeLabel}.`;
            return {
                message: `${leadSentence} The full ranking is below.`,
                structuredData: {
                    type: "table",
                    title: `${toolParams.scopeLabel ? "Leave Ranking — Filtered Group" : "Leave Ranking — All Employees"}${timeLabel}`,
                    columns: ["Employee", "Total Days", "Records"],
                    rows: ranking.map(e => [e.employee_name, `${e.total_days} day(s)`, `${e.records_count} record(s)`])
                }
            };
        }

        if (toolParams.employee_names?.length && !toolParams.employee_name) {
            return {
                message: `${toolParams.scopeLabel ? `${toolParams.scopeLabel}, ` : `For the ${toolParams.employee_names.length} employees we just discussed, `}there were **${summary.total_days} leave day(s)** across **${summary.total_records} record(s)**${timeLabel}. The employee breakdown is below.`,
                structuredData: {
                    type: "table",
                    title: `Leave Totals — Discussed Employees${timeLabel}`,
                    columns: ["Employee", "Total Days", "Records"],
                    rows: summary.top_employees.map(e => [e.employee_name, `${e.total_days} day(s)`, `${e.records_count} record(s)`])
                }
            };
        }

        if (toolParams.employee_name) {
            return {
                message: summary.total_records === 0
                    ? `No leave records were found for **${toolParams.employee_name}**${timeLabel}.`
                    : `**${toolParams.employee_name}** has taken **${summary.total_days} leave day(s)** across **${summary.total_records} record(s)**${timeLabel}.`,
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
            message: `Found **${records.length} leave record(s)**${toolParams.employee_name ? ` for **${toolParams.employee_name}**` : toolParams.employee_names?.length ? ` for the ${toolParams.employee_names.length} employees just discussed` : ""}${toolParams.startDate ? ` from ${toolParams.startDate} to ${toolParams.endDate || "today"}` : ""}.`,
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
        if (summary.top_employees?.length) session.context.employeeGroup = summary.top_employees.map(e => e.employee_name);
        const timeLabel = toolParams.startDate ? ` from ${toolParams.startDate} to ${toolParams.endDate || "today"}` : "";
        if (toolParams.employee_names?.length && !/\b(?:most|highest|top|max(?:imum)?|greatest|biggest|least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(userText)) {
            return {
                message: `${toolParams.scopeLabel ? `${toolParams.scopeLabel}, ` : `For the ${toolParams.employee_names.length} employees we just discussed, `}there were **${summary.total_records} WFH request(s)** across **${summary.unique_employees} employee(s)**${timeLabel}. The employee breakdown is below.`,
                structuredData: {
                    type: "table",
                    title: `WFH Totals — Discussed Employees${timeLabel}`,
                    columns: ["Employee", "Requests"],
                    rows: summary.top_employees.map(e => [e.employee_name, e.total_requests])
                }
            };
        }
        if (summary.top_employees?.length && userText && /\b(?:most|highest|top|least|fewest|lowest|maximum|minimum)\b/i.test(userText)) {
            const ranking = summary.top_employees.slice();
            const asksForLeast = /\b(?:least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(userText);
            if (asksForLeast) ranking.reverse();
            const leaders = ranking.filter(e => e.total_requests === ranking[0].total_requests);
            const names = joinNames(leaders.map(e => `**${e.employee_name}**`));
            const rankWord = asksForLeast ? "least" : "most";
            const scope = toolParams.scopeLabel ? `${toolParams.scopeLabel}, ` : "Across employees, ";
            return {
                message: `${scope}${names} ${leaders.length === 1 ? `had the ${rankWord} WFH requests` : `are tied for the ${rankWord} WFH requests`} with **${leaders[0].total_requests} request(s)**${timeLabel}. The full ranking is below.`,
                structuredData: {
                    type: "table",
                    title: `WFH Ranking${toolParams.scopeLabel ? toolParams.scopeLabel.includes("current employees") ? " — Current Employees" : " — Filtered Group" : " — All Employees"}${timeLabel}`,
                    columns: ["Employee", "Requests"],
                    rows: ranking.map(e => [e.employee_name, e.total_requests])
                }
            };
        }
        const topRequester = summary.top_employees[0]
            ? `${summary.top_employees[0].employee_name} (${summary.top_employees[0].total_requests})`
            : "None";
        return {
            message: toolParams.employee_name && summary.total_records === 0
                ? `No WFH requests were recorded for **${toolParams.employee_name}**${timeLabel}.`
                : `${toolParams.employee_name ? `For **${toolParams.employee_name}**, ` : ""}there ${summary.total_records === 1 ? "was" : "were"} **${summary.total_records} WFH request(s)** from **${summary.unique_employees} employee(s)**${timeLabel}.`,
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
            message: `Found **${records.length} WFH record(s)**${toolParams.employee_name ? ` for **${toolParams.employee_name}**` : toolParams.employee_names?.length ? ` for the ${toolParams.employee_names.length} employees just discussed` : ""}${toolParams.startDate ? ` from ${toolParams.startDate} to ${toolParams.endDate || "today"}` : ""}.`,
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
        const requestedTimeframe = parseTimeframe(userText);
        const timeLabel = toolParams.startDate ? ` during ${requestedTimeframe?.label || `${toolParams.startDate} to ${toolParams.endDate || "today"}`}` : "";
        const hasUnattributedRecords = departments.some(d => ["Ambiguous", "Unassigned"].includes(d.department) && d.records_count > 0);
        const attributionNote = hasUnattributedRecords ? " Some leave records couldn't be matched to one employee department, so they are shown separately." : "";

        const message = top
            ? `Across all departments${timeLabel}, the **${top.department}** department has the highest average leave usage at **${top.avg_leave_days_per_employee.toFixed(1)} day(s) per employee** — **${top.total_days} total day(s)** across **${top.records_count} record(s)** from **${top.employee_count} employee(s)**.${attributionNote}`
            : `No department-level leave data is available${timeLabel}.${attributionNote}`;

        return {
            message,
            structuredData: departments.length ? {
                type: "table",
                title: `Department Leave Comparison${timeLabel}`,
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

const withTimeout = async (promise, ms, label) => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        if (typeof timer.unref === "function") timer.unref();
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
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
            let latestFormattedResult = null;
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

            let response = await withTimeout(chat.sendMessage({ message: userMessage }), GEMINI_REQUEST_TIMEOUT_MS, "Gemini response");
            if (!response?.candidates?.[0]) continue;

            // Agentic loop: keep feeding tool results back to the LLM until it
            // answers with text, asks a clarification, or requests a write action.
            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                const functionCalls = getFunctionCallsFromResponse(response);
                const textResponse = getAssistantTextFromResponse(response);

                if (functionCalls.length === 0) {
                    return { text: textResponse, functionCalls: [], pendingProposal: null, formattedResult: latestFormattedResult };
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

                        // Ground the user-facing answer in the same DB result returned
                        // to the model, and update follow-up context from that result.
                        latestFormattedResult = formatToolResult(fc.name, fc.args, rawResult, session, userMessage);

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

                response = await withTimeout(chat.sendMessage({ message: { parts: functionResponseParts } }), GEMINI_REQUEST_TIMEOUT_MS, "Gemini function response");
            }

            const finalText = getAssistantTextFromResponse(response);
            if (model !== GEMINI_MODEL) {
                console.log(`[LLM] Using fallback model: ${model}`);
            }
            return { text: finalText, functionCalls: [], pendingProposal: null, formattedResult: latestFormattedResult };

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
    const requestedTimeframe = parseTimeframe(text);
    const carriesContext = followsPreviousGroup(text) || /\b(?:same period|that month|that week|then)\b/i.test(text);
    const timeframe = requestedTimeframe || (carriesContext ? session.context.activeTimeframe : null);
    if (requestedTimeframe) session.context.activeTimeframe = requestedTimeframe;
    else if (!carriesContext) session.context.activeTimeframe = null;

    const deptMatch = text.match(/(?:in|from|for|of)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9\s&]+?)(?:\s+department|\s+team)?[?.!,]*$/i);
    let dept = deptMatch ? deptMatch[1].trim().replace(/\s+(?:department|team)$/i, "") : null;
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
        const isFollowUp = /follow.?up|them|those|among|which of|same group/i.test(lower);
        const useGroup = isFollowUp && session.context.employeeGroup?.length;
        if (/most|highest|top/i.test(lower)) {
            const params = { startDate: timeframe?.startDate, endDate: timeframe?.endDate };
            let summary;
            if (useGroup) {
                params.employee_names = session.context.employeeGroup;
                const results = await Promise.all(params.employee_names.map(employee_name =>
                    db_fns.getLeaveSummary({ employee_name, startDate: params.startDate, endDate: params.endDate })
                ));
                const top_employees = params.employee_names.map((employee_name, i) => ({
                    employee_name,
                    total_days: results[i].total_days,
                    records_count: results[i].total_records
                })).sort((a, b) => b.total_days - a.total_days);
                summary = { top_employees, total_days: top_employees.reduce((sum, e) => sum + e.total_days, 0), total_records: top_employees.reduce((sum, e) => sum + e.records_count, 0), unique_employees: top_employees.length };
            } else {
                summary = await db_fns.getLeaveSummary(params);
            }
            return formatToolResult("get_leave_summary", params, { leave_summary: summary }, session);
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
        message: "I couldn't match that question to a reliable HR database lookup, so I don't want to guess. Try naming the employee, department, topic (employees, leave, WFH, or overview), and date range if relevant."
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
    if (nameMatch) {
        const exactEmployee = allEmployees.find(emp => emp.name.trim().toLowerCase() === nameMatch[1].trim().toLowerCase());
        if (exactEmployee) return exactEmployee.name;
    }

    if (context?.activeEmployee && /\b(?:he|she|they|them|him|her|same|this\s+employee)\b/i.test(text)) {
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
    const requestedTimeframe = parseTimeframe(text);
    const carriesContext = followsPreviousGroup(text) || /\b(?:same period|that month|that week|then)\b/i.test(text);
    const timeframe = requestedTimeframe || (carriesContext ? session.context.activeTimeframe : null);
    if (requestedTimeframe) session.context.activeTimeframe = requestedTimeframe;
    else if (!carriesContext) session.context.activeTimeframe = null;

    // Route explicit department employee-list questions directly to the database.
    // This avoids a model occasionally dropping a stated department filter.
    const department = extractDepartmentFromQuestion(text);
    const isAttendanceQuestion = /\b(?:leave|leaves|absence|absences|wfh|work\s*from\s*home)\b/i.test(text);
    const checksEmployeeIdentity = isAttendanceQuestion || /\b(?:employee|employees|department|status|profile|who is|who's|tell me about)\b/i.test(text);
    const isEmployeeCountQuestion = !isAttendanceQuestion && /\b(?:how many|count|number of|total)\b/i.test(text) && /\b(?:employees?|staff|people)\b/i.test(text);
    const isEmployeeListQuestion = !isAttendanceQuestion && ((/\b(?:who\s+are|who works|list|show|find|get|display|which)\b/i.test(text) && /\b(?:employees?|staff|people|team\s+members?|everyone|all staff)\b/i.test(text)) || (/\bwho\b/i.test(text) && department));
    const activeFilter = /\binactive\b/i.test(text) ? false : /\bactive\b/i.test(text) ? true : undefined;

    // Validate named departments before any count or attendance aggregate can
    // silently turn an unknown scope into an all-company query.
    if (department) {
        const allEmployees = await db_fns.getAllEmployees();
        const knownDepartments = [...new Set(allEmployees.map(employee => employee.department).filter(Boolean))];
        const knownDepartment = knownDepartments.find(name => name.toLowerCase() === department.toLowerCase());
        if (!knownDepartment) {
            session.context.activeDepartment = department;
            session.context.employeeGroup = [];
            session.context.employeeDetails = [];
            session.context.lastResultType = "employees";
            session.context.lastTopic = "employees";
            const possibleEngineeringAlias = /^engineering$/i.test(department) && knownDepartments.some(name => /^sde$/i.test(name));
            const result = {
                message: `I couldn't find an exact **${department}** department match. Departments in this database are ${joinNames(knownDepartments.map(name => `**${name}**`))}.${possibleEngineeringAlias ? " If you mean **SDE**, please confirm and I can use that team." : " Which of these departments did you mean?"}`,
                needsClarification: true
            };
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
    }

    if (checksEmployeeIdentity) {
        const employees = await db_fns.getAllEmployees();
        const mentioned = employees.filter(emp => new RegExp(`\\b${emp.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
        const narrowed = department ? mentioned.filter(emp => emp.department?.toLowerCase() === department.toLowerCase()) : mentioned;
        const uniqueNames = new Map(narrowed.map(emp => [emp.name.trim().toLowerCase(), emp.name]));
        const duplicateName = [...uniqueNames.values()].find(name => narrowed.filter(emp => emp.name.trim().toLowerCase() === name.trim().toLowerCase()).length > 1);
        if (duplicateName) {
            const matching = (department ? narrowed : employees).filter(emp => emp.name.trim().toLowerCase() === duplicateName.trim().toLowerCase());
            const options = matching.map(emp => `${emp.name} (ID ${emp.id}, ${emp.department})`).join("; ");
            const result = { message: `I found multiple employees named **${duplicateName}**: ${options}. Which employee did you mean?`, needsClarification: true };
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
    }

    if (isEmployeeCountQuestion) {
        const countParams = { ...(department ? { department } : {}), ...(activeFilter !== undefined ? { is_active: activeFilter } : {}) };
        const count = await db_fns.countEmployees(countParams);
        const result = formatToolResult("count_employees", countParams, { count, params: countParams }, session);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (!isAttendanceQuestion && (/\b(?:which department|what department|department is|status of|details for|details about|who is|who's)\b/i.test(text) || /\b(?:employee\s+id|id)\s*[:#]?\s*\d+/i.test(text))) {
        const idMatch = text.match(/(?:employee\s+id|id)\s*[:#]?\s*(\d+)/i);
        if (idMatch) {
            const employee = await db_fns.getById(Number(idMatch[1]));
            if (!employee) {
                const result = { message: `I couldn't find an employee with ID **${idMatch[1]}**.` };
                session.history.push({ role: "assistant", content: result.message });
                return result;
            }
            const result = formatToolResult("get_employee_by_id", { id: Number(idMatch[1]) }, { employee }, session, text);
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
        const employeeName = await extractEmployeeNameFromText(text, session.context);
        if (employeeName) {
            const employees = await db_fns.getByName(employeeName);
            const result = formatToolResult("get_employee_by_name", { name: employeeName }, { employees }, session, text);
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
    }

    if (!isAttendanceQuestion && /\b(?:tell me about|profile|show|find|look up|search for|details on)\b/i.test(text)) {
        const employeeName = await extractEmployeeNameFromText(text, session.context);
        if (employeeName) {
            const employees = await db_fns.getByName(employeeName);
            const result = formatToolResult("get_employee_by_name", { name: employeeName }, { employees }, session, text);
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
    }

    if (/\b(?:balance|remaining leave|leave entitlement|leave allowance)\b/i.test(text)) {
        const result = { message: "I can report leave already recorded, but this database doesn't contain leave allowances or balances, so I can't calculate remaining leave accurately." };
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (isEmployeeListQuestion) {
        const listParams = { ...(department ? { department } : {}), ...(activeFilter !== undefined ? { is_active: activeFilter } : {}) };
        const employees = await db_fns.getAllEmployees(listParams);
        const result = formatToolResult("search_employees", listParams, { employees }, session, text);
        if (department && employees.length === 0) {
            const allEmployees = await db_fns.getAllEmployees();
            const departments = [...new Set(allEmployees.map(employee => employee.department).filter(Boolean))].sort();
            const possibleEngineeringAlias = /^engineering$/i.test(department) && departments.some(name => /^sde$/i.test(name));
            result.message = `I couldn't find an exact **${department}** department match. Departments in this database are ${joinNames(departments.map(name => `**${name}**`))}.${possibleEngineeringAlias ? " If you mean **SDE**, please confirm and I can list that team." : " Which of these departments did you mean?"}`;
            result.needsClarification = true;
        }
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (/\b(?:which|what) department\b/i.test(text) && /\b(?:leave|leaves|average|highest|lowest|most|least)\b/i.test(text)) {
        const params = { startDate: timeframe?.startDate, endDate: timeframe?.endDate };
        const comparison = await db_fns.getDepartmentLeaveStats(params);
        const result = formatToolResult("get_department_leave_comparison", params, { department_comparison: comparison }, session, text);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    // Answer explicit leave rankings directly, using the last employee list for
    // follow-ups and all employees for a fresh, unqualified ranking.
    if (/\b(?:leave|leaves|absence|absences)\b/i.test(text) && /\b(?:most|highest|top|max(?:imum)?|greatest|biggest|least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(text) && !/\b(?:create|add|apply|book)\b/i.test(text)) {
        const isFollowUp = followsPreviousGroup(text);
        const employeeMention = await extractEmployeeNameFromText(text, session.context);
        let employeeRecords = null;
        let scopeLabel = null;
        if (employeeMention) {
            employeeRecords = await db_fns.getByName(employeeMention);
            scopeLabel = `For **${employeeMention}**`;
        } else if (department || (isFollowUp && session.context.activeDepartment)) {
            const scopedDepartment = department || session.context.activeDepartment;
            employeeRecords = await db_fns.getAllEmployees({ department: scopedDepartment });
            scopeLabel = `Among employees in **${scopedDepartment}**`;
        } else if (isFollowUp && session.context.employeeDetails?.length) {
            employeeRecords = session.context.employeeDetails;
            scopeLabel = `Among the ${employeeRecords.length} employees just discussed`;
        } else if (isFollowUp && session.context.employeeGroup?.length) {
            employeeRecords = dedupeNames(session.context.employeeGroup.map(name => ({ name }))).map(name => ({ name }));
            scopeLabel = `Among the ${employeeRecords.length} employees just discussed`;
        }
        if (employeeRecords && employeeRecords.length === 0) {
            const result = { message: `I don't have any employees in that scope, so I can't rank leave for it. Please choose a department or employee from the available results.`, needsClarification: true };
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
        const asksForLeast = /\b(?:least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(text);
        if (asksForLeast && !employeeRecords) {
            employeeRecords = await db_fns.getAllEmployees();
            scopeLabel = "Among current employees";
        }
        const params = { startDate: timeframe?.startDate, endDate: timeframe?.endDate };
        if (employeeRecords) {
            params.employee_names = employeeRecords.map(e => e.name);
            params.scopeLabel = scopeLabel;
        }
        let summary;
        if (employeeRecords?.length) {
            const duplicateNameCounts = new Map();
            for (const employee of employeeRecords) duplicateNameCounts.set(String(employee.name).toLowerCase(), (duplicateNameCounts.get(String(employee.name).toLowerCase()) || 0) + 1);
            const results = await Promise.all(employeeRecords.map(employee =>
                db_fns.getLeaveSummary({ employee_id: employee.id, employee_name: employee.name, startDate: params.startDate, endDate: params.endDate })
            ));
            const top_employees = employeeRecords.map((employee, i) => ({
                employee_name: duplicateNameCounts.get(String(employee.name).toLowerCase()) > 1 ? `${employee.name} (${employee.department || `ID ${employee.id}`})` : employee.name,
                employee_real_name: employee.name,
                employee_id: employee.id,
                department: employee.department,
                total_days: results[i].total_days,
                records_count: results[i].total_records
            })).sort((a, b) => b.total_days - a.total_days);
            summary = { top_employees, total_days: top_employees.reduce((sum, e) => sum + e.total_days, 0), total_records: top_employees.reduce((sum, e) => sum + e.records_count, 0), unique_employees: top_employees.length };
        } else {
            summary = await db_fns.getLeaveSummary(params);
        }
        const result = formatToolResult("get_leave_summary", params, { leave_summary: summary }, session, text);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (!isAttendanceQuestion && /\b(?:department|departments|team|teams)\b/i.test(text) && /\b(?:what|which|list|show|largest|biggest|most|smallest|least)\b/i.test(text)) {
        const employees = await db_fns.getAllEmployees({ is_active: true });
        const counts = new Map();
        for (const employee of employees) counts.set(employee.department, (counts.get(employee.department) || 0) + 1);
        let departments = [...counts].map(([name, employeeCount]) => ({ name, employeeCount }));
        if (/\b(?:largest|biggest|most)\b/i.test(text)) departments.sort((a, b) => b.employeeCount - a.employeeCount);
        else if (/\b(?:smallest|least)\b/i.test(text)) departments.sort((a, b) => a.employeeCount - b.employeeCount);
        const asksForLargest = /\b(?:largest|biggest|most)\b/i.test(text);
        const asksForSmallest = /\b(?:smallest|least)\b/i.test(text);
        const leaders = (asksForLargest || asksForSmallest) && departments.length
            ? departments.filter(item => item.employeeCount === departments[0].employeeCount)
            : [];
        const message = leaders.length
            ? `${joinNames(leaders.map(item => `**${item.name}**`))} ${leaders.length === 1 ? "has" : "are tied with"} the ${asksForLargest ? "most" : "fewest"} active employees (**${leaders[0].employeeCount}**).`
            : `There are **${departments.length} active department(s)**. The employee counts are below.`;
        const result = {
            message,
            structuredData: departments.length ? {
                type: "table",
                title: "Active Employees by Department",
                columns: ["Department", "Employees"],
                rows: departments.map(item => [item.name, item.employeeCount])
            } : null
        };
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    const isWfhQuestion = /\b(?:wfh|work\s*from\s*home|remote work)\b/i.test(text);
    if (isWfhQuestion && /\b(?:which|what) department\b/i.test(text)) {
        const summary = await db_fns.getWfhSummary({ startDate: timeframe?.startDate, endDate: timeframe?.endDate });
        const departments = (summary.department_breakdown || []).slice().sort((a, b) => b.total_requests - a.total_requests);
        const leader = departments[0];
        const timeLabel = timeframe ? ` during ${timeframe.label}` : "";
        const result = {
            message: leader
                ? `The **${leader.department}** department had the most WFH requests${timeLabel}, with **${leader.total_requests} request(s)**. Here is the department breakdown.`
                : `There are no WFH requests${timeLabel} to compare by department.`,
            structuredData: departments.length ? {
                type: "table",
                title: `WFH Requests by Department${timeframe ? ` — ${timeframe.label}` : ""}`,
                columns: ["Department", "Requests"],
                rows: departments.map(d => [d.department, d.total_requests])
            } : null
        };
        session.history.push({ role: "assistant", content: result.message });
        session.context.lastResultType = "wfh";
        session.context.lastTopic = "wfh";
        return result;
    }
    const isWfhRankingQuestion = isWfhQuestion && /\b(?:most|highest|top|max(?:imum)?|greatest|biggest|least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(text);
    if (isWfhRankingQuestion) {
        const isFollowUp = followsPreviousGroup(text);
        const employeeMention = await extractEmployeeNameFromText(text, session.context);
        let employeeNames = null;
        let scopeLabel = null;
        if (employeeMention) {
            employeeNames = [employeeMention];
            scopeLabel = `For **${employeeMention}**`;
        } else if (department || (isFollowUp && session.context.activeDepartment)) {
            const scopedDepartment = department || session.context.activeDepartment;
            employeeNames = dedupeNames(await db_fns.getAllEmployees({ department: scopedDepartment }));
            scopeLabel = `Among employees in **${scopedDepartment}**`;
        } else if (isFollowUp && session.context.employeeGroup?.length) {
            employeeNames = dedupeNames(session.context.employeeGroup.map(name => ({ name })));
            scopeLabel = `Among the ${employeeNames.length} employees just discussed`;
        }
        if (employeeNames && employeeNames.length === 0) {
            const result = { message: `I don't have any employees in that scope, so I can't rank WFH requests for it. Please choose a department or employee from the available results.`, needsClarification: true };
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
        const asksForLeast = /\b(?:least|fewest|lowest|min(?:imum)?|smallest|bottom)\b/i.test(text);
        if (asksForLeast && !employeeNames) {
            employeeNames = dedupeNames(await db_fns.getAllEmployees());
            scopeLabel = "Among current employees";
        }
        const params = { startDate: timeframe?.startDate, endDate: timeframe?.endDate };
        if (employeeNames?.length) {
            const results = await Promise.all(employeeNames.map(employee_name =>
                db_fns.getWfhSummary({ employee_name, startDate: params.startDate, endDate: params.endDate })
            ));
            params.scopeLabel = scopeLabel;
            const top_employees = employeeNames.map((employee_name, index) => ({
                employee_name,
                total_requests: results[index].total_records
            })).sort((a, b) => b.total_requests - a.total_requests);
            const summary = { total_records: top_employees.reduce((sum, item) => sum + item.total_requests, 0), unique_employees: employeeNames.length, top_employees, department_breakdown: [] };
            const result = formatToolResult("get_wfh_summary", params, { wfh_summary: summary }, session, text);
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
        const summary = await db_fns.getWfhSummary(params);
        const result = formatToolResult("get_wfh_summary", params, { wfh_summary: summary }, session, text);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (isWfhQuestion && !/\b(?:create|add|apply|book|request)\b/i.test(text)) {
        const employeeName = await extractEmployeeNameFromText(text, session.context);
        const useGroup = !employeeName && !department && followsPreviousGroup(text) && session.context.employeeGroup?.length;
        const employeeNames = employeeName ? null : department
            ? dedupeNames(await db_fns.getAllEmployees({ department }))
            : useGroup ? dedupeNames(session.context.employeeGroup.map(name => ({ name }))) : null;
        const scopeLabel = department ? `Among employees in **${department}**` : useGroup ? `Among the ${employeeNames.length} employees just discussed` : null;
        if (employeeNames && employeeNames.length === 0) {
            const result = { message: `I don't have any employees in that scope, so I can't summarize WFH requests for it. Please choose a department or employee from the available results.`, needsClarification: true };
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
        const params = { ...(employeeName ? { employee_name: employeeName } : {}), ...(employeeNames ? { employee_names: employeeNames } : {}), startDate: timeframe?.startDate, endDate: timeframe?.endDate };
        if (scopeLabel) params.scopeLabel = scopeLabel;
        const wantsRecords = /\b(?:records?|dates?|when|history|reason|why)\b/i.test(text) || /\b(?:list|show)\b.*\b(?:requests?|entries|dates?)\b/i.test(text) || /\bwho\b.*\b(?:wfh|work\s*from\s*home)\b/i.test(text);
        let raw;
        if (wantsRecords && employeeNames?.length) {
            const records = await Promise.all(employeeNames.map(name => db_fns.getAllWfh({ employee_name: name, startDate: params.startDate, endDate: params.endDate, limit: 100 })));
            raw = { wfh_records: records.flat() };
        } else if (wantsRecords) {
            raw = { wfh_records: await db_fns.getAllWfh({ ...params, limit: 100 }) };
        } else if (employeeNames?.length) {
            const summaries = await Promise.all(employeeNames.map(employee_name => db_fns.getWfhSummary({ employee_name, startDate: params.startDate, endDate: params.endDate })));
            const top_employees = employeeNames.map((employee_name, i) => ({ employee_name, total_requests: summaries[i].total_records })).sort((a, b) => b.total_requests - a.total_requests);
            raw = { wfh_summary: { total_records: top_employees.reduce((sum, e) => sum + e.total_requests, 0), unique_employees: top_employees.filter(e => e.total_requests > 0).length, top_employees, department_breakdown: [] } };
            params.scopeLabel = `Among the ${employeeNames.length} employees just discussed`;
        } else {
            raw = { wfh_summary: await db_fns.getWfhSummary(params) };
        }
        const toolName = wantsRecords ? "get_wfh_records" : "get_wfh_summary";
        const result = formatToolResult(toolName, params, raw, session, text);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (/\bleave|leaves|absence|absences\b/i.test(text) && !/\b(?:create|add|apply|book|request)\b/i.test(text)) {
        const employeeName = await extractEmployeeNameFromText(text, session.context);
        const useGroup = !employeeName && !department && followsPreviousGroup(text) && session.context.employeeGroup?.length;
        const employeeRecords = employeeName ? await db_fns.getByName(employeeName) : department
            ? await db_fns.getAllEmployees({ department })
            : useGroup ? session.context.employeeDetails : null;
        if (employeeRecords && employeeRecords.length === 0) {
            const result = { message: `I don't have any employees in that scope, so I can't summarize leave for it. Please choose a department or employee from the available results.`, needsClarification: true };
            session.history.push({ role: "assistant", content: result.message });
            return result;
        }
        const employeeNames = employeeRecords?.map(employee => employee.name) || null;
        const scopeLabel = department ? `Among employees in **${department}**` : useGroup ? `Among the ${employeeRecords.length} employees just discussed` : null;
        const params = { ...(employeeName ? { employee_name: employeeName } : {}), ...(employeeNames ? { employee_names: employeeNames } : {}), startDate: timeframe?.startDate, endDate: timeframe?.endDate };
        if (scopeLabel) params.scopeLabel = scopeLabel;
        const wantsRecords = /\b(?:records?|dates?|when|history|which days|types?|full.day|half.day)\b/i.test(text) || /\b(?:list|show)\b.*\b(?:requests?|entries|dates?)\b/i.test(text) || /\b(?:who|which employees?)\b.*\b(?:took|on|had)\b.*\bleave\b/i.test(text);
        let raw;
        if (wantsRecords && employeeRecords?.length && !employeeName) {
            const records = await Promise.all(employeeRecords.map(employee => db_fns.getAllLeaves({ employee_id: employee.id, employee_name: employee.name, startDate: params.startDate, endDate: params.endDate, limit: 100 })));
            raw = { leave_records: records.flat() };
        } else if (wantsRecords) {
            raw = { leave_records: await db_fns.getAllLeaves({ ...params, limit: 100 }) };
        } else if (employeeRecords?.length && !employeeName) {
            const summaries = await Promise.all(employeeRecords.map(employee => db_fns.getLeaveSummary({ employee_id: employee.id, employee_name: employee.name, startDate: params.startDate, endDate: params.endDate })));
            const nameCounts = new Map();
            employeeRecords.forEach(employee => nameCounts.set(employee.name.toLowerCase(), (nameCounts.get(employee.name.toLowerCase()) || 0) + 1));
            const top_employees = employeeRecords.map((employee, i) => ({
                employee_name: nameCounts.get(employee.name.toLowerCase()) > 1 ? `${employee.name} (${employee.department || `ID ${employee.id}`})` : employee.name,
                employee_real_name: employee.name,
                employee_id: employee.id,
                department: employee.department,
                total_days: summaries[i].total_days,
                records_count: summaries[i].total_records
            })).sort((a, b) => b.total_days - a.total_days);
            raw = { leave_summary: { total_days: top_employees.reduce((sum, e) => sum + e.total_days, 0), total_records: top_employees.reduce((sum, e) => sum + e.records_count, 0), unique_employees: top_employees.filter(e => e.records_count > 0).length, top_employees, department_breakdown: [] } };
        } else {
            raw = { leave_summary: await db_fns.getLeaveSummary(params) };
        }
        const toolName = wantsRecords ? "get_leave_records" : "get_leave_summary";
        const result = formatToolResult(toolName, params, raw, session, text);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

    if (/\b(?:overall|overview|analytics|dashboard|company metrics|HR summary)\b/i.test(text)) {
        const analytics = await db_fns.getHrAnalytics();
        const result = formatToolResult("get_hr_analytics", {}, { hr_analytics: analytics }, session, text);
        session.history.push({ role: "assistant", content: result.message });
        return result;
    }

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
        if (llmResult.formattedResult) {
            session.history.push({ role: "assistant", content: llmResult.formattedResult.message });
            return llmResult.formattedResult;
        }

        if (llmResult.text && !isHrDataQuestion(text)) {
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
