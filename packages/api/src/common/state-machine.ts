import { ConflictError, InvalidStateTransitionError } from "@/common/errors";

// Generic finite state machine guard used by every module that owns a
// status field (Receipt, Order, Task, Discrepancy, PickWave, InventoryCount,
// QualityInspection, Package, Shipment...). Transitions not present in the
// map are rejected — this is what enforces section 39 (no invalid jumps,
// e.g. EXPEDIDO -> PICKING, without an explicit authorized reversal path).
export class StateMachine<S extends string> {
  constructor(private readonly entity: string, private readonly transitions: Record<S, S[]>) {}

  assertCanTransition(from: S, to: S) {
    // No same-state shortcut: audit finding P1-1 caught this the hard way
    // — completeTaskTx(taskId) called a second time on an already-COMPLETED
    // task used to pass silently (from === to), re-running the "complete"
    // side effects and overwriting completedAt with a fresh timestamp. Every
    // transition, self-loops included, must be explicitly listed in the map
    // to be allowed; none of this codebase's state machines currently list
    // themselves as a valid target, so "concluir tarefa duas vezes" (and its
    // analogues on every other entity) is now rejected outright rather than
    // silently re-applied.
    const allowed = this.transitions[from] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidStateTransitionError(this.entity, from, to);
    }
  }
}

interface UpdateManyDelegate {
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
}

/**
 * Audit section 3.5/3.7: every status transition in this codebase is
 * validated against a StateMachine, but validating in JS against a value
 * read moments earlier is not enough on its own — two concurrent requests
 * can both read the same "from" status, both pass assertCanTransition, and
 * a plain `update(...)` would let the second one silently clobber whatever
 * the first one committed (see docs/AUDIT.md #P0-1). This wraps the actual
 * write as a compare-and-swap: the WHERE clause re-pins the exact "from"
 * status we validated against, so Postgres' row lock serializes the two
 * writers and the loser gets `false` (never a silent overwrite) instead of
 * a count we'd have to remember to check every call site.
 *
 * Every module-level `transition()` helper in this codebase should route
 * its write through this function rather than calling `<model>.update(...)`
 * directly — that plain form is exactly the bug this exists to prevent.
 */
export async function guardedTransition(
  delegate: UpdateManyDelegate,
  id: string,
  fromStatus: string,
  data: Record<string, unknown>
): Promise<void> {
  const result = await delegate.updateMany({ where: { id, status: fromStatus }, data });
  if (result.count === 0) {
    throw new ConflictError("Registro foi alterado por outra operação nesse meio tempo; recarregue e tente novamente.");
  }
}
