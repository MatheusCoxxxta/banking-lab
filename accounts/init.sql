CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    currency    CHAR(3) NOT NULL DEFAULT 'BRL',
    balance     NUMERIC(20, 2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type        TEXT NOT NULL DEFAULT 'PF', -- PJ, PF, ST
    user_id    UUID
);

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL;

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS balance_version BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS outbox (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source        TEXT NOT NULL, -- accounts
    source_id     TEXT NOT NULL,
    attempts      INT NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending', -- pending, sent
    payload       JSONB NOT NULL,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
