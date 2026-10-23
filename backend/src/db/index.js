import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});


// create a record in db

const create_employees = async(data) =>{

    // create db record
    const result = await pool.query(
        
        `INSERT INTO employees (name, department)
         VALUES ($1, $2)
         RETURNING *`,
        [data.name, data.department]
    );
    
    return result.rows[0];

}

const create_leaves = async (data) => {

    const result = await pool.query(
        `INSERT INTO leave_records (employee_name, leave_date, leave_type, no_of_leaves)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [data.employee_name, data.leave_date, data.leave_type, data.no_of_leaves]
    );

    return result.rows[0];
};

const create_wfh = async (data) => {

    const result = await pool.query(
        `INSERT INTO wfh (employee_name, wfh_date, reason)

         VALUES ($1, $2, $3)

         RETURNING *`,

        [data.employee_name, data.wfh_date, data.reason]

    )

    return result.rows[0];
};

// retreive a record in db with id
const getById = async(id) =>{

    // retreive db record
    const result = await pool.query(
        
        `SELECT * FROM employees WHERE id = $1`,
        [id]
    );
    
    return result.rows[0];

}


// retreive all records in db
const getAllEmployees = async() =>{

    // retreive db record
    const result = await pool.query(
        
        `SELECT * FROM employees`
    );
    
    return result.rows;

}


const getAllLeaves = async() => {
    // function to get all leaves
    const result  = await pool.query(
        'SELECT * FROM leave_records'
    );

    return result.rows;
}

const getAllWfh = async() => {
    // function to get all leaves
    const result  = await pool.query(
        'SELECT * FROM wfh'
    );

    return result.rows;
}
export const db_fns = {
    create_employees,
    getById,
    getAllEmployees,
    getAllLeaves,
    getAllWfh,
    create_leaves,
    create_wfh
}

