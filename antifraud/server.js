const express = require("express");
const { ZodError } = require("zod");
const healthController = require("./src/controllers/healthController");
const evaluateController = require("./src/controllers/evaluateController");
const AppError = require("./src/errors/AppError");
const ValidationError = require("./src/errors/ValidationError");
const InvalidAccountIdError = require("./src/errors/InvalidAccountIdError");

const router = express();

router.use(express.json());

router.get("/health", healthController.health);
router.get("/antifraud/health", healthController.health);
router.post("/antifraud/evaluate", evaluateController.evaluate);

router.use((err, req, res, next) => {
    if (err instanceof ZodError) {
        const e = new ValidationError(err);
        return res.status(e.status).json({ message: e.message, errors: e.errors });
    }
    if (err instanceof AppError) return res.status(err.status).json({ message: err.message });
    if (err.code === "22P02") {
        console.error(err);
        const e = new InvalidAccountIdError();
        return res.status(e.status).json({ message: e.message });
    }
    console.error(err);
    return res.status(500).json({ message: "internal server error" });
});

const port = process.env.PORT || 3004;

router.listen(port, () => {
  console.log(`Server on port ${port}`);
});

module.exports = { router }
