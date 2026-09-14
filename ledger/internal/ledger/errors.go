package ledger

import "errors"

var (
	ReceiverNotFoundError    = errors.New("Receiver account not found")
	SenderNotFoundError      = errors.New("Sender account not found")
	InsufficientBalanceError = errors.New("Insufficient balance to perform this transaction")
)
