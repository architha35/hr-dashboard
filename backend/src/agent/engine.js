const { tools } = require("./tools");
const { db_fns } = require("../db");

// Session store: Map<sessionId, SessionState>
const sessions = new Map();

// Reference date for date math
const getToday = () => {
    const now = new Date();
    if (now.getFullYear() < 2026) {
        return new Date("2026-11-01T12:00:00Z");
    }
    return now;
};

const formatDate = (date) => {
    return date.toISOString().slice(0, 10);
};

const getSession = (sessionId = "default") => {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            id: sessionId,
            history: [],
            context: {
                activeEmployee: null,
                activeDepartment: null,
                activeTimeframe: null,
                lastTopic: null,
            },
            pendingProposal: null,
        });
    }
    return sessions.get(sessionId);
};

/**
 * Natural Language Date Parsing Helper
 */
const parseTimeframe = (text) => {
    const today = getToday();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed

    // "this month"
    if (/this\s+month/i.test(text)) {
        const start = new Date(Date.UTC(currentYear, currentMonth, 1));
        const end = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
        return {
            label: "this month",
            startDate: formatDate(start),
            endDate: formatDate(end),
        };
    }

    // "last three months" or "last 3 months"
    const lastMonthsMatch = text.match(/last\s+(\d+|one|two|three|four|five|six)\s+months?/i);
    if (lastMonthsMatch) {
        let count = 3;
        const numStr = lastMonthsMatch[1].toLowerCase();
        if (numStr === "one" || numStr === "1") count = 1;
        else if (numStr === "two" || numStr === "2") count = 2;
        else if (numStr === "three" || numStr === "3") count = 3;
        else if (numStr === "four" || numStr === "4") count = 4;
        else if (numStr === "five" || numStr === "5") count = 5;
        else if (numStr === "six" || numStr === "6") count = 6;
        else if (parseInt(numStr, 10)) count = parseInt(numStr, 10);

        const start = new Date(Date.UTC(currentYear, currentMonth - count, 1));
        const end = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
        return {
            label: `last ${count} months`,
            startDate: formatDate(start),
            endDate: formatDate(end),
        };
    }

    // "this year"
    if (/this\s+year/i.test(text)) {
        const start = new Date(Date.UTC(currentYear, 0, 1));
        const end = new Date(Date.UTC(currentYear, 11, 31));
        return {
            label: "this year",
            startDate: formatDate(start),
            endDate: formatDate(end),
        };
    }

    // "this week"
    if (/this\s+week/i.test(text)) {
        const dayOfWeek = today.getDay(); // 0 is Sunday
        const start = new Date(today);
        start.setDate(today.getDate() - dayOfWeek);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return {
            label: "this week",
            startDate: formatDate(start),
            endDate: formatDate(end),
        };
    }

    // Date range: e.g. "from 3rd November to 5th November" or "between 1st and 15th November"
    const rangeMatch = text.match(/(?:from|between)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(?:to|and)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)?/i);
    if (rangeMatch) {
        const d1 = parseInt(rangeMatch[1], 10);
        const m1 = rangeMatch[2];
        const d2 = parseInt(rangeMatch[3], 10);
        const m2 = rangeMatch[4] || m1;

        const parseMonth = (m) => {
            const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
            const idx = months.findIndex((name) => m.toLowerCase().startsWith(name));
            return idx !== -1 ? idx : currentMonth;
        };

        const month1 = parseMonth(m1);
        const month2 = parseMonth(m2);

        const start = new Date(Date.UTC(currentYear, month1, d1));
        const end = new Date(Date.UTC(currentYear, month2, d2));

        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const daysCount = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
            return {
                label: `${d1} ${m1} to ${d2} ${m2} ${currentYear}`,
                startDate: formatDate(start),
                endDate: formatDate(end),
                daysCount: Math.max(daysCount, 1),
            };
        }
    }

    // Single specific date: e.g. "on 5th November" or "on 12th November" or "4th November"
    const singleMatch = text.match(/(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (singleMatch) {
        const d = parseInt(singleMatch[1], 10);
        const m = singleMatch[2];
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const monthIndex = months.findIndex((name) => m.toLowerCase().startsWith(name));
        if (monthIndex !== -1) {
            const dateObj = new Date(Date.UTC(currentYear, monthIndex, d));
            return {
                label: `${d} ${m} ${currentYear}`,
                date: formatDate(dateObj),
                startDate: formatDate(dateObj),
                endDate: formatDate(dateObj),
            };
        }
    }

    // Direct ISO date: YYYY-MM-DD
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
        return {
            label: isoMatch[1],
            date: isoMatch[1],
            startDate: isoMatch[1],
            endDate: isoMatch[1],
        };
    }

    return null;
};

/**
 * Extract Employee Name from text
 */
const extractEmployeeName = async (text, sessionContext) => {
    // If text explicitly targets all employees, do not bind to specific employee
    if (/all\s+employees|by\s+all|all\s+staff|everyone|every\s+employee/i.test(text)) {
        return null;
    }

    // Check for ID references first
    const idMatch = text.match(/(?:employee\s+id|record\s+id|id)\s*[:#]?\s*(\d+)/i);
    if (idMatch) {
        const id = idMatch[1];
        const emp = await db_fns.getById(id);
        if (emp) return emp.name;
    }

    const stopWords = new Set([
        "create", "leaves", "leave", "wfh", "home", "work", "from", "for", "to", "on", "in",
        "update", "delete", "department", "show", "give", "how", "many", "all", "the", "an",
        "employee", "new", "record", "request", "requests", "total", "submitted", "taken",
        "last", "this", "month", "year", "week", "three", "two", "one", "engineering", "sde",
        "details", "information", "what", "about"
    ]);

    // Check against existing employees in database
    const allEmployees = await db_fns.getAllEmployees();
    for (const emp of allEmployees) {
        const regex = new RegExp(`\\b${emp.name}\\b`, "i");
        if (regex.test(text)) {
            return emp.name;
        }
    }

    // Patterns like "for <Name>", "named <Name>", "of <Name>", "change <Name>'s", "update <Name>'s", "delete <Name>'s"
    const nameMatch = text.match(/(?:for|named|about|change|update|delete|remove)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch) {
        const candidate = nameMatch[1].trim();
        if (!stopWords.has(candidate.toLowerCase())) {
            return candidate;
        }
    }

    // Context carryover: check if user asks follow-up about previous employee
    if (sessionContext && sessionContext.activeEmployee) {
        if (/(?:he|she|they|him|her|this\s+employee|the\s+same|what\s+about|how\s+about|and\s+wfh|and\s+leaves)/i.test(text)) {
            return sessionContext.activeEmployee;
        }
    }

    return null;
};

/**
 * Extract Department from text
 */
const extractDepartment = (text) => {
    const depts = [
        "AI and ML", "Artificial Intelligence", "Machine Learning",
        "Engineering", "Software Engineering", "SDE",
        "Product Management", "Product Manager", "Business Development",
        "Human Resources", "HR", "Sales", "Marketing", "Finance", "Operations", "aaa", "abc"
    ];

    for (const dept of depts) {
        const reg = new RegExp(`\\b${dept}\\b`, "i");
        if (reg.test(text)) {
            return dept;
        }
    }

    const deptMatch = text.match(/(?:department(?:\s+to)?|in\s+(?:the\s+)?)\s*[:]?\s*([A-Za-z0-9\s&]+?)(?:\s+department|\.|$)/i);
    if (deptMatch) {
        const candidate = deptMatch[1].trim();
        if (candidate.length > 1 && !/^(all|this|the|an|a|new|which)$/i.test(candidate)) {
            return candidate;
        }
    }

    return null;
};

/**
 * Main Message Processing Function
 */
const processMessage = async ({ message, sessionId = "default", confirmationAction = null }) => {
    const session = getSession(sessionId);
    const text = (message || "").trim();

    // ==========================================
    // 1. CONFIRMATION & CANCELLATION WORKFLOW
    // ==========================================

    // Handle structured confirmation action (e.g. from UI buttons)
    if (confirmationAction) {
        const { actionId, confirmed } = confirmationAction;
        const proposal = session.pendingProposal;

        if (!proposal || proposal.id !== actionId) {
            return {
                message: "No matching pending action found or the action has expired.",
                status: "EXPIRED"
            };
        }

        session.pendingProposal = null; // Clear proposal

        if (!confirmed) {
            return {
                message: `Action cancelled: ${proposal.summary}. No changes were made to the database.`,
                status: "CANCELLED",
                actionProposal: null
            };
        }

        // Execute confirmed action
        try {
            const toolFn = tools[proposal.tool];
            if (!toolFn) throw new Error(`Unknown tool: ${proposal.tool}`);

            const result = await toolFn(proposal.params);

            return {
                message: `✅ Successfully executed: ${proposal.summary}`,
                status: "COMPLETED",
                actionResult: {
                    type: proposal.type,
                    data: result
                },
                structuredData: {
                    type: "card",
                    title: "Operation Completed",
                    data: result
                }
            };
        } catch (err) {
            console.error("Error executing confirmed action:", err);
            return {
                message: `❌ Failed to execute action: ${err.message}`,
                status: "FAILED",
                error: err.message
            };
        }
    }

    // Handle text-based confirmation if there is an active pending proposal
    if (session.pendingProposal) {
        const isConfirm = /\b(yes|confirm|proceed|ok|okay|sure|go ahead|do it|execute|agree|accepted)\b/i.test(text);
        const isCancel = /\b(no|cancel|abort|stop|don't|dont|nevermind|reject)\b/i.test(text);

        if (isConfirm && !isCancel) {
            return await processMessage({
                sessionId,
                confirmationAction: { actionId: session.pendingProposal.id, confirmed: true }
            });
        } else if (isCancel) {
            return await processMessage({
                sessionId,
                confirmationAction: { actionId: session.pendingProposal.id, confirmed: false }
            });
        }
    }

    // ==========================================
    // 2. INTENT RECOGNITION & ROUTING
    // ==========================================

    const lower = text.toLowerCase();
    const timeframe = parseTimeframe(text) || session.context.activeTimeframe;
    const employeeName = await extractEmployeeName(text, session.context);
    const department = extractDepartment(text);

    // Update active context if detected
    if (employeeName) session.context.activeEmployee = employeeName;
    if (department) session.context.activeDepartment = department;
    if (timeframe) session.context.activeTimeframe = timeframe;

    // ------------------------------------------
    // A. CREATE LEAVE INTENT
    // e.g., "Create leaves for Rohit from 3rd November to 5th November."
    // ------------------------------------------
    if (/(?:create|apply|add|book|request)\s+(?:a\s+)?leave/i.test(lower) ||
        (/leave/i.test(lower) && /(?:from|for|on)\s+[A-Za-z0-9]+/i.test(lower) && /(?:create|add)/i.test(lower))) {

        if (!employeeName) {
            return {
                message: "Which employee should I create leaves for? Please specify their name.",
                needsClarification: true
            };
        }

        const tf = parseTimeframe(text);
        if (!tf || (!tf.date && !tf.startDate)) {
            return {
                message: `What date or date range should the leave be for ${employeeName}? (e.g. from 3rd November to 5th November, or on 10th November)`,
                needsClarification: true
            };
        }

        const isHalfDay = /half(?:\s*|-)?day/i.test(lower);
        const leaveType = isHalfDay ? "HALF_DAY" : "FULL_DAY";
        const days = tf.daysCount || (isHalfDay ? 0.5 : 1);

        const startDate = tf.startDate || tf.date;
        const endDate = tf.endDate || tf.date;

        const proposal = {
            id: `act_${Date.now()}`,
            type: "CREATE_LEAVE",
            tool: startDate === endDate ? "create_leave" : "create_leave_range",
            params: startDate === endDate ? {
                employee_name: employeeName,
                leave_date: startDate,
                leave_type: leaveType,
                no_of_leaves: days
            } : {
                employee_name: employeeName,
                startDate,
                endDate,
                leave_type: leaveType,
                no_of_leaves_per_day: 1
            },
            title: "Create Leave Request",
            summary: `Create ${days} day(s) of ${leaveType} leave for ${employeeName} (${startDate === endDate ? startDate : `${startDate} to ${endDate}`})`,
            details: {
                Employee: employeeName,
                "Start Date": startDate,
                "End Date": endDate,
                "Leave Type": leaveType,
                "Total Days": days
            }
        };

        session.pendingProposal = proposal;

        return {
            message: `I've prepared the leave request for **${employeeName}**. Please confirm to proceed:`,
            requiresConfirmation: true,
            actionProposal: proposal
        };
    }

    // ------------------------------------------
    // B. CREATE WFH INTENT
    // e.g., "Create a WFH request for Rohit on 5th November."
    // ------------------------------------------
    if (/(?:create|apply|add|request)\s+(?:a\s+)?(?:wfh|work[-\s]+from[-\s]+home)/i.test(lower)) {
        if (!employeeName) {
            return {
                message: "Which employee would like to request Work From Home? Please specify their name.",
                needsClarification: true
            };
        }

        const tf = parseTimeframe(text);
        const wfhDate = tf?.date || tf?.startDate;

        if (!wfhDate) {
            return {
                message: `What date should the WFH request be for ${employeeName}? (e.g. on 5th November)`,
                needsClarification: true
            };
        }

        let reason = "Remote work";
        const reasonMatch = text.match(/(?:reason|for|because)\s*[:]?\s*(?:of\s+)?([A-Za-z0-9\s,]+?)(?:\s+on|\.|$)/i);
        if (reasonMatch && !/^(5th|november|wfh|employee)$/i.test(reasonMatch[1].trim())) {
            reason = reasonMatch[1].trim();
        }

        const proposal = {
            id: `act_${Date.now()}`,
            type: "CREATE_WFH",
            tool: "create_wfh",
            params: {
                employee_name: employeeName,
                wfh_date: wfhDate,
                reason
            },
            title: "Create Work From Home Request",
            summary: `Create WFH request for ${employeeName} on ${wfhDate} (Reason: ${reason})`,
            details: {
                Employee: employeeName,
                Date: wfhDate,
                Reason: reason
            }
        };

        session.pendingProposal = proposal;

        return {
            message: `I've prepared the Work From Home request for **${employeeName}**. Please confirm to submit:`,
            requiresConfirmation: true,
            actionProposal: proposal
        };
    }

    // ------------------------------------------
    // C. CREATE EMPLOYEE INTENT
    // e.g., "Create a new employee named Rohit in the AI and ML department."
    // ------------------------------------------
    if (/(?:create|add|register|hire)\s+(?:a\s+)?(?:new\s+)?employee/i.test(lower)) {
        if (!employeeName) {
            return {
                message: "What is the name of the new employee? (e.g. 'Create a new employee named Rohit in Engineering')",
                needsClarification: true
            };
        }

        if (!department) {
            return {
                message: `Which department should ${employeeName} be assigned to?`,
                needsClarification: true
            };
        }

        const proposal = {
            id: `act_${Date.now()}`,
            type: "CREATE_EMPLOYEE",
            tool: "create_employee",
            params: {
                name: employeeName,
                department,
                is_active: true
            },
            title: "Add New Employee",
            summary: `Add ${employeeName} to the ${department} department`,
            details: {
                Name: employeeName,
                Department: department,
                Status: "Active"
            }
        };

        session.pendingProposal = proposal;

        return {
            message: `I've prepared the registration for new employee **${employeeName}**. Please confirm to add:`,
            requiresConfirmation: true,
            actionProposal: proposal
        };
    }

    // ------------------------------------------
    // D. UPDATE EMPLOYEE INTENT
    // e.g., "Update Rohit's department to AI and ML." or "Change Rohit’s department to AI and ML."
    // ------------------------------------------
    if (/(?:update|change|modify)\s+(?:employee|department|[A-Za-z]+'s\s+department)/i.test(lower)) {
        const idMatch = text.match(/(?:employee\s+id|id)\s*[:#]?\s*(\d+)/i);
        let emp = null;

        if (idMatch) {
            emp = await db_fns.getById(idMatch[1]);
        } else if (employeeName) {
            const matches = await db_fns.getByName(employeeName);
            if (matches.length === 1) {
                emp = matches[0];
            } else if (matches.length > 1) {
                return {
                    message: `Found multiple employees named '${employeeName}'. Please specify by ID:\n` +
                        matches.map((m) => `• ID ${m.id} (${m.name} - ${m.department})`).join("\n"),
                    needsClarification: true
                };
            }
        }

        if (!emp) {
            return {
                message: "Which employee would you like to update? Please provide their name or ID.",
                needsClarification: true
            };
        }

        if (!department) {
            return {
                message: `What should ${emp.name}'s new department be?`,
                needsClarification: true
            };
        }

        const proposal = {
            id: `act_${Date.now()}`,
            type: "UPDATE_EMPLOYEE",
            tool: "update_employee",
            params: {
                id: emp.id,
                department
            },
            title: "Update Employee Department",
            summary: `Change department of ${emp.name} (ID: ${emp.id}) from "${emp.department}" to "${department}"`,
            details: {
                "Employee ID": emp.id,
                Name: emp.name,
                "Current Department": emp.department,
                "New Department": department
            }
        };

        session.pendingProposal = proposal;

        return {
            message: `Please confirm updating the department for **${emp.name}**:`,
            requiresConfirmation: true,
            actionProposal: proposal
        };
    }

    // ------------------------------------------
    // E. DELETE EMPLOYEE INTENT
    // e.g., "Delete the employee record for Rohit." or "Delete employee ID 125."
    // ------------------------------------------
    if (/(?:delete|remove|deactivate)\s+(?:the\s+)?(?:employee|record)/i.test(lower)) {
        const idMatch = text.match(/(?:employee\s+id|id)\s*[:#]?\s*(\d+)/i);
        let emp = null;

        if (idMatch) {
            emp = await db_fns.getById(idMatch[1]);
        } else if (employeeName) {
            const matches = await db_fns.getByName(employeeName);
            if (matches.length === 1) {
                emp = matches[0];
            } else if (matches.length > 1) {
                return {
                    message: `Found multiple employees named '${employeeName}'. Please specify the ID to delete:\n` +
                        matches.map((m) => `• ID ${m.id} (${m.name} - ${m.department})`).join("\n"),
                    needsClarification: true
                };
            }
        }

        if (!emp) {
            return {
                message: "Which employee record would you like to delete? Please provide their name or ID.",
                needsClarification: true
            };
        }

        const associatedLeaves = await db_fns.getAllLeaves({ employee_name: emp.name });
        const associatedWfh = await db_fns.getAllWfh({ employee_name: emp.name });

        const proposal = {
            id: `act_${Date.now()}`,
            type: "DELETE_EMPLOYEE",
            tool: "delete_employee",
            params: {
                id: emp.id,
                soft: true
            },
            title: "Deactivate Employee Record",
            summary: `Deactivate employee ${emp.name} (ID: ${emp.id}) in ${emp.department}`,
            warning: associatedLeaves.length || associatedWfh.length
                ? `Note: ${emp.name} has ${associatedLeaves.length} leave record(s) and ${associatedWfh.length} WFH request(s). Soft deactivation preserves audit trail.`
                : undefined,
            details: {
                "Employee ID": emp.id,
                Name: emp.name,
                Department: emp.department,
                "Associated Leaves": associatedLeaves.length,
                "Associated WFH": associatedWfh.length,
                Action: "Deactivate (Soft Delete)"
            }
        };

        session.pendingProposal = proposal;

        return {
            message: `⚠️ **Warning**: You are requesting to remove **${emp.name}** (ID: ${emp.id}). Please review and confirm:`,
            requiresConfirmation: true,
            actionProposal: proposal
        };
    }

    // ------------------------------------------
    // F. WORK FROM HOME RETRIEVAL & ANALYTICS
    // e.g., "Give me the total number of work-from-home requests submitted by all employees this month."
    // Follow up: "What about work-from-home requests?"
    // ------------------------------------------
    if (/(?:wfh|work[-\s]+from[-\s]+home)/i.test(lower) && !/(?:create|add|apply|request)\s+(?:a\s+)?(?:wfh|work)/i.test(lower)) {
        session.context.lastTopic = "wfh";

        // Department breakdown
        if (/(?:by|each|per)\s+department/i.test(lower)) {
            const summary = await db_fns.getWfhSummary({
                startDate: timeframe?.startDate,
                endDate: timeframe?.endDate
            });

            return {
                message: `Here is the WFH request count by department ${timeframe ? `for **${timeframe.label}**` : ""}:`,
                structuredData: {
                    type: "table",
                    title: "WFH Requests by Department",
                    columns: ["Department", "Total WFH Requests"],
                    rows: summary.department_breakdown.map((d) => [d.department, d.total_requests])
                }
            };
        }

        // Specific employee WFH history
        if (employeeName) {
            const summary = await db_fns.getWfhSummary({
                employee_name: employeeName,
                startDate: timeframe?.startDate,
                endDate: timeframe?.endDate
            });

            const records = await db_fns.getAllWfh({
                employee_name: employeeName,
                startDate: timeframe?.startDate,
                endDate: timeframe?.endDate,
                limit: 10
            });

            const tfLabel = timeframe ? ` in the ${timeframe.label}` : " in total";

            return {
                message: `**${employeeName}** has submitted **${summary.total_records} Work From Home request(s)**${tfLabel}.`,
                structuredData: records.length ? {
                    type: "table",
                    title: `WFH Records for ${employeeName}`,
                    columns: ["ID", "WFH Date", "Reason"],
                    rows: records.map((r) => [r.id, String(r.wfh_date).slice(0, 10), r.reason || "N/A"])
                } : null
            };
        }

        // Total WFH requests submitted by all employees
        const tf = parseTimeframe(text) || {
            startDate: `${getToday().getFullYear()}-${String(getToday().getMonth() + 1).padStart(2, "0")}-01`,
            label: "this month"
        };

        const summary = await db_fns.getWfhSummary({
            startDate: tf.startDate,
            endDate: tf.endDate
        });

        const topRequester = summary.top_employees[0]
            ? `${summary.top_employees[0].employee_name} (${summary.top_employees[0].total_requests})`
            : "None";

        return {
            message: `Total Work-From-Home requests submitted by all employees **${tf.label}**: **${summary.total_records}** across **${summary.unique_employees} employee(s)**.`,
            structuredData: {
                type: "metrics",
                title: `WFH Summary (${tf.label})`,
                metrics: [
                    { label: "Total WFH Records", value: summary.total_records },
                    { label: "Employees Requesting", value: summary.unique_employees },
                    { label: "Top Requester", value: topRequester },
                    { label: "Period", value: tf.label }
                ]
            }
        };
    }

    // ------------------------------------------
    // G. LEAVE RETRIEVAL & ANALYTICS
    // e.g., "How many leaves has Rohit taken in the last three months?"
    // "Show me the employees who have applied for the most leaves this year."
    // ------------------------------------------
    if (/leave/i.test(lower) && !/(?:create|add|apply|book)/i.test(lower)) {
        session.context.lastTopic = "leaves";

        // Query top requesters
        if (/(?:most|highest|top)\s+leaves/i.test(lower)) {
            const tf = parseTimeframe(text) || { startDate: `${getToday().getFullYear()}-01-01`, label: "this year" };
            const summary = await db_fns.getLeaveSummary({ startDate: tf.startDate, endDate: tf.endDate });

            return {
                message: `Here are the employees who applied for the most leaves during **${tf.label || "the period"}**:`,
                structuredData: {
                    type: "table",
                    title: `Top Leave Requesters (${tf.label || "Overall"})`,
                    columns: ["Employee Name", "Total Days", "Records Count"],
                    rows: summary.top_employees.map((e) => [
                        e.employee_name,
                        `${e.total_days} day(s)`,
                        `${e.records_count} record(s)`
                    ])
                }
            };
        }

        // Query department totals
        if (/(?:by|each|per)\s+department/i.test(lower) || /department(?:'s)?\s+(?:total|breakdown)/i.test(lower)) {
            const summary = await db_fns.getLeaveSummary({
                startDate: timeframe?.startDate,
                endDate: timeframe?.endDate
            });

            return {
                message: `Here is the total leave breakdown by department ${timeframe ? `for **${timeframe.label}**` : ""}:`,
                structuredData: {
                    type: "table",
                    title: "Leave Days by Department",
                    columns: ["Department", "Total Days", "Total Requests"],
                    rows: summary.department_breakdown.map((d) => [
                        d.department,
                        `${d.total_days} day(s)`,
                        `${d.records_count} record(s)`
                    ])
                }
            };
        }

        // Specific employee leave count / history
        if (employeeName) {
            const summary = await db_fns.getLeaveSummary({
                employee_name: employeeName,
                startDate: timeframe?.startDate,
                endDate: timeframe?.endDate
            });

            const records = await db_fns.getAllLeaves({
                employee_name: employeeName,
                startDate: timeframe?.startDate,
                endDate: timeframe?.endDate,
                limit: 10
            });

            const tfLabel = timeframe ? ` in the ${timeframe.label}` : " in total";

            return {
                message: `**${employeeName}** has taken a total of **${summary.total_days} leave day(s)** across **${summary.total_records} record(s)**${tfLabel}.`,
                structuredData: records.length ? {
                    type: "table",
                    title: `Leave Records for ${employeeName}`,
                    columns: ["ID", "Leave Date", "Type", "Days"],
                    rows: records.map((r) => [
                        r.id,
                        String(r.leave_date).slice(0, 10),
                        r.leave_type || "FULL_DAY",
                        r.no_of_leaves
                    ])
                } : null
            };
        }

        // General leave records or count
        const summary = await db_fns.getLeaveSummary({
            startDate: timeframe?.startDate,
            endDate: timeframe?.endDate
        });

        return {
            message: `There are **${summary.total_records} leave records** (${summary.total_days} total leave days) taken by **${summary.unique_employees} employee(s)** ${timeframe ? `in ${timeframe.label}` : "overall"}.`,
            structuredData: {
                type: "metrics",
                title: `Leave Summary (${timeframe ? timeframe.label : "All Time"})`,
                metrics: [
                    { label: "Total Leave Records", value: summary.total_records },
                    { label: "Total Leave Days", value: summary.total_days },
                    { label: "Employees on Leave", value: summary.unique_employees }
                ]
            }
        };
    }

    // ------------------------------------------
    // H. EMPLOYEE RETRIEVAL & LISTING
    // e.g., "Show me all employees in the Engineering department."
    // "Find employee Rohit."
    // "How many active employees do we have?"
    // ------------------------------------------
    if (/(?:show|find|list|get|display|search|who)\s+.*(?:employee|all|engineering|team)/i.test(lower) ||
        (/employee/i.test(lower) && !/(?:leave|wfh)/i.test(lower))) {

        // Count query: "How many active employees do we have?"
        if (/how\s+many\s+active\s+employees/i.test(lower)) {
            const count = await db_fns.countEmployees({ is_active: true });
            return {
                message: `We currently have **${count} active employee(s)** registered in the organization.`,
                structuredData: {
                    type: "card",
                    title: "Active Employees",
                    data: { "Total Active Employees": count }
                }
            };
        }

        // By department: "Show me all employees in the Engineering department."
        if (department) {
            const employees = await db_fns.getAllEmployees({ department });
            return {
                message: `Found **${employees.length} employee(s)** in the **${department}** department:`,
                structuredData: {
                    type: "table",
                    title: `Employees in ${department}`,
                    columns: ["ID", "Name", "Department", "Status"],
                    rows: employees.map((e) => [
                        e.id,
                        e.name,
                        e.department,
                        e.is_active ? "Active" : "Inactive"
                    ])
                }
            };
        }

        // By ID: "Show me the details of employee ID 125."
        const idMatch = text.match(/(?:employee\s+id|id)\s*[:#]?\s*(\d+)/i);
        if (idMatch) {
            const emp = await db_fns.getById(idMatch[1]);
            if (!emp) {
                return {
                    message: `No employee found with ID **${idMatch[1]}**.`
                };
            }
            return {
                message: `Details for employee **${emp.name}** (ID: ${emp.id}):`,
                structuredData: {
                    type: "card",
                    title: `Employee Profile — ${emp.name}`,
                    data: {
                        ID: emp.id,
                        Name: emp.name,
                        Department: emp.department,
                        Status: emp.is_active ? "Active" : "Inactive",
                        "Created At": String(emp.created_at).slice(0, 10)
                    }
                }
            };
        }

        // By name search: "Find employee Rohit."
        if (employeeName) {
            const matches = await db_fns.searchEmployees(employeeName);
            if (!matches.length) {
                return {
                    message: `No employee found matching "${employeeName}".`
                };
            }
            return {
                message: `Found **${matches.length} matching employee(s)** for "${employeeName}":`,
                structuredData: {
                    type: "table",
                    title: `Search Results for "${employeeName}"`,
                    columns: ["ID", "Name", "Department", "Status"],
                    rows: matches.map((e) => [
                        e.id,
                        e.name,
                        e.department,
                        e.is_active ? "Active" : "Inactive"
                    ])
                }
            };
        }

        // Default: Show all employees (limited to 50 for performance)
        const employees = await db_fns.getAllEmployees({ limit: 50 });
        return {
            message: `Here are the employees in your organization (${employees.length} shown):`,
            structuredData: {
                type: "table",
                title: "Employees Directory",
                columns: ["ID", "Name", "Department", "Status"],
                rows: employees.map((e) => [
                    e.id,
                    e.name,
                    e.department,
                    e.is_active ? "Active" : "Inactive"
                ])
            }
        };
    }

    // ------------------------------------------
    // I. GENERAL HR ANALYTICS
    // e.g., "Give me an overview of HR metrics"
    // ------------------------------------------
    if (/(?:overview|analytics|metrics|dashboard|summary|stats)/i.test(lower)) {
        const analytics = await db_fns.getHrAnalytics();
        return {
            message: `Here is the current HR management overview:`,
            structuredData: {
                type: "metrics",
                title: "HR System Overview",
                metrics: [
                    { label: "Active Employees", value: analytics.active_employees },
                    { label: "Total Leave Records", value: analytics.total_leave_records },
                    { label: "Total Leave Days", value: analytics.total_leave_days },
                    { label: "Total WFH Requests", value: analytics.total_wfh_requests }
                ]
            }
        };
    }

    // ------------------------------------------
    // J. FALLBACK / SUGGESTION
    // ------------------------------------------
    return {
        message: `I didn't quite catch the specific HR operation. You can ask me to:
• **"Show me all employees in the Engineering department"**
• **"Create leaves for [Name] from [Date] to [Date]"**
• **"How many leaves has [Name] taken in the last three months?"**
• **"Give me the total number of work-from-home requests this month"**
• **"Update [Name]'s department to [New Department]"**
• **"Delete employee ID [ID]"**`,
        suggestedPrompts: [
            "Show me all employees in the SDE department",
            "Give me the total number of work-from-home requests this month",
            "How many active employees do we have?",
            "Show me the employees who have applied for the most leaves this year"
        ]
    };
};

module.exports = { processMessage, getSession };
