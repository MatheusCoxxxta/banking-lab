const { z } = require("zod");

const createAccountProjectionSchema = z.object({
    account_id: z.uuid(),
    created_at: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

module.exports = { createAccountProjectionSchema };
