# Relatório comparativo — execuções de smoke test

Comparação das três execuções do smoke `folder_structure_refactor` (100 usuários virtuais, 60s, seed de 30 contas ativas + 30 desativadas).

| Execução | Ambiente | Throughput | p50 | p95 | p99 | Total req | Pass | BizFail (4xx) | ServerError (5xx/net) |
|----------|----------|-----------:|----:|----:|----:|----------:|-----:|--------------:|----------------------:|
| **test01** — pré-migração | local direto (`:3001`) | **3190 req/s** | 29ms | 44ms | 60ms | 191.598 | 121.949 | 69.649 | 0 |
| **test02** — pós-migração | docker + proxy (`:8000`) | 1082 req/s | 84ms | 180ms | 293ms | 65.093 | 62.109 | 2.979 | 5 |
| **test03** — pós-migração, sem logs de ledger | docker + proxy (`:8000`) | 1961 req/s | 46ms | 103ms | 147ms | 117.744 | 109.543 | 8.198 | 3 |

## Performance

- **test01 (pré/local)** é a mais rápida por larga margem: ~3190 req/s e p99 de 60ms. Roda direto no host, sem container nem proxy na frente — é a referência "melhor caso", não um cenário comparável de produção.
- **test02 (pós/docker)** cai para 1082 req/s (~34% do pré) e p99 sobe para 293ms. Overhead de containerização + proxy, somado ao custo de logging do ledger.
- **test03 (pós/docker sem logs de ledger)** recupera boa parte: **1961 req/s (+81% vs test02)** e p99 cai de 293ms → 147ms. **Remover o logging do ledger foi o maior ganho de performance isolado** — quase dobrou a vazão sem mudar mais nada.

### Endpoint mais quente: `POST /money/send` (~68% da carga)

| Execução | p50 | p95 | p99 |
|----------|----:|----:|----:|
| test01 | 30ms | 45ms | 62ms |
| test02 | 99ms | 201ms | 495ms |
| test03 | 57ms | 113ms | 153ms |

O `money/send` concentra o custo. Nos demais endpoints (`/health`, `/accounts`, `/deactivate`) a latência pós-migração fica baixa (p50 de 3–9ms), o que confirma que o gargalo está no caminho de transferência — e que o logging do ledger pesa justamente ali.

## Resultados / corretude

- **Sem erros de servidor no pré (0 × 5xx).** Pós-migração aparecem poucos **502** (5 no test02, 3 no test03), originados no proxy sob pico de carga. Volume irrisório (<0,01%), mas não existia antes — vale monitorar.
- **Mudança de contrato no "saldo insuficiente":**
  - Pré: `status 400` + `{"message":"insuficient balance"}` (com typo)
  - Pós: `status 404` + `{"error":"Insufficient balance to perform this transaction"}`
  - Além do texto/typo corrigido, o **status mudou 400 → 404**. 404 para saldo insuficiente é semanticamente estranho (não é "recurso não encontrado") — revisar se foi intencional.
- **Composição das falhas de negócio mudou muito:**
  - Pré: `money/send` teve ~53% de BizFail (69.649 de 130.555), incluindo `sender/receiver account is deactivated` além de saldo insuficiente.
  - Pós: BizFail cai para ~7% (test02) e ~10% (test03), e as amostras só mostram saldo insuficiente.
  - A queda drástica sugere que o tratamento de contas desativadas e/ou o fluxo de transferência mudou no pós-migração. Como o seed é idêntico, vale confirmar se o comportamento novo está correto (e não apenas "falhando menos").

## Conclusões

1. **Performance:** o logging do ledger é o custo dominante pós-migração — desligá-lo quase dobra a vazão (test02 → test03). Prioridade se performance importar: tornar esse log assíncrono/amostrado ou removê-lo do caminho crítico.
2. **test01 não é baseline justo** — roda sem docker/proxy. Comparação de produção real é test02 vs test03.
3. **Regressões de corretude a validar:** status 400 → 404 no saldo insuficiente, e a mudança na taxa/composição de BizFail. Confirmar se são intencionais.
4. **502s pós-migração:** volume mínimo, mas novos. Investigar limites de conexão do proxy/upstream sob carga.
