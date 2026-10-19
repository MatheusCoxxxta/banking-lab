const { z } = require("zod");

const evaluateSchema = z.object({
    tx_id: z.string().trim().min(1),
    origin_account: z.uuid(),
    dest_key: z.string().trim().min(1),
    amount: z.number().int().positive(),
    channel: z.string().trim().min(1),
    created_at: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

module.exports = { evaluateSchema };
