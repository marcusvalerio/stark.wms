import { InvalidStateTransitionError } from "@/common/errors";

// Generic finite state machine guard used by every module that owns a
// status field (Receipt, Order, Task, Discrepancy, PickWave, InventoryCount,
// QualityInspection, Package, Shipment...). Transitions not present in the
// map are rejected — this is what enforces section 39 (no invalid jumps,
// e.g. EXPEDIDO -> PICKING, without an explicit authorized reversal path).
export class StateMachine<S extends string> {
  constructor(private readonly entity: string, private readonly transitions: Record<S, S[]>) {}

  assertCanTransition(from: S, to: S) {
    if (from === to) return;
    const allowed = this.transitions[from] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidStateTransitionError(this.entity, from, to);
    }
  }
}
