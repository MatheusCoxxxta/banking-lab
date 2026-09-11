const { createTransaction: createTransactionUsecase } = require("../usecases/createTransaction");

const createTransaction = async (req, res) => {
    const result = await createTransactionUsecase(req.body);
    return res.status(201).json(result.account);
};

module.exports = { createTransaction };
