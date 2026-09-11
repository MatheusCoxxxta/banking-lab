const pool = require("../db");
const accountRepository = require("../repositories/accountRepository");
const AccountNotFoundError = require("../errors/AccountNotFoundError");
const { updateAccountBalanceSchema } = require("./schemas/updateAccountBalanceSchema");

const updateAccountBalance = async ({ account_id, balance, version }) => {
    const data = updateAccountBalanceSchema.parse({ account_id, balance, version });

    const client = await pool.connect();
    try {
        const updated = await accountRepository.updateBalance(
            data.account_id,
            data.balance,
            data.version,
            client
        );
        if (updated) return { account: updated, applied: true };

        const existing = await accountRepository.findById(data.account_id, client);
        if (!existing) throw new AccountNotFoundError();
        return { account: existing, applied: false };
    } finally {
        client.release();
    }
};

module.exports = { updateAccountBalance };
