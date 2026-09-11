# Banking

Laboratório de core banking distribuído: double-entry ledger, microserviços de contas, transações, ledger e extrato, consistência forte no ledger e projeção eventual via eventos.

## Motivação

Peguei tudo que fiz no ledger-lab Node e no ledger-lab Go, centralizei aqui, e vou usar para dar uma aprofundada.

Como a versão Node implementava tanto transações quanto gestão de contas, descontinuei transações, que reescrevi em Go.

## Responsabilidade geral cada serviço:

- Accounts: CRUD de contas (consulta de saldo com consistência eventual)
- Transactions: API de transações, centraliza: DICT, chamada ao ledger, disparo ao BACEN (outbox)
- Ledger: API de registro contábil consistente, lida com double entry e dispara evento de update-balance (outbox)
- Statements: consultar extrato de recente e paginado, gerar extrato de longo período

## Desafios resolvidos:

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

## Desafios sendo resolvidos:

- Separar transaction de ledger

1. Serviço de transações, centraliza: DICT, chamada ao ledger, disparo ao BACEN (outbox).
2. Serviço de registro contábil consistente, lida com double entry e dispara evento de update-balance (outbox)

## Desafios mapeados, pensados e desenhados:

## Desafios mapeados, pensados, mas ainda não desenhados:

- Criar serviço de extrato

- Adicionar SOT de limit ao ledger

- Transação entre instituições: crédito em conta da nossa instituição, débito em conta de outra instituição.

Para esse caso, provavelmente usaremos conta de settlement, que vai ser a perna de débito da nossa operação, mantendo soma zero nas entries. Saldo da conta de settlement vai ser negativo, permitindo conciliar a quantidade de dinheiro que saiu da conta de settlement.

### 0003. Consumer para receive, receberá comunicações do BACEN

Consumiremos as mensagens enviadas pelo BACEN comunicando recebimento de PIX.

Não entendo muito dessa parte do BACEN, então gerei um passo a passo com Claude do que seria o caminho mínimo para entregar/receber mensagem:

1. Caso pacs.008:
- SPI comunica pacs.008
- Validamos a conta
- Respondemos pacs.002 com aceite/rejeição

2. Caso pacs.002:
- SPI comunica pacs.002
- Double entry + evento update saldo

### 0004. API /send, lidar com transações interbancos (SPI BACEN)

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