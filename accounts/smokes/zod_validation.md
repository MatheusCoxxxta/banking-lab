# Smoke Curls — Zod Validation Layer

Jornada: exercitar todos os casos de validação Zod introduzidos na camada de usecases.  
Fluxo: POST /accounts → PATCH /accounts/:id/deactivate → POST /money/send

---

## Pré-requisitos

- Server rodando: `node server.js` (porta padrão 3000)
- Banco local acessível com as envs do `.env`
- Nenhum auth necessário — sem header de autorização
- Substituir `<UUID>` por IDs reais retornados pelas chamadas anteriores

---

## Headers obrigatórios

```
Content-Type: application/json
```

---

## POST /accounts — Criar conta

### Happy path — todos os campos

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","currency":"usd","balance":500}'
```

Esperado: `201`  
Body: `{"id":"<uuid>","name":"Alice","currency":"USD","balance":"500.00",...}`  
Nota: `currency` vira uppercase no schema (`.toUpperCase()` via Zod transform).

---

### Happy path — defaults (currency BRL, balance 0)

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob"}'
```

Esperado: `201`  
Body: `{"id":"<uuid>","name":"Bob","currency":"BRL","balance":"0.00",...}`

---

### 400 — name ausente

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"currency":"BRL","balance":100}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"name","message":"Required"}]}`

---

### 400 — name só espaços (regressão corrigida via .trim().min(1))

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"   "}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"name","message":"Too small: expected string to have >=1 characters"}]}`

---

### 400 — currency muito curta ("us")

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Carol","currency":"us"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"currency","message":"Invalid"}]}`

---

### 400 — currency muito longa ("usdd")

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Carol","currency":"usdd"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"currency","message":"Invalid"}]}`

---

### 400 — currency com dígito ("12a")

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Carol","currency":"12a"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"currency","message":"Invalid"}]}`

---

### 400 — currency null (explícito)

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Carol","currency":null}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"currency","message":"..."}]}`  
Nota: `null` explícito é mais restrito que o padrão anterior (aceita `undefined`/ausente via default; rejeita `null`).

---

### 400 — balance negativo

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Dave","balance":-10}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"balance","message":"Too small: expected number to be >=0"}]}`

---

### 400 — balance null

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Dave","balance":null}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"balance","message":"..."}]}`

---

## PATCH /accounts/:id/deactivate — Desativar conta

### Happy path — UUID válido existente

```bash
# Usar o <UUID> retornado pelo POST /accounts acima
curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://localhost:3000/accounts/<UUID>/deactivate
```

Esperado: `200`  
Body: `{"id":"<UUID>","name":"...","deactivated_at":"<timestamp>",...}`

---

### 400 — UUID malformado (novo comportamento: Zod antes do pg)

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://localhost:3000/accounts/abc/deactivate
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"id","message":"Invalid UUID"}]}`  
Nota: antes chegava como pg `22P02` → `{"message":"invalid account id"}`. Agora Zod intercepta.

---

### 400 — UUID sintaticamente válido mas formato parcial

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://localhost:3000/accounts/not-a-uuid/deactivate
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"id","message":"Invalid UUID"}]}`

---

### 404 — UUID válido mas conta não existe

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH \
  http://localhost:3000/accounts/00000000-0000-0000-0000-000000000000/deactivate
```

Esperado: `404`  
Body: `{"message":"account not found"}`

---

### 409 — conta já desativada

```bash
# Usar o <UUID> da conta desativada no passo anterior
curl -s -w "\nHTTP %{http_code}\n" -X PATCH http://localhost:3000/accounts/<UUID>/deactivate
```

Esperado: `409`  
Body: `{"message":"account already deactivated"}`

---

## POST /money/send — Transferência

### Happy path

```bash
# Criar duas contas com saldo primeiro
SENDER=$(curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Sender","balance":1000}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

RECEIVER=$(curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Receiver","balance":0}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d "{\"sender_id\":\"$SENDER\",\"receiver_id\":\"$RECEIVER\",\"amount\":50,\"idempotency_key\":\"key-$(date +%s)\"}"
```

Esperado: `200`  
Body: vazio (`{}` ou `null`)

---

### 400 — amount ausente

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"00000000-0000-0000-0000-000000000002","idempotency_key":"k1"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"amount","message":"Required"}]}`

---

### 400 — amount zero (não-positivo)

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"00000000-0000-0000-0000-000000000002","amount":0,"idempotency_key":"k2"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"amount","message":"Too small: expected number to be >0"}]}`

---

### 400 — amount negativo

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"00000000-0000-0000-0000-000000000002","amount":-5,"idempotency_key":"k3"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"amount","message":"Too small: expected number to be >0"}]}`

---

### 400 — amount como string (sem coerção)

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"00000000-0000-0000-0000-000000000002","amount":"100","idempotency_key":"k4"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"amount","message":"..."}]}`  
Nota: schema usa `z.number()` sem coerção — string numérica é rejeitada.

---

### 400 — sender_id não-UUID

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"abc","receiver_id":"00000000-0000-0000-0000-000000000002","amount":10,"idempotency_key":"k5"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"sender_id","message":"Invalid UUID"}]}`

---

### 400 — receiver_id não-UUID

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"not-uuid","amount":10,"idempotency_key":"k6"}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"receiver_id","message":"Invalid UUID"}]}`

---

### 400 — idempotency_key vazio

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"00000000-0000-0000-0000-000000000001","receiver_id":"00000000-0000-0000-0000-000000000002","amount":10,"idempotency_key":""}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"idempotency_key","message":"Too small: expected string to have >=1 characters"}]}`

---

### 400 — múltiplos erros de validação ao mesmo tempo

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"bad","receiver_id":"also-bad","amount":-1,"idempotency_key":""}'
```

Esperado: `400`  
Body: `{"message":"validation error","errors":[{"field":"sender_id",...},{"field":"receiver_id",...},{"field":"amount",...},{"field":"idempotency_key",...}]}`  
Nota: Zod retorna **todos** os erros simultaneamente (melhoria vs. validação anterior que retornava só o primeiro).

---

### 400 — saldo insuficiente (negócio, não validação)

```bash
# Usar $SENDER da seção happy path acima
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d "{\"sender_id\":\"$SENDER\",\"receiver_id\":\"$RECEIVER\",\"amount\":999999,\"idempotency_key\":\"k-insuf\"}"
```

Esperado: `400`  
Body: `{"message":"insuficient balance"}`

---

### 400 — idempotency_key repetida

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d "{\"sender_id\":\"$SENDER\",\"receiver_id\":\"$RECEIVER\",\"amount\":1,\"idempotency_key\":\"chave-repetida\"}"

# Repetir a mesma chamada:
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/money/send \
  -H "Content-Type: application/json" \
  -d "{\"sender_id\":\"$SENDER\",\"receiver_id\":\"$RECEIVER\",\"amount\":1,\"idempotency_key\":\"chave-repetida\"}"
```

Segunda chamada esperada: `400`  
Body: `{"message":"transaction already processed"}`
