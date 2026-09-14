package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/wagslane/go-rabbitmq"
)

type Store struct {
	Pool      *pgxpool.Pool
	Queries   *Queries
	Publisher *rabbitmq.Publisher
}

func NewStore(Pool *pgxpool.Pool, Queries *Queries, Publisher *rabbitmq.Publisher) *Store {
	return &Store{
		Pool:      Pool,
		Queries:   Queries,
		Publisher: Publisher,
	}
}

type BalanceUpdatePayload struct {
	Balance   int64  `json:"balance"`
	Version   int64  `json:"version"`
	AccountID string `json:"account_id"`
}

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

	if lockedSender.Balance < 0 || dto.Amount > lockedSender.Balance {
		return InsufficientBalanceError
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
