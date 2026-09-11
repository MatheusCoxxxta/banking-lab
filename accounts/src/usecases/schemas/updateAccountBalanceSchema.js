const { z } = require("zod");

const updateAccountBalanceSchema = z.object({
    account_id: z.string().uuid(),
    balance: z.number(),
    version: z.number().int().positive(),
});

module.exports = { updateAccountBalanceSchema };
