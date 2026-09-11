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
curl -X POST http://localhost:8000/ledger/transfer \
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

	journal, errJournal := q.insertJournal(ctx, insertJournalParams{
		IdempotencyKey: dto.IdempotencyKey,
		AccountID:      lockedSender.ID,
		Amount:         dto.Amount,
	})

	if errJournal != nil {
		log.Fatal("Error trying to insertJournal ", errJournal.Error())
	}

	_, errDebitEntry := q.insertEntry(ctx, insertEntryParams{
		AccountID: lockedSender.ID,
		JournalID: journal.ID,
		Direction: "debit",
		Amount:    dto.Amount,
	})

	if errDebitEntry != nil {
		log.Fatal("Error trying to insertEntry ", errDebitEntry.Error())
	}

	_, errCreditEntry := q.insertEntry(ctx, insertEntryParams{
		AccountID: lockedReceiver.ID,
		JournalID: journal.ID,
		Direction: "credit",
		Amount:    dto.Amount,
	})

	uSender, senderAccountErr := q.updateAccountBalance(ctx, updateAccountBalanceParams{ID: lockedSender.ID, Balance: -int64(dto.Amount)})

	if senderAccountErr != nil {
		log.Fatal("Error trying to insertEntry ", senderAccountErr.Error())
	}

	uReceiver, receiverAccountErr := q.updateAccountBalance(ctx, updateAccountBalanceParams{ID: lockedReceiver.ID, Balance: dto.Amount})

	if receiverAccountErr != nil {
		log.Fatal("Error trying to insertEntry ", receiverAccountErr.Error())
	}

	if errCreditEntry != nil {
		log.Fatal("Error trying to insertEntry ", errCreditEntry.Error())
	}

	senderPayload, senderPayloadErr := json.Marshal(BalanceUpdatePayload{
		Balance:   uSender.Balance,
		Version:   uSender.BalanceVersion,
		AccountID: sender.ID.String(),
	})

	if senderPayloadErr != nil {
		log.Fatal("Error trying to json.Marshal ", senderPayloadErr.Error())
	}

	_, errOutboxSender := q.insertOutbox(ctx, insertOutboxParams{
		Source:   "accounts",
		SourceID: sender.ID.String(),
		Payload:  senderPayload,
	})

	if errOutboxSender != nil {
		log.Fatal("Error trying to errOutboxSender ", errOutboxSender.Error())
	}

	receiverPayload, receiverPayloadErr := json.Marshal(BalanceUpdatePayload{
		Balance:   uReceiver.Balance,
		Version:   uReceiver.BalanceVersion,
		AccountID: uReceiver.ID.String(),
	})

	if receiverPayloadErr != nil {
		log.Fatal("Error trying to json.Marshal ", receiverPayloadErr.Error())
	}

	_, errOutboxReceiver := q.insertOutbox(ctx, insertOutboxParams{
		Source:   "accounts",
		SourceID: sender.ID.String(),
		Payload:  receiverPayload,
	})

	if errOutboxReceiver != nil {
		log.Fatal("Error trying to errOutboxReceiver ", errOutboxReceiver.Error())
	}

	tx.Commit(ctx)

	return nil
}

type BalanceUpdatePayload struct {
	Balance   int64  `json:"balance"`
	Version   int64  `json:"version"`
	AccountID string `json:"account_id"`
}

func (s *Store) OutboxObserver(ctx context.Context) error {
	ticker := time.NewTicker(time.Millisecond * 100)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			pE, err := s.Queries.findOutboxByStatus(ctx, "pending")

			if err != nil {
				log.Printf("Error processing outbox query: %s", err.Error())
				continue
			}

			for _, event := range pE {
				log.Printf("Processing pending event: %s:%s", event.ID, event.Payload)
			}
		}
	}
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
	r.Get("/ledger/health", handleHealth)
	r.Post("/ledger/transfer", s.handleTransferMoney)

	go func() {
		if err := s.OutboxObserver(context.Background()); err != nil {
			log.Println("Starting server on :" + PORT)
		}
	}()

	log.Fatal(http.ListenAndServe(":"+PORT, r))

}
