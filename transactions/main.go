package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-playground/validator/v10"
	"github.com/google/uuid"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SendMoneyDto struct {
	IdempotencyKey string    `json:"idempotency_key" validate:"required,uuid4"`
	SenderId       uuid.UUID `json:"sender_id" validate:"required,uuid4"`
	Amount         int64     `json:"amount" validate:"required"`
	ReceiverId     uuid.UUID `json:"receiver_id" validate:"required,uuid4"`
}

var validate = validator.New()

func DecodeAndValidate[T any](r *http.Request) (T, error) {
	var v T

	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		return v, err
	}

	validationErr := validate.Struct(v)

	if validationErr != nil {
		return v, validationErr
	}

	return v, validationErr
}

/**
curl -X POST http://localhost:3000/send-money \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c",
    "sender_id": "a3d1cbd7-1730-429e-b1da-5e00116fb053",
    "amount": 15,
    "receiver_id": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c"
  }'
*/

type Store struct {
	Pool    *pgxpool.Pool
	Queries *Queries
}

func NewStore(Pool *pgxpool.Pool, Queries *Queries) *Store {
	return &Store{
		Pool:    Pool,
		Queries: Queries,
	}
}

var ReceiverNotFoundError = errors.New("Receiver account not found")
var SenderNotFoundError = errors.New("Sender account not found")
var InsufficientBalanceError = errors.New("Insufficient balance to perform this transaction")

func (s *Store) transferMoneyUsecase(ctx context.Context, dto SendMoneyDto) error {
	sender, err := s.Queries.findAccountById(ctx, pgtype.UUID{Bytes: dto.SenderId, Valid: true})

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SenderNotFoundError
		}
		log.Fatal("Error trying to get sender ", err.Error())
	}

	_, err = s.Queries.findAccountById(ctx, pgtype.UUID{Bytes: dto.ReceiverId, Valid: true})

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SenderNotFoundError
		}
		log.Fatal("Error trying to get sender ", err.Error())
	}

	if sender.Balance < 0 || dto.Amount > sender.Balance {
		return InsufficientBalanceError
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		log.Fatal("Error trying to get sender ", err.Error())
	}

	defer tx.Rollback(ctx)

	q := s.Queries.WithTx(tx)

	lockedSender, errSender := q.findAccountByIdForUpdate(ctx, pgtype.UUID{Bytes: dto.SenderId, Valid: true})

	if errSender != nil {
		if errors.Is(errSender, pgx.ErrNoRows) {
			return SenderNotFoundError
		}
		log.Fatal("Error trying to findAccountByIdForUpdate ", errSender.Error())
	}

	lockedReceiver, errReceiver := q.findAccountByIdForUpdate(ctx, pgtype.UUID{Bytes: dto.ReceiverId, Valid: true})
	if errReceiver != nil {
		if errors.Is(errReceiver, pgx.ErrNoRows) {
			return SenderNotFoundError
		}
		log.Fatal("Error trying to findAccountByIdForUpdate ", err.Error())
	}

	transaction, errTransaction := q.insertTransaction(ctx, insertTransactionParams{
		IdempotencyKey: dto.IdempotencyKey,
		AccountID:      lockedSender.ID,
		Amount:         dto.Amount,
	})

	if errTransaction != nil {
		log.Fatal("Error trying to insertTransaction ", errTransaction.Error())
	}

	_, errDebitEntry := q.insertEntry(ctx, insertEntryParams{
		AccountID:     lockedSender.ID,
		TransactionID: transaction.ID,
		Direction:     "debit",
		Amount:        dto.Amount,
	})

	if errDebitEntry != nil {
		log.Fatal("Error trying to insertEntry ", errDebitEntry.Error())
	}

	_, errCreditEntry := q.insertEntry(ctx, insertEntryParams{
		AccountID:     lockedReceiver.ID,
		TransactionID: transaction.ID,
		Direction:     "credit",
		Amount:        dto.Amount,
	})

	senderAccountErr := q.updateAccountBalance(ctx, updateAccountBalanceParams{ID: lockedSender.ID, Balance: -int64(dto.Amount)})

	if senderAccountErr != nil {
		log.Fatal("Error trying to insertEntry ", senderAccountErr.Error())
	}

	receiverAccountErr := q.updateAccountBalance(ctx, updateAccountBalanceParams{ID: lockedReceiver.ID, Balance: dto.Amount})

	if receiverAccountErr != nil {
		log.Fatal("Error trying to insertEntry ", receiverAccountErr.Error())
	}

	if errCreditEntry != nil {
		log.Fatal("Error trying to insertEntry ", errCreditEntry.Error())
	}

	tx.Commit(ctx)

	return nil
}

func (s *Store) handleTransferMoney(w http.ResponseWriter, r *http.Request) {
	data, err := DecodeAndValidate[SendMoneyDto](r)

	w.Header().Set("Content-Type", "application/json")

	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	ctx := context.Background()
	err = s.transferMoneyUsecase(ctx, data)

	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	})
}

func main() {
	DATABASE_URL := os.Getenv("DATABASE_URL")
	if DATABASE_URL == "" {
		log.Println("DATABASE_URL NOT SET BUT IT'S REQUIRED")
		return
	}

	PORT := os.Getenv("PORT")
	if PORT == "" {
		log.Println("PORT NOT SET BUT IT'S REQUIRED")
		return
	}

	pool, err := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	log.Println("Starting server on :" + PORT)
	if err != nil {
		log.Fatal(err)
	}

	r := chi.NewRouter()

	q := New(pool)
	s := NewStore(pool, q)

	r.Get("/health", handleHealth)
	r.Get("/money/health", handleHealth)
	r.Post("/money/transfer", s.handleTransferMoney)

	log.Fatal(http.ListenAndServe(":"+PORT, r))
}
