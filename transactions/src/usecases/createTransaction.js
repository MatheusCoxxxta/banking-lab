const pool = require("../db");
const transactionsRepository = require("../repositories/transactionsRepository");
const { createTransactionSchema } = require("./schemas/createTransactionSchema");

const createTransaction = async ({ name, currency, balance }) => {
    const data = createTransactionSchema.parse({ name, currency, balance });

    const client = await pool.connect();
    try {
        const transaction = await transactionsRepository.insert(data.name, data.currency, data.balance, client);
        return { transaction };
    } finally {
        client.release();
    }
};

module.exports = { createTransaction };
