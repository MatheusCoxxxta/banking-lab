const accountProjectionRepository = require("../repositories/accountProjectionRepository");
const { createAccountProjectionSchema } = require("./schemas/createAccountProjectionSchema");

const createAccountProjection = async ({ account_id, created_at }) => {
    const data = createAccountProjectionSchema.parse({ account_id, created_at });
    const projection = await accountProjectionRepository.insert(data.account_id, data.created_at);
    return { applied: Boolean(projection) };
};

module.exports = { createAccountProjection };
