-- name: insertJournal :one
INSERT INTO journal (idempotency_key, account_id, amount)
VALUES ($1, $2, $3)
RETURNING *;

-- name: insertEntry :one
INSERT INTO entries (account_id, journal_id, direction, amount)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: findAccountById :one
SELECT * FROM accounts WHERE id = $1;

-- name: findAccountByIdForUpdate :one
SELECT * FROM accounts WHERE id = $1 FOR UPDATE;

-- name: insertAccount :one
INSERT INTO accounts (name, currency, balance)
VALUES ($1, $2, $3)
RETURNING id, name, currency, balance, created_at;

-- name: updateAccountBalance :one
UPDATE accounts SET balance = balance + $1, balance_version = balance_version + 1 WHERE id = $2
RETURNING *;

-- name: insertOutbox :one
INSERT INTO outbox (source, source_id, payload)
VALUES ($1, $2, $3)
RETURNING id, source, source_id, status, payload, created_at;

-- name: findOutboxByStatus :many
SELECT * FROM outbox WHERE status = $1;

-- name: updateOutboxStatus :exec
UPDATE outbox SET status = $1, published_at = now() WHERE id = $2;

-- name: incrementOutboxAttempt :exec
UPDATE outbox SET attempts = attempts + 1 WHERE id = $1;