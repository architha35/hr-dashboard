require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const pool = require("./db/db");
const { db_fns } = require("./db");

const app = express();

app.use(express.json());

const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://localhost:3000",
        "https://hr-dashboard-2-65et.onrender.com",
        ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
];

app.use(cors({ origin: allowedOrigins }));

app.get("/api/test", async (req,res ) => {
  return res.send("working!");
});

const safeEqual = (left, right) => crypto.timingSafeEqual(
    crypto.createHash("sha256").update(String(left)).digest(),
    crypto.createHash("sha256").update(String(right)).digest()
);

const issueAuthToken = () => {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
    const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
    return `${payload}.${signature}`;
};

const isValidAuthToken = (token) => {
    if (!token || !process.env.SESSION_SECRET) return false;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
    if (!safeEqual(signature, expected)) return false;
    try {
        return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
    } catch {
        return false;
    }
};

app.post("/api/auth/login", (req, res) => {
    if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
        return res.status(503).json({ error: "Admin authentication is not configured" });
    }
    const { password } = req.body || {};
    if (!password || !safeEqual(password, process.env.ADMIN_PASSWORD)) {
        return res.status(401).json({ error: "Incorrect password" });
    }
    return res.json({ token: issueAuthToken() });
});

app.get("/api/auth/session", (req, res) => {
    const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    return isValidAuthToken(token) ? res.json({ authenticated: true }) : res.status(401).json({ authenticated: false });
});

app.use("/api", (req, res, next) => {
    if (req.path === "/test" || req.path === "/auth/login" || req.path === "/auth/session") return next();
    const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!isValidAuthToken(token)) return res.status(401).json({ error: "Authentication required" });
    return next();
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
const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
