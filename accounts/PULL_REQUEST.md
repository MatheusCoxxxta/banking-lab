# Refactor: Replace Manual Type Validations with Zod Schemas

## Descrição

Substituição da camada de validação manual (checks inline `typeof`, regex, comparações de valor) por **Zod schemas centralizados** co-localizados com os usecases. Cada usecase agora valida sua entrada no início via `schema.parse()`, deixando o `ZodError` subir até o error middleware, que o traduz em resposta `400` padronizada com detalhes de campo. Decisão técnica principal: manter schemas **próximos ao usecase** (não no controller) porque validação é core do domínio — o usecase é o guardião de sua própria entrada. Uniformiza o padrão de erro: `createAccount` deixa de retornar `{ error }` e passa a lançar, alinhando-se com `send` e `deactivateAccount`. Middleware intercepta `ZodError` antes de `AppError`, agregando **todos** os issues de validação em uma única resposta (melhoria sobre o padrão anterior que retornava só a primeira falha).

## Changelog

- Modificado <code>package.json</code>, <code>package-lock.json</code> — adicionada dependency `zod^4.5.4`
- Modificado <code>server.js</code>:
  - Importado `{ ZodError }` de `zod` e `ValidationError` de `src/errors/ValidationError`
  - Adicionado branch no error middleware para capturar `ZodError` antes de `AppError`, construindo `ValidationError` com agregação de todos os issues
- Criado <code>src/errors/ValidationError.js</code> — subclass de `AppError` que estende payload com `errors[]`, agregando `field` e `message` de cada issue Zod
- Criado <code>src/usecases/schemas/</code> com três schemas:
  - <code>createAccountSchema.js</code>: `name` com trim+min(1), `currency` regex 3-letras uppercase default BRL, `balance` nonnegative default 0
  - <code>deactivateAccountSchema.js</code>: `id` UUID obrigatório
  - <code>sendSchema.js</code>: `sender_id`, `receiver_id` UUIDs, `amount` positivo, `idempotency_key` string min(1)
- Modificado <code>src/usecases/createAccount.js</code>:
  - Removida função `validate()` e seu retorno `{ error }`
  - Adicionado `const data = createAccountSchema.parse({...})` logo no início; ZodError sobe cru
  - Usecase usa `data.name` (já trimmado no schema) e `data.currency` (já uppercase no schema)
  - Mantém `return { account }` para compatibilidade com controller existente
- Modificado <code>src/usecases/deactivateAccount.js</code>:
  - Adicionado `const { id: validId } = deactivateAccountSchema.parse({ id })` antes de `pool.connect()` — rejeita UUID malformado sem adquirir conexão
- Modificado <code>src/usecases/send.js</code>:
  - Removido import de `InvalidAmountError`
  - Removido guard manual `amount == null || amount <= 0`
  - Adicionado `const data = sendSchema.parse({...})` no início; todas as referências posteriores usam `data.*`
- Modificado <code>src/controllers/accountController.js</code>:
  - Removido check `if (result.error) return res.status(400)...` em `createAccount` — validação agora lança no usecase
- Criado <code>docs/00006_wiki_zod_validation_layer.md</code> com especificação da camada de validação Zod
- Criado <code>smokes/zod_validation.js</code> — script concorrente de fake-traffic exercitando payloads válidos e inválidos (Zod 400) para todos os 3 endpoints

## Breaking Change

Erro de validação `400` agora retorna:
```json
{
  "message": "validation error",
  "errors": [
    { "field": "name", "message": "Too small: expected string to have >=1 characters" }
  ]
}
```

Anteriormente retornava `{ "message": "..." }` com mensagem única. Novo formato **agrega todos os issues simultaneamente** (melhoria: valida múltiplos campos de uma vez, não só o primeiro).

## Como testar

### Backend local + Smoke Script

```bash
# Terminal 1: iniciar servidor
npm start

# Terminal 2: rodar fake-traffic com validações
node smokes/zod_validation.js
```

Resultado esperado:
- Servidor ouve em `http://localhost:3000`
- Smoke script executa ~30s com 10 usuários paralelos, misturando payloads válidos e inválidos
- Saída esperada: **fail = 0** (todos os 400 esperados são marcados `ok`), latência p50/p95 < 100ms, throughput > 10 req/s
- Não há test script no repo; validação via sintaxe (`node --check`) e smoke concorrente

### Curls manuais de referência

Arquivo <code>smokes/zod_validation.md</code> contém ~25 curls cobrindo:
- Happy paths: POST /accounts (com defaults), PATCH /deactivate (UUID válido), POST /send (UUIDs válidos, amount > 0)
- Validação Zod 400: name ausente/só-espaços, currency inválida, balance negativo, UUIDs malformados, amount zero/negativo, múltiplos erros simultâneos
- Erros de negócio 400/404/409: saldo insuficiente, conta não encontrada, já desativada, idempotency_key duplicada

Exemplo — validação de name:
```bash
curl -s -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"   "}'
# Esperado: 400 {"message":"validation error","errors":[{"field":"name","message":"Too small: expected string to have >=1 characters"}]}
```

## Uso de IA

Feature gerada via pipeline `/ship` (agent-orchestrator). **O pipeline NÃO rodou single-turn:** parou 2x indevidamente e só retomou após intervenção humana — (1) após `/architect`, tratando o plano como handoff em vez de fuel; (2) após `/smoke-http`, mesmo erro. Ambas retomadas exigiram nudge do usuário ("parou pq?").

**Modelo:** Claude Opus 4.7 (`claude-opus-4-7`)

**Pipeline executado:**

| Etapa | Ferramenta | Resultado |
|-------|-----------|-----------|
| Pré-voo | — | Permissões do projeto garantidas em `.claude/settings.local.json` |
| Classificação | — | Backend-only; especialista `/backend-dev`; profundidade `plan` |
| Planejamento | `/architect` | Plano: schemas em `src/usecases/schemas/`, ValidationError no middleware, todos os 3 usecases com parse(), contrato 400 agregado |
| Implementação | `/backend-dev` | Criados 4 arquivos de schema/error, modificados 7 arquivos de usecase/controller/server |
| Review paralelo | `/code-review` + `/sonar-review` | 1 BLOCKER detectado: name só-espaços passa `z.string().min(1)` mas vira "" após trim no insert |
| Fix | — | Corrigido: aplicado `.trim().min(1)` no schema (trim antes do min) + removido `.trim()` redundante no insert |
| Wiki | — | Criado <code>docs/00006_wiki_zod_validation_layer.md</code> com especificação completa |
| Smoke | `/smoke-http` | Gerados 2 artefatos: <code>smokes/zod_validation.md</code> (25+ curls, não commitado) + <code>smokes/zod_validation.js</code> (script concorrente, commitado) |
| Finalize | `/finalize-task` | Lint: não aplicável (sem script). Sintaxe: OK. Stage explícito de 14 arquivos. Commit: `493dce6`. PARADO antes de push. |

**Findings de IA detectados e corrigidos automaticamente:**

- **BLOCKER** — Regressão: `z.string().min(1)` aceita `"   "` (3 espaços), que passa pelo schema mas resulta em `"".trim()` sendo inserido no banco. O `validate()` original bloqueava isso. **Corrigido:** aplicado `.trim().min(1)` no schema (trim aplicado antes do min-length check) e removido `.trim()` redundante no usecase.

**Intervenção humana:** Prompt inicial da demanda + 2 nudges ("parou pq?") para retomar o pipeline após paradas indevidas (pós-`/architect` e pós-`/smoke-http`).

**Escopo contabilizável:**

- **5 skills/agents invocados:** `/architect`, `/backend-dev`, `/code-review`, `/sonar-review`, `/smoke-http`
- **14 arquivos criados/modificados, +617 linhas**
- **1 BLOCKER detectado e corrigido automaticamente** (regressão de whitespace-only names)
