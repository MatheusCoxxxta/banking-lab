# Smoke Curls — Refatoração em Camadas (Controllers / Usecases / Repositories)

Fluxo: health check → criação de contas → transferências → desativação

---

## Pré-requisitos

- Servidor local rodando: `npm start` (porta 3000)
- PostgreSQL local rodando na porta 5438 com banco `ledgerlab`
- Sem autenticação — nenhum token necessário

---

## Headers obrigatórios

```
Content-Type: application/json
```

---

## GET /health

### Happy path

```bash
curl -s http://localhost:3000/health | jq
```

Resposta esperada (`200`):
```json
{
  "status": "ok",
  "time": "2026-09-03T15:00:00.000Z"
}
```

---

## POST /accounts

### Happy path — conta com saldo inicial

```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "currency": "BRL", "balance": 500}' | jq
```

Resposta esperada (`201`):
```json
{
  "id": "uuid-gerado",
  "name": "Alice",
  "currency": "BRL",
  "balance": "500.00",
  "created_at": "2026-09-03T15:00:00.000Z"
}
```

### Happy path — defaults aplicados (sem currency e balance)

```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Bob"}' | jq
```

Resposta esperada (`201`): `currency: "BRL"`, `balance: "0.00"`

---

### Erros de validação — POST /accounts

**name ausente (`400`)**
```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"currency": "BRL", "balance": 100}' | jq
```
```json
{ "message": "name is required" }
```

**name vazio (`400`)**
```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "   ", "currency": "BRL", "balance": 100}' | jq
```
```json
{ "message": "name is required" }
```

**currency inválida — não é string de 3 letras (`400`)**
```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "currency": "REAL", "balance": 100}' | jq
```
```json
{ "message": "currency must be a 3-letter string" }
```

**balance negativo (`400`)**
```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "currency": "BRL", "balance": -1}' | jq
```
```json
{ "message": "balance must be a non-negative number" }
```

**balance não numérico (`400`)**
```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "currency": "BRL", "balance": "cem"}' | jq
```
```json
{ "message": "balance must be a non-negative number" }
```

---

## POST /money/send

> Substitua `SENDER_ID` e `RECEIVER_ID` pelos UUIDs retornados em `POST /accounts`.

### Happy path

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-001",
    "sender_id":   "SENDER_ID",
    "receiver_id": "RECEIVER_ID",
    "amount": 50
  }' | jq
```

Resposta esperada (`200`): body vazio (`null` ou `{}`)

### Idempotência — mesma key (`400`)

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-001",
    "sender_id":   "SENDER_ID",
    "receiver_id": "RECEIVER_ID",
    "amount": 50
  }' | jq
```
```json
{ "message": "transaction already processed" }
```

### amount ausente ou zero (`400`)

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"idempotency_key": "key-002", "sender_id": "SENDER_ID", "receiver_id": "RECEIVER_ID"}' | jq
```
```json
{ "message": "amount must be positive" }
```

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"idempotency_key": "key-003", "sender_id": "SENDER_ID", "receiver_id": "RECEIVER_ID", "amount": 0}' | jq
```
```json
{ "message": "amount must be positive" }
```

### sender não encontrado (`400`)

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-004",
    "sender_id":   "00000000-0000-0000-0000-000000000000",
    "receiver_id": "RECEIVER_ID",
    "amount": 10
  }' | jq
```
```json
{ "message": "sender account not found" }
```

### receiver não encontrado (`400`)

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-005",
    "sender_id":   "SENDER_ID",
    "receiver_id": "00000000-0000-0000-0000-000000000000",
    "amount": 10
  }' | jq
```
```json
{ "message": "receiver account not found" }
```

### saldo insuficiente (`400`)

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-006",
    "sender_id":   "SENDER_ID",
    "receiver_id": "RECEIVER_ID",
    "amount": 999999
  }' | jq
```
```json
{ "message": "insuficient balance" }
```

### sender desativado (`400`)

> Primeiro desative o sender com `PATCH /accounts/SENDER_ID/deactivate`, depois tente o send.

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-007",
    "sender_id":   "DEACTIVATED_SENDER_ID",
    "receiver_id": "RECEIVER_ID",
    "amount": 10
  }' | jq
```
```json
{ "message": "sender account is deactivated" }
```

### receiver desativado (`400`)

```bash
curl -s -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "key-008",
    "sender_id":   "SENDER_ID",
    "receiver_id": "DEACTIVATED_RECEIVER_ID",
    "amount": 10
  }' | jq
```
```json
{ "message": "receiver account is deactivated" }
```

---

## PATCH /accounts/:id/deactivate

> Substitua `ACCOUNT_ID` pelo UUID de uma conta existente.

### Happy path

```bash
curl -s -X PATCH http://localhost:3000/accounts/ACCOUNT_ID/deactivate | jq
```

Resposta esperada (`200`):
```json
{
  "id": "ACCOUNT_ID",
  "name": "Alice",
  "currency": "BRL",
  "balance": "450.00",
  "created_at": "2026-09-03T15:00:00.000Z",
  "deactivated_at": "2026-09-03T15:05:00.000Z"
}
```

### Conta já desativada (`409`)

```bash
curl -s -X PATCH http://localhost:3000/accounts/ACCOUNT_ID/deactivate | jq
```
```json
{ "message": "account already deactivated" }
```

### Conta não encontrada (`404`)

```bash
curl -s -X PATCH http://localhost:3000/accounts/00000000-0000-0000-0000-000000000000/deactivate | jq
```
```json
{ "message": "account not found" }
```

### UUID inválido no path (`400`)

```bash
curl -s -X PATCH http://localhost:3000/accounts/nao-e-um-uuid/deactivate | jq
```
```json
{ "message": "invalid account id" }
```
