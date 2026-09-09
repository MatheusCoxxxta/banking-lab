# Transactions

## Motivacão

Resolvi codar o mesmo Ledger que fiz em Node, mas agora em Go. Me quebrou demais a cabeça, entao nos proximos dias refatoro, por enquanto corri com praticamente tudo single file (tirando a parte autogerada pelo SQLC), sem usar AI pra codar, focando apenas nas funcionalidades basicas de um Ledger: transacionar dinheiro entre contas, garantindo consistencia e atomicidade.

Mantive o nome das APIs inauterados com o projeto Node, entao consegui confrontar com os mesmos smoke tests que fiz no projeto Node, a API de transacao funciona e passou nos testes, falta apenas incluir a API de criar conta e desativar conta, ou direcionar o trafego para a API de criar conta do projeto Node, que ja esta pronta e testada.

## Contexto atual

A ideia a partir daqui é manter essa codebase lidando apenas com a frente de transacoes.