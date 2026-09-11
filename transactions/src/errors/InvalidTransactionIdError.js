const AppError = require("./AppError");

class InvalidTransactionIdError extends AppError {
    constructor() {
        super("invalid transaction id", 400);
    }
}

module.exports = InvalidTransactionIdError;
