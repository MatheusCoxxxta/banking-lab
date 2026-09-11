require("dotenv").config();

const express = require("express");
const { ZodError } = require("zod");
const healthController = require("./src/controllers/healthController");
const transactionsController = require("./src/controllers/transactionsController");
const AppError = require("./src/errors/AppError");
const ValidationError = require("./src/errors/ValidationError");
const InvalidTransactionIdError = require("./src/errors/InvalidTransactionIdError");

const app = express();

app.use(express.json());

app.get("/health", healthController.health);
app.get("/transactions/health", healthController.health);
app.post("/transactions", transactionsController.createTransaction);

app.use((err, req, res, next) => {
    if (err instanceof ZodError) {
        const e = new ValidationError(err);
        return res.status(e.status).json({ message: e.message, errors: e.errors });
    }
    if (err instanceof AppError) return res.status(err.status).json({ message: err.message });
    if (err.code === "22P02") {
        console.error(err);
        const e = new InvalidTransactionIdError();
        return res.status(e.status).json({ message: e.message });
    }
    console.error(err);
    return res.status(500).json({ message: "internal server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on port ${port}`);
});
