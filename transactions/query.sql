-- name: insertTransaction :one
INSERT INTO transactions (idempotency_key, account_id, amount)
VALUES ($1, $2, $3)
RETURNING *;

-- name: insertEntry :one
INSERT INTO entries (account_id, transaction_id, direction, amount)
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

-- name: updateAccountBalance :exec
UPDATE accounts SET balance = balance + $1 WHERE id = $2;