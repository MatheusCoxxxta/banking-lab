const OPERATORS = {
    eq: "=",
    neq: "<>",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    in: "= ANY",
};

const quote = (column, allowedColumns) => {
    if (!allowedColumns.includes(column)) throw new Error(`unknown column: ${column}`);
    return `"${column}"`;
};

// where: { col: valor } | { col: null } | { col: { gt: v, lte: v, in: [..] } }, condições unidas por AND
const buildWhere = (allowedColumns, where = {}) => {
    const params = [];
    const conditions = [];

    for (const [column, condition] of Object.entries(where)) {
        const col = quote(column, allowedColumns);

        if (condition === null) {
            conditions.push(`${col} IS NULL`);
            continue;
        }

        const isOperatorObject =
            typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Date);
        const ops = isOperatorObject ? condition : { eq: condition };

        for (const [op, value] of Object.entries(ops)) {
            const sqlOp = OPERATORS[op];
            if (!sqlOp) throw new Error(`unknown operator: ${op}`);
            params.push(value);
            conditions.push(op === "in" ? `${col} ${sqlOp}($${params.length})` : `${col} ${sqlOp} $${params.length}`);
        }
    }

    return { sql: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "", params };
};

// columns: [] = todas
const buildSelect = (table, allowedColumns, { columns = [], where = {} } = {}) => {
    const select = columns.length ? columns.map((c) => quote(c, allowedColumns)).join(", ") : "*";
    const { sql, params } = buildWhere(allowedColumns, where);
    return { text: `SELECT ${select} FROM ${table}${sql}`, params };
};

const buildCount = (table, allowedColumns, { where = {} } = {}) => {
    const { sql, params } = buildWhere(allowedColumns, where);
    return { text: `SELECT count(*)::int AS count FROM ${table}${sql}`, params };
};

// avg de bigint retorna numeric, que o pg devolve como string; null quando não há linhas
const buildAvg = (table, allowedColumns, column, { where = {} } = {}) => {
    const col = quote(column, allowedColumns);
    const { sql, params } = buildWhere(allowedColumns, where);
    return { text: `SELECT avg(${col}) AS avg FROM ${table}${sql}`, params };
};

module.exports = { buildSelect, buildCount, buildAvg };
