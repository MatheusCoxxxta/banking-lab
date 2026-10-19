# Banking
Laboratório de core banking distribuído: double-entry ledger, microserviços de contas, transações, ledger e extrato, consistência forte no ledger e projeção eventual via eventos.

## Motivação
Visando em cobrir um gap que tenho com sistemas financeiros e movimentação de dinheiro, desenvolvi um core bancário distribuído visando escalabilidade organizacional. Separar em microsserviços era apenas o início, e trivial em relação aos outros problemas que teríamos a resolver: decidir hierarquia de ownership sobre os dados e lidar com ela, e desenhar o desacoplamento com componentes que necessitavam consistência forte e componentes que podiam lidar com consistência eventual. 

Este projeto simula múltiplos times sustentando um core banking, cada um com necessidades e preocupações distintas. Por isso usei Go e Node: Node acelera os CRUDs e endpoints user-facing, além de cuidar da formatação e escrita de extrato em PDF e XLSX; Go cobre o caminho do dinheiro, por dar concorrência mais previsível, tipagem forte consolidada e uma standard lib rica.

## Disclaimer
Peguei tudo que fiz no ledger-lab Node e no ledger-lab Go, centralizei aqui, e vou usar para dar uma aprofundada.
Como a versão Node implementava tanto transações quanto gestão de contas, descontinuei transações, que reescrevi em Go.

## Responsabilidade geral cada serviço:

- Accounts: CRUD de contas (consulta de saldo com consistência eventual)
- Transactions: API de transações, centraliza: DICT, chamada ao ledger, disparo ao BACEN (outbox)
- Ledger: API de registro contábil consistente, lida com double entry e dispara evento de update-balance (outbox)
- Statements: consultar extrato de recente e paginado, gerar extrato de longo período
- Antifraud: avaliar risco de uma transação baseado em critérios históricos e limites

## Projeto em desenvolvimento, desafios sendo resolvidos:

- 0006 - Antifraude

Para compor a SAGA da transferência teremos algumas etapas: resolução de DICT, checagem de risco, postar no ledger, enviar SPI e confirmação da transação no BACEN. O ledger está pronto, iremos partir para o antifraude.

Responsabilidade: validar risco de uma operação

Regras:

HARD (DENY direto):
- destino marcado como fraude no DICT
- conta origem bloqueada ou desativada
- valor > limite noturno.

SOFT (geram score)
- destino nunca usado + valor alto
+15 pts

- velocity: N transações por janela de X min pela mesma origem
alta (≥ 3 tx em 10min): +15 pts
muito alta (≥ 6 tx em 10min): +35 pts
 
- conta criada há < 24h
+25 pts

- valor fora do padrão da conta
valor atípico (> 3× ticket médio 30 dias): +20 pts
valor muito atípico (> 10× ticket médio 30 dias): +40 pts

Corte:
- Review: 40 <= score < 70
- Deny: score >= 70

Desenvolvimento: receber `POST /evaluate { tx_id, origin_account, dest_key/account, amount, channel, created_at }`, usar tabela risk_evaluations como fonte de verdade para as feature/regras, gravar log das decisões em risk_evaluations e ao fim retornar `{"decision": "REVIEW", "score": 55, "rule_version": "v1", "reasons": ["DEST_NEW:+15", "AMOUNT_3X_AVG:+20", "ACCOUNT_NEW:+25"] `

tabela risk_evaluations
    tx_id (unique), origin_account, dest_key, amount, channel,
    decision, rule_version, features_snapshot jsonb, created_at


Podemos traduzir rules a um json, então tabela de rules com version, thresholds (jsonb), rules (jsonb) deve resolver, e podemos ter indice pelo version.

```
  {
    "version": "v1",
    "thresholds": { "review": 40, "deny": 70 },
    "hard_rules": {
      "DEST_FLAGGED_DICT": { "enabled": true },
      "ORIGIN_BLOCKED":    { "enabled": true },
      "NIGHT_LIMIT":       { 
            "enabled": true,
            "start": "22:00",
            "end": "06:00",
            "max_amount": 100000
        }
    },
    "rules": {
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
    }
  }
```

## Desafios resolvidos anteriormente:

### 0001. Balance, fonte de verdade

Nesse momento, temos um problema: tanto accounts quanto ledger lidam com `balance`, para o ledger é um dado transacional crítico, para accounts uma projeção para ser mostrada no frontend. As tabelas já têm o campo, mas os serviços ainda não se comunicam para manter esse dado eventualmente sincronizado.

Responsabilidade de cada serviço em relação ao `balance`:
1. Accounts terá um consumer para eventos de atualização de saldo, e vai atualizar o saldo do usuário baseado nos eventos que chegam. (pronto)
2. Ledger vai ser a fonte de verdade, e vai ter o saldo atualizado a cada transação, além de emitir eventos de atualização de saldo (em um tópico que o accounts precisa observar).

### 0002. Balance, eventos atômicos de atualização de saldo

Ao disparar o evento de atualização de saldo, podemos ter:
1. perda do disparo pós commit, o que geraria inconsistência entre os serviços que compartilham o dado `balance`
2. envio de evento fantasma onde commit não ocorre

Então usaremos relay em loop para disparar eventos que foram commitados, nesse passo a passo:

```
Na transação do ledger: registra na tabela outbox/events como pending.
                                             ↓
Em loop: relay busca na tabela outbox/events por linhas pending.
                                             ↓
Em transaction: dispara eventos e registra na tabela outbox/events como sent
```

### 0003 Separar transaction de ledger

1. Serviço de transações, centraliza: DICT, chamada ao ledger, disparo ao BACEN (outbox).
2. Serviço de registro contábil consistente, lida com double entry e dispara evento de update-balance (outbox)

## Desafios mapeados, pensados e desenhados:

## Desafios mapeados, pensados, mas ainda não desenhados:

- Criar serviço de extrato

- Adicionar SOT de limit ao ledger

- Transação entre instituições: crédito em conta da nossa instituição, débito em conta de outra instituição.

Para esse caso, provavelmente usaremos conta de settlement, que vai ser a perna de débito da nossa operação, mantendo soma zero nas entries. Saldo da conta de settlement vai ser negativo, permitindo conciliar a quantidade de dinheiro que saiu da conta de settlement.

### 0004. Consumer para receive, receberá comunicações do BACEN

Consumiremos as mensagens enviadas pelo BACEN comunicando recebimento de PIX.

Não entendo muito dessa parte do BACEN, então gerei um passo a passo com Claude do que seria o caminho mínimo para entregar/receber mensagem:

1. Caso pacs.008:
- SPI comunica pacs.008
- Validamos a conta
- Respondemos pacs.002 com aceite/rejeição

2. Caso pacs.002:
- SPI comunica pacs.002
- Double entry + evento update saldo

### 0005. API /send, lidar com transações interbancos (SPI BACEN)

- Double entry atômico + evento update saldo como temos em POST /money/transfer, seguido de mensagem para BACEN.

- API DICT - Resolução da conta caso PIX e não tenhamos as informações da conta destino, escrever mock (baseado em [DICT API DOC](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/API-DICT.html)) parece ok para simular em camada caixa preta

- marshal pacs.008 (encoding/xml)
- gerar structs do XSD (xuri/xgen)
- assinar (XMLDSig enveloped) - goxmldsig
- carregar cert ICP-Brasil (sslmate go-pkcs12 + crypto/x509) - *escrever mock parece ok para simular em camada caixa preta*
- mTLS + entrega (crypto/tls + net/http) - *escrever mock parece ok para simular em camada caixa preta*
- validar contra XSD (opcional) - lestrrat-go/libxml2


## Rodando em ambiente local

Em ambiente local estou usando docker-compose para orquestrar os containers, e Nginx para redirecionar as requisições para os serviços corretos baseado no path. A ideia é emular o que eu teria com ECS + ALB para redirect para target groups.