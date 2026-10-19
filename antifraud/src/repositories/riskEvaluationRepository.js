const pool = require("../db");
const { buildSelect, buildCount, buildAvg } = require("./buildSelect");

const COLUMNS = [
    "id",
    "tx_id",
    "origin_account",
    "dest_key",
    "amount",
    "channel",
    "score",
    "decision",
    "reasons",
    "rule_version",
    "features_snapshot",
    "created_at",
];

const select = async (query = {}, executor = pool) => {
    const { text, params } = buildSelect("risk_evaluations", COLUMNS, query);
    const result = await executor.query(text, params);
    return result.rows;
};

const count = async (query = {}, executor = pool) => {
    const { text, params } = buildCount("risk_evaluations", COLUMNS, query);
    const result = await executor.query(text, params);
    return result.rows[0].count;
};

const avg = async (column, query = {}, executor = pool) => {
    const { text, params } = buildAvg("risk_evaluations", COLUMNS, column, query);
    const result = await executor.query(text, params);
    const value = result.rows[0].avg;
    return value === null ? null : Number(value);
};

const insert = async (evaluation, executor = pool) => {
    const {
        tx_id, origin_account, dest_key, amount, channel,
        score, decision, reasons, rule_version, features_snapshot,
    } = evaluation;
    const result = await executor.query(
        `INSERT INTO risk_evaluations
            (tx_id, origin_account, dest_key, amount, channel,
             score, decision, reasons, rule_version, features_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
            tx_id, origin_account, dest_key, amount, channel,
            score, decision, JSON.stringify(reasons), rule_version, JSON.stringify(features_snapshot),
        ]
    );
    return result.rows[0];
};

module.exports = { select, count, avg, insert };
