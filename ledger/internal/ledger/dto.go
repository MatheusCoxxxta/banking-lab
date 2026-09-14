package ledger

import "github.com/google/uuid"

type SendMoneyDto struct {
	IdempotencyKey string    `json:"idempotency_key" validate:"required,uuid4"`
	SenderId       uuid.UUID `json:"sender_id" validate:"required,uuid4"`
	Amount         int64     `json:"amount" validate:"required"`
	ReceiverId     uuid.UUID `json:"receiver_id" validate:"required,uuid4"`
}
