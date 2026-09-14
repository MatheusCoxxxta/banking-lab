package ledger

import (
	"context"
	"encoding/json"
	"errors"

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
		return err
	}

	_, err = s.Queries.findAccountById(ctx, pgtype.UUID{Bytes: dto.ReceiverId, Valid: true})

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ReceiverNotFoundError
		}
		return err
	}

	if sender.Balance < 0 || dto.Amount > sender.Balance {
		return InsufficientBalanceError
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}

	defer tx.Rollback(ctx)

	q := s.Queries.WithTx(tx)

	lockedSender, errSender := q.findAccountByIdForUpdate(ctx, pgtype.UUID{Bytes: dto.SenderId, Valid: true})

	if errSender != nil {
		if errors.Is(errSender, pgx.ErrNoRows) {
			return SenderNotFoundError
		}
		return errSender
	}

	lockedReceiver, errReceiver := q.findAccountByIdForUpdate(ctx, pgtype.UUID{Bytes: dto.ReceiverId, Valid: true})
	if errReceiver != nil {
		if errors.Is(errReceiver, pgx.ErrNoRows) {
			return ReceiverNotFoundError
		}
		return errReceiver
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
		return errJournal
	}

	_, errDebitEntry := q.insertEntry(ctx, insertEntryParams{
		AccountID: lockedSender.ID,
		JournalID: journal.ID,
		Direction: "debit",
		Amount:    dto.Amount,
	})

	if errDebitEntry != nil {
		return errDebitEntry
	}

	_, errCreditEntry := q.insertEntry(ctx, insertEntryParams{
		AccountID: lockedReceiver.ID,
		JournalID: journal.ID,
		Direction: "credit",
		Amount:    dto.Amount,
	})

	if errCreditEntry != nil {
		return errCreditEntry
	}

	uSender, senderAccountErr := q.updateAccountBalance(ctx, updateAccountBalanceParams{ID: lockedSender.ID, Balance: -int64(dto.Amount)})

	if senderAccountErr != nil {
		return senderAccountErr
	}

	uReceiver, receiverAccountErr := q.updateAccountBalance(ctx, updateAccountBalanceParams{ID: lockedReceiver.ID, Balance: dto.Amount})

	if receiverAccountErr != nil {
		return receiverAccountErr
	}

	senderPayload, senderPayloadErr := json.Marshal(BalanceUpdatePayload{
		Balance:   uSender.Balance,
		Version:   uSender.BalanceVersion,
		AccountID: sender.ID.String(),
	})

	if senderPayloadErr != nil {
		return senderPayloadErr
	}

	_, errOutboxSender := q.insertOutbox(ctx, insertOutboxParams{
		Source:   "accounts",
		SourceID: sender.ID.String(),
		Payload:  senderPayload,
	})

	if errOutboxSender != nil {
		return errOutboxSender
	}

	receiverPayload, receiverPayloadErr := json.Marshal(BalanceUpdatePayload{
		Balance:   uReceiver.Balance,
		Version:   uReceiver.BalanceVersion,
		AccountID: uReceiver.ID.String(),
	})

	if receiverPayloadErr != nil {
		return receiverPayloadErr
	}

	_, errOutboxReceiver := q.insertOutbox(ctx, insertOutboxParams{
		Source:   "accounts",
		SourceID: uReceiver.ID.String(),
		Payload:  receiverPayload,
	})

	if errOutboxReceiver != nil {
		return errOutboxReceiver
	}

	if errCommit := tx.Commit(ctx); errCommit != nil {
		return errCommit
	}

	return nil
}
