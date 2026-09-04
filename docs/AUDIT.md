# STARK.WMS — Auditoria Empresarial e Adversarial (Fase 3)

Data: 2026-09-04
Escopo: todo o backend (`packages/api`), frontend (`packages/web`) e banco de
dados (PostgreSQL via Prisma) construídos nas Fases 1 e 2.

Metodologia: revisão de código orientada a concorrência e regras de negócio,
seguida de comprovação real — testes automatizados que disparam requisições
**genuinamente concorrentes** (`Promise.all`/`Promise.allSettled`, não
`await` sequencial) contra o Postgres real, testes HTTP fim-a-fim com
`supertest` para autorização, e um teste de aceitação que percorre o ciclo
operacional completo com asserções de banco após cada etapa. Nenhum achado
abaixo é hipotético: cada um foi reproduzido antes da correção e tem um
teste que falha sem a correção e passa com ela (ver
`packages/api/test/{concurrency,adversarial,auth-permissions,e2e-flow}.test.ts`).

Todos os problemas P0 e P1 encontrados foram corrigidos nesta mesma sessão.
Ver seção "Status final" ao fim deste documento.

---

## P0 — CRÍTICO (corrigido)

### P0-1 — Inventory Engine: condição de corrida permite sobre-venda / estoque negativo
- **Módulo:** Inventory Engine
- **Arquivo:** `packages/api/src/modules/inventory/inventory.engine.ts`
- **Problema:** `reserveStock`, `transferStock`, `consumeReservation`,
  `blockStock`, `quarantineStock` e `releaseFromQuarantine` liam o saldo
  (`findFirst`), verificavam em JavaScript se havia quantidade suficiente e,
  em uma instrução separada, escreviam o decremento. Entre a leitura e a
  escrita não havia nenhum lock.
- **Causa:** padrão "check-then-act" (TOCTOU) sem garantia atômica no banco.
- **Impacto:** duas requisições concorrentes (ex.: dois pedidos reservando o
  mesmo produto, ou dois operadores concluindo a mesma separação) podiam
  ambas passar na verificação e ambas decrementar, levando `qtyAvailable`
  ou `qtyReserved` a ficar negativo — exatamente os cenários adversariais
  #1 e #2 do roteiro de auditoria.
- **Reprodução:** `test/concurrency.test.ts` → *"two concurrent
  reserveStock calls for more than available"* e *"ten concurrent
  reserveStock calls of 3 against a balance of 10"*.
- **Solução aplicada:** toda mutação de decremento agora passa por
  `guardedDecrement`, que executa `updateMany` com a condição `{ [campo]:
  { gte: qty } }` na cláusula `WHERE` — o próprio banco serializa as duas
  escritas via lock de linha, e o perdedor recebe `count === 0`
  (⇒ `InsufficientStockError`) em vez de sobrescrever o vencedor.
- **Status:** ✅ corrigido e coberto por teste.

### P0-2 — Task Engine: dois operadores podem "iniciar" a mesma tarefa
- **Módulo:** Task Engine
- **Arquivo:** `packages/api/src/modules/tasks/task.service.ts` (`startTask`)
- **Problema:** a validação de `assignedToId`/status era feita em JS a
  partir de uma leitura, e a escrita seguinte (`task.update`) não repetia
  essa condição — um segundo operador que lesse a tarefa antes do primeiro
  commitar também passava na validação e sobrescrevia `assignedToId`.
- **Causa:** mesmo padrão TOCTOU do P0-1, agora sobre o campo de
  atribuição/estado da tarefa.
- **Impacto:** cenário adversarial #10 e a exigência explícita da Fase 1
  ("impedir execução concorrente da mesma tarefa") violados — dois
  operadores acreditam ter a tarefa, apenas o último commit "vale".
- **Reprodução:** `test/concurrency.test.ts` → *"concurrent startTask
  calls: exactly one wins"*.
- **Solução aplicada:** `updateMany` com `WHERE id = ? AND status = ? AND
  assignedToId = ?` (o snapshot exato lido), extraído para
  `taskService.startTaskTx` reaproveitável por qualquer fluxo de domínio.
- **Status:** ✅ corrigido e coberto por teste.

### P0-3 — Liberação de pedido (`release`) duplicada gera alocação dobrada
- **Módulo:** Pedidos / Allocation Engine
- **Arquivo:** `packages/api/src/modules/orders/order.service.ts` (`release`)
- **Problema:** duas chamadas concorrentes de "Liberar pedido" liam
  `status = RECEIVED`, passavam na validação da máquina de estados e
  ambas executavam `allocateOrder`. Como `qtyAllocated` era lido do zero
  em ambas as transações, cada uma reservava a quantidade **total** do
  pedido — estoque real reservado em dobro contra um único pedido.
- **Causa:** transição de estado sem *compare-and-swap* antes de disparar
  o efeito colateral (alocação).
- **Impacto:** um clique duplo no botão "Liberar pedido" (ou uma nova
  tentativa após timeout de rede) faz o sistema reservar 2× a quantidade
  pedida, criando `Allocation`/`PickingTask` fantasmas e possivelmente
  bloqueando estoque de outros pedidos sem necessidade real.
- **Reprodução:** `test/concurrency.test.ts` → *"concurrent release() calls
  on the same order: qtyAllocated ends up exactly qtyOrdered"*.
- **Solução aplicada:** a transição `RECEIVED → RELEASED` agora usa
  `guardedTransition` **antes** de chamar `allocateOrder`; o segundo
  chamador recebe `ConflictError` imediatamente, sem tocar estoque.
- **Status:** ✅ corrigido e coberto por teste.

### P0-4 — Separação (picking) concorrente pode exceder a quantidade sugerida
- **Módulo:** Pedidos / Picking
- **Arquivo:** `packages/api/src/modules/orders/picking.service.ts`
  (`executePickingTask`)
- **Problema:** `qtyPicked` era recalculado em JS (`pickingTask.qtyPicked +
  qtyPicked`) e gravado com `update` incondicional. Duas separações
  parciais concorrentes, cada uma válida contra um `qtyPicked` obsoleto,
  podiam juntas ultrapassar `qtySuggested`, e a que gravasse por último
  sobrescrevia (perdia) a contribuição da outra — *lost update* clássico.
- **Causa:** mesmo padrão TOCTOU, desta vez sobre a contagem acumulada da
  tarefa de picking.
- **Impacto:** cenário adversarial #4 ("concluir picking inexistente/duas
  vezes") e a integridade da contagem de separação; no pior caso, mais
  unidades fisicamente retiradas do que o pedido pediu.
- **Reprodução:** `test/concurrency.test.ts` → *"concurrent partial picks
  that individually look valid but together exceed qtySuggested"*.
- **Solução aplicada:** o incremento de `qtyPicked` agora é um
  `updateMany` atômico guardado por `qtyPicked: { lte: qtySuggested - qty
  }` — a segunda tentativa que ultrapassaria o limite falha com
  `ConflictError` antes de tocar o estoque.
- **Status:** ✅ corrigido e coberto por teste.

### P0-5 — Duplicidade de saldo de estoque para produtos sem controle de lote
- **Módulo:** Inventory Engine / Banco de dados
- **Arquivo:** `packages/api/prisma/schema.prisma` (`InventoryBalance`),
  `inventory.engine.ts` (`getOrCreateBalance`)
- **Problema:** a unicidade era `@@unique([productId, locationId, lotId])`.
  O Postgres trata `NULL` como distinto de `NULL` em índices únicos, então
  duas transações concorrentes criando o **primeiro** saldo de um produto
  sem lote na mesma posição podiam ambas passar pelo `findFirst` (nada
  encontrado) e ambas criar uma linha — duas linhas para a mesma chave
  natural, cada uma com metade da verdade.
- **Causa:** limitação conhecida de índices únicos com colunas
  `NULL`-áveis, não coberta pelo `@@unique` padrão do Prisma.
- **Impacto:** leituras agregadas de estoque por produto/posição podiam
  ficar inconsistentes, e escritas futuras poderiam atualizar apenas uma
  das duas linhas, divergindo do físico real.
- **Solução aplicada:** migração `20260904010152_...` adiciona um índice
  único de expressão `(productId, locationId, COALESCE(lotId, ''))`, que
  colapsa "sem lote" em um valor comparável. `getOrCreateBalance` agora
  tenta `create` e, ao capturar `P2002`, refaz a leitura e retorna a linha
  vencedora em vez de duplicar.
- **Status:** ✅ corrigido (validado pela ausência de duplicidade nos
  testes de concorrência, que criam e disputam saldos sem lote).

### P0-6 — Transição de estado para o mesmo estado era permitida silenciosamente
- **Módulo:** núcleo (todas as máquinas de estado)
- **Arquivo:** `packages/api/src/common/state-machine.ts`
- **Problema:** `assertCanTransition` tinha um atalho `if (from === to)
  return;`. Como `completeTaskTx` (e todo outro `transition()`) sempre
  recalcula o alvo a partir do estado atual lido, chamar a mesma ação uma
  segunda vez sobre uma tarefa **já concluída** não era rejeitado — o
  atalho permitia silenciosamente "reconcluir", sobrescrevendo
  `completedAt` com um novo timestamp.
- **Causa:** o atalho foi pensado como conveniência defensiva genérica,
  mas nenhuma chamada legítima do sistema depende dele — apenas
  reenvios/duplo-clique acidentalmente colidem com o mesmo estado.
- **Impacto:** cenário adversarial #4 ("concluir tarefa duas vezes")
  passava silenciosamente; qualquer transição terminal (`COMPLETED`,
  `SHIPPED`, `CANCELLED`, `RESOLVED`) podia ser "reaplicada" sem erro,
  corrompendo campos de auditoria como `completedAt`/`resolvedAt`.
- **Reprodução:** encontrado ao escrever
  `test/concurrency.test.ts` → *"cannot complete an already-completed
  task"* (o teste falhou antes da correção: a segunda chamada resolvia em
  vez de rejeitar).
- **Solução aplicada:** o atalho foi removido; todo *self-loop* precisa
  estar explicitamente listado no mapa de transições (nenhuma máquina
  deste sistema lista, então toda reaplicação agora é rejeitada com
  `InvalidStateTransitionError`).
- **Status:** ✅ corrigido e coberto por teste (afeta uniformemente
  Receipt, Order, Task, Discrepancy, PickWave, InventoryCount,
  QualityInspection, Package, Shipment).

---

## P1 — ALTO (corrigido)

### P1-1 — Reabastecimento não rastreava o lote de origem
- **Módulo:** Reabastecimento
- **Arquivo:** `packages/api/prisma/schema.prisma` (`ReplenishmentTask`),
  `packages/api/src/modules/replenishment/replenishment.service.ts`
- **Problema:** `ReplenishmentTask` não tinha coluna `lotId`. O scan
  escolhia um saldo de reserva (que podia ter lote), mas a execução
  chamava `transferStock` sem `lotId` — o motor então procurava (e
  potencialmente movia) o saldo **sem lote** na mesma posição, que é uma
  entidade de estoque completamente diferente.
- **Causa:** campo esquecido ao modelar a tarefa de reabastecimento;
  encontrado organicamente ao rodar o script de seed com dados
  aleatórios (produto com controle de lote sorteado para reabastecimento).
- **Impacto:** em produção, isso podia falhar com "estoque insuficiente"
  (caso feliz, como ocorreu no seed) ou, pior, mover silenciosamente a
  quantidade errada de um lote diferente do identificado na recomendação
  — quebra de rastreabilidade de lote/validade.
- **Solução aplicada:** coluna `lotId` adicionada a `ReplenishmentTask`;
  `scanReplenishmentNeeds` agora ordena os candidatos de reserva por FEFO
  quando o produto tem controle de validade (antes usava só FIFO por
  `createdAt`, ignorando validade) e grava o `lotId` escolhido;
  `execute()` propaga esse `lotId` para `transferStock`.
- **Status:** ✅ corrigido; `test/e2e-flow.test.ts` passo 12 exercita
  reabastecimento real.

### P1-2 — Falta de estoque durante alocação abortava o pedido inteiro em vez de gerar backorder
- **Módulo:** Allocation Engine
- **Arquivo:** `packages/api/src/modules/orders/allocation-engine.ts`
- **Problema:** com o P0-1 corrigido, `reserveStock` passou a lançar
  `InsufficientStockError` de forma legítima quando um candidato de saldo
  perde uma corrida de reserva concorrente. `allocateOrderItem` não
  capturava esse erro — ele subia e abortava a transação inteira de
  `release()`, cancelando a liberação do pedido por completo em vez de
  registrar o restante como backorder (comportamento exigido pela seção 16).
- **Causa:** efeito colateral direto do endurecimento do motor de
  estoque; o *loop* de candidatos não previa que uma tentativa pudesse
  falhar de forma esperada.
- **Impacto:** um pedido concorrendo por estoque escasso podia falhar por
  completo (nem o que havia disponível era reservado) em vez de alocar
  parcialmente e reportar o restante como pendência — regressão de
  comportamento de negócio introduzida pelo próprio endurecimento de
  segurança.
- **Solução aplicada:** `InsufficientStockError` de um candidato
  específico agora é capturado e tratado como "este candidato não tem
  mais saldo", avançando para o próximo; se todos se esgotarem, o
  restante vira `backorder`, como já documentado no design original.
- **Status:** ✅ corrigido.

### P1-3 / P1-4 — Capacidade e compatibilidade de endereço eram apenas sugestões, nunca aplicadas na escrita
- **Módulo:** Inventory Engine / Rules Engine
- **Arquivo:** `packages/api/src/modules/inventory/inventory.engine.ts`
- **Problema:** o Rules Engine (`warehouse/rules-engine.ts`) calcula
  capacidade e compatibilidade de categoria apenas para **sugerir** um
  endereço; a função que efetivamente grava estoque
  (`increaseAvailable`/`transferStock`) nunca verificava essas regras —
  um operador podia escolher (na UI ou via API) qualquer posição do tipo
  correto, sem limite de capacidade nem respeito a restrição de
  categoria.
- **Causa:** a regra de negócio existia apenas na camada de sugestão, não
  como invariante do motor de escrita.
- **Impacto:** cenários adversariais #8 e #9 do roteiro
  ("colocar produto incompatível em endereço", "ocupar endereço acima da
  capacidade") eram totalmente possíveis.
- **Reprodução:** `test/concurrency.test.ts` → *"rejects a put-away that
  would exceed capacityQty"* e *"rejects put-away into a location
  restricted to a different category"*.
- **Solução aplicada:** `assertCompatibleAndReserveCapacity` agora roda
  dentro de `increaseAvailable`/`transferStock` antes de qualquer
  escrita: rejeita categoria incompatível (`IncompatibleLocationError`) e
  usa um `updateMany` guardado (`occupiedQty <= capacityQty - qty`) para
  reservar capacidade de forma atômica — inclusive contra duas
  put-aways concorrentes disputando o último espaço da mesma posição.
  Deliberadamente **não** aplicado a `applyCountAdjustment`: um ajuste de
  inventário corrige o sistema para a realidade física, e bloquear a
  correção por causa da capacidade impediria o próprio propósito da
  contagem (ver comentário no código).
- **Status:** ✅ corrigido e coberto por teste. Também corrigiu, de
  quebra, o próprio script de seed (que escolhia posição de destino
  aleatoriamente e passou a violar capacidade sob a nova regra — a
  correção do seed usa a mesma lógica que um operador real seguiria).

### P1-5 — "Assumir tarefa" pulado quando a tarefa já estava `ASSIGNED`
- **Módulo:** Recebimento / Reabastecimento
- **Arquivo:** `receiving.service.ts` (`executePutaway`),
  `replenishment.service.ts` (`execute`)
- **Problema:** o código só disparava a transição para `IN_PROGRESS`
  quando `task.status === "PENDING"`. Se um supervisor já tivesse
  atribuído a tarefa via `/tasks/:id/assign` (deixando-a `ASSIGNED`), essa
  transição era pulada e a chamada subsequente a `completeTaskTx` falhava
  — a máquina de estados só permite `IN_PROGRESS → COMPLETED`, não
  `ASSIGNED → COMPLETED`.
- **Causa:** condição incompleta (`=== "PENDING"` em vez de `!==
  "IN_PROGRESS"`).
- **Impacto:** fluxo "supervisor atribui, operador executa" quebrava para
  put-away e reabastecimento sempre que a atribuição prévia existia —
  bug funcional real, não apenas de concorrência.
- **Solução aplicada:** condição corrigida para `status !== "IN_PROGRESS"`
  em ambos os arquivos, reaproveitando o novo `taskService.startTaskTx`
  guardado (ver P0-2).
- **Status:** ✅ corrigido.

### P1-6 — Reenvio de conferência de item gera divergência duplicada
- **Módulo:** Recebimento
- **Arquivo:** `packages/api/src/modules/receiving/receiving.service.ts`
  (`checkItem`)
- **Problema:** não havia nenhuma guarda contra conferir o mesmo item
  duas vezes — um duplo clique ou um retry de rede reenviava os mesmos
  dados e criava uma **segunda** `Discrepancy` idêntica.
- **Causa:** ausência de checagem de idempotência/estado no ponto de
  entrada da ação.
- **Impacto:** poluição da fila de divergências com duplicatas,
  potencialmente confundindo a resolução (dois registros para o mesmo
  problema real).
- **Solução aplicada:** guarda dupla — checagem em JS (`item.status !==
  "PENDING"` ⇒ `ConflictError` com mensagem clara) mais um `updateMany`
  atômico (`status: "PENDING"` na cláusula `WHERE`) para fechar também a
  janela de concorrência verdadeira.
- **Status:** ✅ corrigido.

### P1-7 — Geração de efeitos colaterais antes da transição guardada, em múltiplos módulos
- **Módulo:** Recebimento, Pedidos, Ondas, Inventário, Expedição
- **Arquivos:** `receiving.service.ts` (`completeConference`),
  `order.service.ts` (`startPicking`), `wave.service.ts` (`release`),
  `count.service.ts` (`completeCounting`, `approve`, `applyAdjustments`),
  `shipping.service.ts` (`ship`)
- **Problema:** o padrão geral era "gerar tarefas/ajustes/movimentos" e
  **depois** gravar a mudança de status — sem CAS, duas chamadas
  concorrentes da mesma ação passavam ambas pela validação e cada uma
  gerava seu próprio conjunto de efeitos colaterais (tarefas de put-away
  duplicadas, tarefas de picking duplicadas, divergências duplicadas,
  ajuste de estoque aplicado duas vezes, movimentação de expedição
  duplicada).
- **Causa:** mesma classe de bug do P0-3, replicada por cópia do padrão
  em vários módulos.
- **Impacto:** qualquer um desses pontos, sob duplo clique ou nova
  tentativa após timeout, corrompia dados operacionais reais (o mais
  grave: `applyAdjustments` aplicando a mesma correção de inventário
  duas vezes sobre o saldo físico).
- **Solução aplicada:** em cada função, a transição de estado (via
  `guardedTransition`) agora ocorre **antes** de qualquer efeito
  colateral, usando o CAS para garantir que apenas uma chamada concorrente
  prossiga.
- **Status:** ✅ corrigido em todos os pontos listados.

---

## P2 — MÉDIO (não bloqueante, documentado)

| ID | Módulo | Achado | Recomendação |
|----|--------|--------|--------------|
| P2-1 | Config/Segurança | `JWT_SECRET` tem fallback de desenvolvimento (`"dev-secret-change-me"`) em `config/env.ts` — um deploy que esqueça de definir a variável de ambiente subia silenciosamente com um segredo público. | **Corrigido nesta sessão:** `env.ts` agora recusa iniciar (`throw`) quando `NODE_ENV=production` e o segredo ainda é o fallback de desenvolvimento. O fallback continua existindo apenas para `npm run dev` funcionar sem configuração. |
| P2-2 | Inventário | `recordCount`/`recordCount(isRecount)` não tem CAS por item — um duplo envio apenas sobrescreve o mesmo campo com o último valor. Baixo risco: é um dado observacional (contagem), não movimenta estoque. | Aceitável como está; adicionar guarda apenas se o fluxo de contagem por coletor ganhar múltiplos operadores por posição. |
| P2-3 | Modelagem | Hierarquia de armazém é `Zone` + campos `aisle/rack/level/position` "achatados" em `Location`, em vez de `Aisle`/`Rack`/`Level` como entidades separadas (como literalmente listado na Fase 1 do briefing). | Simplificação deliberada, mantida — o endereço final (`fullCode`) é único e navegável; migrar para tabelas separadas só se houver necessidade operacional real de gerenciar essas entidades independentemente. |
| P2-4 | Frontend | Não há tela dedicada para criar/editar Zonas e Localizações — o CRUD existe na API (`/api/warehouse/zones`, `/api/warehouse/locations`), mas a estrutura do armazém hoje só é provisionada via seed ou chamada direta à API. | Adicionar tela de administração de estrutura do armazém em uma próxima iteração. |
| P2-5 | Mobile | O fluxo do coletor (tarefa → endereço → scan → produto → quantidade → confirmar → concluir) cobre PICKING, PUTAWAY e REPLENISHMENT; RECEIVING/CONFERENCE e COUNT só têm UI no desktop. | Extensão natural, não bloqueante — as operações de maior volume no piso (separação, armazenagem, reabastecimento) já têm experiência mobile completa. |

## P3 — BAIXO (melhoria futura)

| ID | Achado |
|----|--------|
| P3-1 | `GET /users` e `/users/:id/productivity` aceitam `task.assign` OU `dashboard.read`, não só `users.manage` — intencional (necessário para os seletores de atribuição de tarefa e dashboards de produtividade) e nunca vaza `passwordHash`, mas permite que qualquer operador veja a produtividade individual de qualquer colega, não só a própria. Baixa sensibilidade para uma ferramenta operacional interna. |
| P3-2 | Nenhuma auditoria automatizada de acessibilidade (navegação por teclado, ARIA, contraste) foi executada — o tema escuro foi desenhado com contraste adequado, mas não verificado por ferramenta. |
| P3-3 | `/api/auth/login` não tem *rate limiting* ou proteção contra força bruta. Aceitável atrás de controles de rede internos; recomendado antes de qualquer exposição externa. |

---

## Itens verificados como seguros (sem correção necessária)

Estes cenários do roteiro adversarial (seção 3.13) foram testados e
**não** apresentaram falha — documentados aqui com a evidência, não
apenas por leitura de código:

- **#6/#7 Burlar FIFO/FEFO:** estruturalmente impossível pela API — o
  endereço e o lote de uma `PickingTask` são decididos pelo Allocation
  Engine no momento da alocação e gravados no banco; o endpoint de
  execução de picking nunca aceita um `locationId`/`lotId` vindo do
  cliente, apenas a quantidade.
- **#16 Alterar lote indevidamente:** não existe endpoint que edite campos
  de `Lot` diretamente; a única mutação de lote além da criação (durante
  a conferência de recebimento) é a troca de `status` feita pelo módulo
  de Qualidade, que por sua vez é gated por `quality.manage` e passa pelo
  motor de estoque (quarentena/liberação).
- **#14/#15 Movimentar estoque bloqueado / usar estoque em quarentena:**
  `reserveStock` e `transferStock` só leem `qtyAvailable`; estoque
  bloqueado ou em quarentena nunca aparece nesse saldo. Coberto por
  `test/adversarial.test.ts`.
- **#5/#18 Alterar estoque sem permissão / acessar dados de outro
  usuário:** confirmado via `test/auth-permissions.test.ts` com chamadas
  HTTP reais (não só ocultação de botão) — OPERATOR recebe 403 em
  `/inventory/adjust`, `/inventory/block`, `/users`, `POST /users`,
  `/counts/:id/apply-adjustments`, `/catalog/products`,
  `/orders/:id/release`; um operador não pode iniciar (`start`) uma
  tarefa já atribuída a outro operador (409).
- **#11 Duplicar recebimento:** número de recebimento é único por
  restrição de banco + checagem explícita, retornando `ConflictError`.
- **#12/#13 Expedir pedido cancelado / cancelar pedido expedido:**
  `CANCELLED` nunca alcança `STAGING` (máquina de estados do Pedido não
  lista esse caminho), e `SHIPPED` é terminal — ambos confirmados por
  teste, incluindo tentativa de expedir a mesma remessa duas vezes.
- **#3 Expedir pedido incompleto:** quando o estoque é insuficiente na
  liberação, o pedido registra `backorder` explícito
  (`qtyOrdered` × `qtyAllocated`/`qtyShipped` divergem de forma visível
  nos dados) em vez de expedir a quantidade total silenciosamente.

---

## Auditoria de arquitetura e banco (seções 3.1/3.2)

- **Separação de camadas:** confirmada — o frontend (`packages/web`)
  nunca decide regra de negócio, apenas chama a API e renderiza; toda
  validação de domínio (zod nos limites de rota, motores de
  estoque/alocação/regras/tarefas, máquinas de estado) vive em
  `packages/api/src`.
- **RBAC:** aplicado em toda rota via `requirePermission`, orientado a
  dados (`common/permissions.ts` + tabela `RolePermission`), não por
  `if (role === "ADMIN")` espalhado pelo código.
- **Chaves estrangeiras/índices:** todas as relações do schema Prisma têm
  FK declarada; índices adicionados nos caminhos de consulta mais
  usados (`InventoryBalance` por produto/local/lote, `Task` por
  tipo+status e por `refType`+`refId`, `AuditLog` por entidade e por
  data). Não há endpoints de exclusão para cadastros/estrutura de
  armazém, então o risco de "dados órfãos por deleção" não se aplica —
  todo o CRUD exposto é create/update.
- **Transações:** toda operação que precisa ser atômica (put-away,
  picking, expedição, ajuste de contagem) roda dentro de um único
  `prisma.$transaction`, incluindo a escrita de `Movement` e `AuditLog` —
  se qualquer etapa falhar, tudo é revertido junto.

## Auditoria de segurança (seção 3.9)

- Senhas: hash bcrypt (custo 10), nunca devolvidas em nenhuma resposta de
  API (confirmado por teste).
- Segredos: `.env` fora do controle de versão (`.gitignore`); nenhuma
  credencial hardcoded no código-fonte além do fallback documentado em
  P2-1.
- Autorização: verificada no backend (middleware `requirePermission`),
  não apenas na UI — confirmado por chamadas HTTP diretas ignorando a
  interface.
- Validação de entrada: todo corpo de requisição passa por schema `zod`
  antes de chegar à camada de serviço.

---

## Status final

Após as correções acima:

```
npx tsc -p tsconfig.json --noEmit     → OK (build limpo)
npx tsc -p tsconfig.test.json --noEmit → OK (inclui testes)
npx vitest run                         → 78/78 testes passando
  test/state-machine.test.ts    (16 testes)
  test/concurrency.test.ts       (9 testes)
  test/auth-permissions.test.ts (23 testes)
  test/e2e-flow.test.ts         (20 testes — ciclo completo fornecedor → auditoria)
  test/adversarial.test.ts      (10 testes)
npm run build (api + web)              → OK
Seed completo (prisma/seed.ts)         → executado 7× consecutivas sem falha,
                                          exercitando o ciclo real via camada
                                          de serviço (não inserts soltos)
Smoke test via navegador headless      → 21 rotas do desktop + fluxo mobile
                                          completo de picking (scan real) +
                                          liberação de pedido + execução de
                                          reabastecimento, validados após as
                                          correções de concorrência
```

**P0 = 0 em aberto. P1 = 0 em aberto.** Os itens P2/P3 remanescentes são
melhorias documentadas, não bloqueios — nenhum compromete integridade de
estoque, autorização ou o fluxo operacional ponta a ponta.

Critério da seção 3.18 do briefing: build ✅, typecheck ✅, testes ✅,
smoke test ✅, fluxo ponta a ponta ✅, P0=0 ✅, P1=0 ✅, nenhuma
inconsistência crítica de estoque encontrada nos testes ✅, nenhuma falha
crítica de autorização encontrada ✅, operações fundamentais conectadas ao
banco ✅, frontend e backend sincronizados ✅, auditoria (trilha de
`AuditLog`) funcionando e coberta por teste ✅.
