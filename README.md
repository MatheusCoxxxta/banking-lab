# Banking

Peguei tudo que fiz no ledger-lab Node e no ledger-lab Go, centralizei aqui, e vou usar para dar uma aprofundada.

Como a versão Node implementava tanto transações quanto gestão de contas, descontinuei transações, que reescrevi em Go.

## Responsabilidade geral cada serviço:

- Accounts: CRUD de contas (consulta de saldo com consistência eventual)
- Transactions: API de transações consistentes

## Desafios mapeados, pensados e desenhados:

### 0001. Balance, fonte de verdade

Nesse momento, temos um problema: tanto accounts quanto transactions usam o mesmo banco de dados, e necessitam de `balance`, da entidade de usuário. Separar os bancos de dados não será difícil, mas exige que tomemos decisões sobre o `balance`.

Decidi ir por um modelo simples de read replica orientada a eventos, onde accounts tem `balance` com consistência eventual, enquanto transactions tem `balance` com consistência forte. A ideia é que transactions seja a fonte de verdade, é onde dinheiro realmente circula, e accounts apenas uma projeção eventual, usado para consultas rápidas e ações de front-end (impossibilitar o início de uma transferência sem saldo, por exemplo). 

Responsabilidade de cada serviço em relação ao `balance`:
1. Accounts terá um consumer para eventos de atualização de saldo, e vai atualizar o saldo do usuário baseado nos eventos que chegam.
2. Transactions vai ser a fonte de verdade, e vai ter o saldo atualizado a cada transação, além de emitir eventos de atualização de saldo.

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

## Desafios mapeados, pensados, mas ainda não desenhados:

- Transação entre instituições: crédito em conta da nossa instituição, débito em conta de outra instituição.

Para esse caso, provavelmente usaremos conta de settlement, que vai ser a perna de débito da nossa operação, mantendo soma zero nas entries. Saldo da conta de settlement vai ser negativo, permitindo conciliar a quantidade de dinheiro que saiu da conta de settlement.

## Rodando em ambiente local

Em ambiente local estou usando docker-compose para orquestrar os containers, e Nginx para redirecionar as requisições para os serviços corretos baseado no path. A ideia é emular o que eu teria com ECS + ALB para redirect para target groups.