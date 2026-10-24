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
        "https://hr-dashboard-2-65et.onrender.com"
    ]
}));

app.get("/api/employees", async (req, res) => {
    const result = await db_fns.getAllEmployees();
    console.log("Result. : ", result);
    return res.send(result);
});

app.post("/api/create/employee", async (req, res) => {
    const data = req.body;
    const result = await db_fns.create_employees(data);
    return res.send(result);
});

app.get("/api/leaves", async (req,res) => {
  const result = await db_fns.getAllLeaves();
  console.log(result);
  return res.send(result);
});

app.get("/api/wfh", async (req, res) => {
    const result = await db_fns.getAllWfh();
    console.log(result);
    return res.send(result);
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

// Start Server
app.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
