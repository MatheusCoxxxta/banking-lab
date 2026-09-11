const pool = require("../db");

const findById = async (id, executor = pool) => {
    const result = await executor.query(
        `SELECT * FROM accounts WHERE id = $1`,
        [id]
    );
    return result.rows[0];
};

const findByIdForUpdate = async (id, executor = pool) => {
    const result = await executor.query(
        `SELECT * FROM accounts WHERE id = $1 FOR UPDATE`,
        [id]
    );
    return result.rows[0];
};

const insert = async (name, currency, balance, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO accounts (name, currency, balance)
         VALUES ($1, $2, $3)
         RETURNING id, name, currency, balance, created_at`,
        [name, currency, balance]
    );
    return result.rows[0];
};

module.exports = { findById, findByIdForUpdate, insert };
