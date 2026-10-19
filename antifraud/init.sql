CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rule_sets (
    version     TEXT PRIMARY KEY,
    thresholds  JSONB NOT NULL,
    hard_rules  JSONB NOT NULL,
    rules       JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_evaluations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_id              TEXT NOT NULL UNIQUE,
    origin_account     UUID NOT NULL,
    dest_key           TEXT NOT NULL,
    amount             BIGINT NOT NULL CHECK (amount > 0),
    channel            TEXT NOT NULL,
    score              INT NOT NULL,
    decision           TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REVIEW', 'DENY')),
    reasons            JSONB NOT NULL DEFAULT '[]',
    rule_version       TEXT NOT NULL REFERENCES rule_sets (version),
    features_snapshot  JSONB NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- projeção de accounts, alimentada por consumer (ainda não existe)
CREATE TABLE IF NOT EXISTS account_projections (
    account_id  UUID PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL
);

-- velocity e ticket médio: janela por origem
CREATE INDEX IF NOT EXISTS idx_risk_evaluations_origin_created_at
    ON risk_evaluations (origin_account, created_at);

-- destino já usado pela origem
CREATE INDEX IF NOT EXISTS idx_risk_evaluations_origin_dest
    ON risk_evaluations (origin_account, dest_key);

INSERT INTO rule_sets (version, thresholds, hard_rules, rules) VALUES (
    'v1',
    '{ "review": 40, "deny": 70 }',
    '{
        "DEST_FLAGGED_DICT": { "enabled": true },
        "ORIGIN_BLOCKED":    { "enabled": true },
        "NIGHT_LIMIT":       { "enabled": true, "start": "22:00", "end": "06:00", "max_amount": 100000 }
    }',
    '{
        "DEST_NEW":    { "points": 15, "min_amount": 50000 },
        "ACCOUNT_NEW": { "points": 25, "max_age_hours": 24 },
        "VELOCITY": {
            "window_minutes": 10,
            "tiers": [ { "min_tx": 6, "points": 35 }, { "min_tx": 3, "points": 15 } ]
        },
        "AMOUNT_ATYPICAL": {
            "avg_window_days": 30,
            "tiers": [ { "multiplier": 10, "points": 40 }, { "multiplier": 3, "points": 20 } ]
        }
    }'
) ON CONFLICT (version) DO NOTHING;
