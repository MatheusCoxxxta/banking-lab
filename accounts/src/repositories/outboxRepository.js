const pool = require("../db");

const insert = async (source, source_id, payload, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO outbox (source, source_id, payload)
         VALUES ($1, $2, $3)
         RETURNING id, source, source_id, status, payload, created_at`,
        [source, source_id, JSON.stringify(payload)]
    );
    return result.rows[0];
};

const findByStatus = async (status, executor = pool) => {
    const result = await executor.query(
        `SELECT * FROM outbox WHERE status = $1 ORDER BY created_at`,
        [status]
    );
    return result.rows;
};

const updateStatus = async (id, status, executor = pool) => {
    await executor.query(
        `UPDATE outbox SET status = $1, published_at = NOW() WHERE id = $2`,
        [status, id]
    );
};

const incrementAttempt = async (id, executor = pool) => {
    await executor.query(
        `UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`,
        [id]
    );
};

module.exports = { insert, findByStatus, updateStatus, incrementAttempt };
