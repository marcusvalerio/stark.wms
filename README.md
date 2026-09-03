# STARK.WMS

Warehouse Management System empresarial — sistema operacional real, não um mockup.
Controla o fluxo completo: **recebimento → conferência → put-away → estoque →
reabastecimento → pedidos → alocação → picking → conferência → packing →
staging → expedição**, com inventário, qualidade, divergências e auditoria
integrados ponta a ponta.

## Arquitetura

Monorepo (`npm workspaces`) com separação estrita de camadas:

```
packages/
  api/    Node.js + TypeScript + Express + Prisma + PostgreSQL
          src/modules/<domínio>/{*.service.ts, *.routes.ts, *.schema.ts}
          — cada módulo separa apresentação (routes), regra de negócio
          (service/engine), acesso a dados (Prisma) e validação (zod).
  web/    React + TypeScript + Vite + TanStack Query
          Desktop/tablet: gestão e operação. /mobile: coletor.
```

Motores centrais (não CRUD decorativo):

- **Inventory Engine** (`inventory.engine.ts`) — único escritor de
  `InventoryBalance`; separa físico / disponível / reservado / bloqueado /
  quarentena e gera `Movement` a cada mutação.
- **Allocation Engine** (`allocation-engine.ts`) — reserva estoque por
  FIFO/FEFO ao liberar um pedido e gera tarefas de picking.
- **Rules Engine** (`rules-engine.ts`) — sugestão de endereço de
  armazenagem por capacidade, peso, volume e compatibilidade de categoria.
- **Task Engine** (`tasks/task.service.ts`) — envelope genérico de
  orquestração (estado, prioridade, atribuição, SLA) reutilizado por
  recebimento, put-away, picking, reabastecimento, contagem e expedição.
- Toda entidade com ciclo de vida (Receipt, Order, Task, Discrepancy,
  PickWave, InventoryCount, QualityInspection, Package, Shipment) tem uma
  **máquina de estados explícita** (`common/state-machine.ts`) — transições
  inválidas são rejeitadas.

RBAC orientado a dados: permissões (`common/permissions.ts`) são seedadas
por perfil (ADMIN, MANAGER, SUPERVISOR, OPERATOR, CHECKER, SHIPPING) e
checadas em toda rota via `requirePermission`.

## Rodando localmente

Pré-requisitos: Node 20+, PostgreSQL 16 (local ou via `docker compose up -d`).

```bash
npm install

cp packages/api/.env.example packages/api/.env
# ajuste DATABASE_URL se necessário

npm run prisma:migrate     # cria o schema
npm run prisma:seed        # dados de demonstração (50+ SKUs, armazém, fluxo completo)

npm run dev:api            # http://localhost:4000
npm run dev:web            # http://localhost:5173 (proxy /api -> :4000)
```

Login de demonstração (senha `stark@123`): `admin@starkwms.com`,
`supervisor@starkwms.com`, `diego.souza@starkwms.com` (operador),
`heitor.prado@starkwms.com` (conferente), `joao.martins@starkwms.com`
(expedição). A tela de login lista os perfis disponíveis.

Coletor mobile: `/mobile` (mesmo login, layout dedicado a operador).

## Metodologia

O sistema foi construído em fases (arquitetura → cadastros → armazém/estoque
→ recebimento → pedidos/alocação/picking → task engine/ondas/reabastecimento
→ inventário/qualidade → packing/expedição/cross-docking → dashboard/control
tower/relatórios → coletor mobile), cada uma consumindo a anterior via
serviço real — o script de seed (`packages/api/prisma/seed.ts`) executa o
ciclo completo (cadastro → operação → tarefa → estado → estoque → histórico)
pelos mesmos serviços usados em produção, não por inserts soltos.
