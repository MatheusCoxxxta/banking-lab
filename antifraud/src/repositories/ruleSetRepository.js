const pool = require("../db");
const { buildSelect } = require("./buildSelect");

const COLUMNS = [
    "version",
    "thresholds",
    "hard_rules",
    "rules",
    "created_at",
];

const select = async (query = {}, executor = pool) => {
    const { text, params } = buildSelect("rule_sets", COLUMNS, query);
    const result = await executor.query(text, params);
    return result.rows;
};

// rule sets são imutáveis: sem update, mudança = versão nova
const insert = async (version, thresholds, hard_rules, rules, executor = pool) => {
    const result = await executor.query(
        `INSERT INTO rule_sets (version, thresholds, hard_rules, rules)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [version, JSON.stringify(thresholds), JSON.stringify(hard_rules), JSON.stringify(rules)]
    );
    return result.rows[0];
};

module.exports = { select, insert };
