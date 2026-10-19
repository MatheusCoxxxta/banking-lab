const pool = require("../db");
const { buildSelect } = require("./buildSelect");

const COLUMNS = [
    "account_id",
    "created_at",
];

const select = async (query = {}, executor = pool) => {
    const { text, params } = buildSelect("account_projections", COLUMNS, query);
    const result = await executor.query(text, params);
    return result.rows;
};

const insert = async (account_id, created_at, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO account_projections (account_id, created_at)
         VALUES ($1, $2)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING *`,
        [account_id, created_at]
    );
    return result.rows[0];
};

module.exports = { select, insert };
