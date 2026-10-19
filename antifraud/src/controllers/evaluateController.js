const { evaluate: evaluateUsecase } = require("../usecases/evaluate");

const evaluate = async (req, res) => {
    const result = await evaluateUsecase(req.body);
    return res.json(result);
};

module.exports = { evaluate };
