const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");
const outboxRepository = require("../repositories/outboxRepository");
const { createAccountSchema } = require("./schemas/createAccountSchema");

const createAccount = async ({ name, currency, balance }) => {
    const data = createAccountSchema.parse({ name, currency, balance });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const account = await accountRepository.insert(data.name, data.currency, data.balance, client);
        await outboxRepository.insert(
            "accounts",
            account.id,
            { account_id: account.id, created_at: account.created_at },
            client
        );
        await client.query("COMMIT");
        return { account };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
};

module.exports = { createAccount };
