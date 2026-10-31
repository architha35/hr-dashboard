require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db/db");
const { db_fns } = require("./db");

const app = express();

app.use(express.json());

app.use(cors({
    origin: [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "https://hr-dashboard-2-65et.onrender.com"
    ]
}));

app.get("/api/test", async (req,res ) => {
  return res.send("working!");
});

// Employee search endpoint: queries DB for matching names
app.get("/api/employees/search", async (req, res) => {
    try {
        const searchTerm = req.query.q ?? req.query.query ?? req.query.search ?? req.query.name ?? "";
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

        if (!searchTerm || typeof searchTerm !== "string" || !searchTerm.trim()) {
            return res.json([]);
        }

        const result = await db_fns.searchEmployees(searchTerm, limit);
        return res.json(result);
    } catch (error) {
        console.error("Error searching employees:", error.message);
        return res.status(500).json({ error: error.message || "Failed to search employees" });
    }
});

app.get("/api/employees", async (req, res) => {
    try {
        const search = req.query.q ?? req.query.query ?? req.query.search ?? req.query.name;
        if (search && typeof search === "string" && search.trim()) {
            const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
            const result = await db_fns.searchEmployees(search, limit);
            return res.json(result);
        }

        const result = await db_fns.getAllEmployees();
        return res.json(result);
    } catch (error) {
        console.error("Error fetching employees:", error.message);
        return res.status(500).json({ error: error.message || "Failed to fetch employees" });
    }
});

app.post("/api/create/employee", async (req, res) => {
    try {
        const data = req.body;
        if (!data || !data.name || !data.department) {
            return res.status(400).json({ error: "Name and department are required" });
        }
        const result = await db_fns.create_employees(data);
        return res.json(result);
    } catch (error) {
        console.error("Error creating employee:", error.message);
        return res.status(500).json({ error: error.message || "Failed to create employee" });
    }
});

app.get("/api/leaves", async (req, res) => {
    try {
        const result = await db_fns.getAllLeaves();
        return res.json(result);
    } catch (error) {
        console.error("Error fetching leaves:", error.message);
        return res.status(500).json({ error: error.message || "Failed to fetch leaves" });
    }
});

app.get("/api/wfh", async (req, res) => {
    try {
        const result = await db_fns.getAllWfh();
        return res.json(result);
    } catch (error) {
        console.error("Error fetching WFH:", error.message);
        return res.status(500).json({ error: error.message || "Failed to fetch WFH records" });
    }
});

app.post("/api/create/leaves", async (req, res) => {
    try {
        const data = req.body;

        console.log("Data received:", data);

        // if data is {}
        if (!data || !Object.keys(data).length) {
            return res.status(400).send("Data is empty");
        }

        if (!data.employee_name || !data.leave_date ||
            !data.leave_type || !data.no_of_leaves) {
            return res.status(400).send("Please fill all fields");
        }

        const result = await db_fns.create_leaves(data);

        console.log("Database result:", result);

        return res.json(result);

    } catch (error) {
        console.error("Database error:", error.message);

        return res.status(500).json({
            error: error.message
        });
    }
});

app.post("/api/create/wfh", async (req, res) => {

    try {

        const data = req.body;

        if (!data.employee_name || !data.wfh_date || !data.reason) {

            return res.status(400).send("Please fill all fields");

        }

        const result = await db_fns.create_wfh(data);

        return res.json(result);

    } catch (error) {

        console.error("Error creating WFH:", error.message);

        return res.status(500).send("Failed to create WFH");

    }

});

// ------------------------------------------
// AGENT CHAT ENDPOINT
// ------------------------------------------
const { processMessage } = require("./agent/engine");

app.post("/api/agent/chat", async (req, res) => {
    try {
        const { message, sessionId = "default_session", confirmationAction } = req.body;

        if (!message && !confirmationAction) {
            return res.status(400).json({ error: "Message or confirmationAction is required" });
        }

        const response = await processMessage({
            message,
            sessionId,
            confirmationAction
        });

        return res.json(response);
    } catch (error) {
        console.error("Agent chat error:", error);
        return res.status(500).json({
            message: "An internal error occurred while processing your request.",
            error: error.message
        });
    }
});

app.get("/api/agent/audit", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50"
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Safety: Catch unhandled rejections and exceptions to ensure continuous availability
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Promise Rejection caught:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception caught:", err?.message || err);
});

// Start Server
app.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});