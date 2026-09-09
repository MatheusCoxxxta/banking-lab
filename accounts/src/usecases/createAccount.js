const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");
const { createAccountSchema } = require("./schemas/createAccountSchema");

const createAccount = async ({ name, currency, balance }) => {
    const data = createAccountSchema.parse({ name, currency, balance });

    const client = await pool.connect();
    try {
        const account = await accountRepository.insert(data.name, data.currency, data.balance, client);
        return { account };
    } finally {
        client.release();
    }
};

module.exports = { createAccount };
