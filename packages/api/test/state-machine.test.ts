import { describe, expect, it } from "vitest";
import { StateMachine } from "@/common/state-machine";
import { InvalidStateTransitionError } from "@/common/errors";
import { orderStateMachine } from "@/modules/orders/order.service";
import { receiptStateMachine } from "@/modules/receiving/receiving.service";
import { taskStateMachine, computeTaskPriority } from "@/modules/tasks/task.service";
import { discrepancyStateMachine } from "@/modules/discrepancy/discrepancy.service";

describe("StateMachine", () => {
  it("allows a declared transition", () => {
    const sm = new StateMachine<"A" | "B">("Test", { A: ["B"], B: [] });
    expect(() => sm.assertCanTransition("A", "B")).not.toThrow();
  });

  it("rejects an undeclared transition", () => {
    const sm = new StateMachine<"A" | "B">("Test", { A: ["B"], B: [] });
    expect(() => sm.assertCanTransition("B", "A")).toThrow(InvalidStateTransitionError);
  });

  it("treats a same-state transition as a no-op", () => {
    const sm = new StateMachine<"A" | "B">("Test", { A: [], B: [] });
    expect(() => sm.assertCanTransition("A", "A")).not.toThrow();
  });
});

describe("Order state machine (section 15/39)", () => {
  it("never allows SHIPPED to jump back to PICKING", () => {
    expect(() => orderStateMachine.assertCanTransition("SHIPPED", "PICKING")).toThrow(InvalidStateTransitionError);
  });

  it("follows the documented happy path", () => {
    const path: Parameters<typeof orderStateMachine.assertCanTransition>[0][] = [
      "RECEIVED", "RELEASED", "ALLOCATED", "PICKING", "PICKED", "CONFERENCE", "PACKING", "STAGING", "READY", "SHIPPED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => orderStateMachine.assertCanTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("cannot skip straight from RECEIVED to PICKING", () => {
    expect(() => orderStateMachine.assertCanTransition("RECEIVED", "PICKING")).toThrow(InvalidStateTransitionError);
  });
});

describe("Receipt state machine (section 8)", () => {
  it("follows agendado -> chegada -> doca -> conferência -> conferido -> putaway -> finalizado", () => {
    const path: Parameters<typeof receiptStateMachine.assertCanTransition>[0][] = [
      "SCHEDULED", "ARRIVED", "AT_DOCK", "IN_CONFERENCE", "CONFERRED", "PUTAWAY", "COMPLETED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => receiptStateMachine.assertCanTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("cannot cancel a completed receipt", () => {
    expect(() => receiptStateMachine.assertCanTransition("COMPLETED", "CANCELLED")).toThrow(InvalidStateTransitionError);
  });
});

describe("Task state machine (section 20/39 — no concurrent execution)", () => {
  it("cannot start a task that is already completed", () => {
    expect(() => taskStateMachine.assertCanTransition("COMPLETED", "IN_PROGRESS")).toThrow(InvalidStateTransitionError);
  });
  it("allows PENDING straight to IN_PROGRESS (self-assign on start)", () => {
    expect(() => taskStateMachine.assertCanTransition("PENDING", "IN_PROGRESS")).not.toThrow();
  });
});

describe("Discrepancy state machine (section 10 — never silently corrected)", () => {
  it("requires an explicit resolution, cannot jump straight from OPEN back to OPEN via RESOLVED twice", () => {
    expect(() => discrepancyStateMachine.assertCanTransition("RESOLVED", "IN_REVIEW")).toThrow(InvalidStateTransitionError);
  });
});

describe("Task priority engine (section 21)", () => {
  it("escalates to CRITICAL when SLA is within 30 minutes", () => {
    const slaDueAt = new Date(Date.now() + 10 * 60_000);
    expect(computeTaskPriority({ orderPriority: "NORMAL", slaDueAt })).toBe("CRITICAL");
  });

  it("escalates to HIGH when SLA is within 2 hours", () => {
    const slaDueAt = new Date(Date.now() + 60 * 60_000);
    expect(computeTaskPriority({ orderPriority: "NORMAL", slaDueAt })).toBe("HIGH");
  });

  it("a CRITICAL order is always CRITICAL regardless of SLA", () => {
    expect(computeTaskPriority({ orderPriority: "CRITICAL" })).toBe("CRITICAL");
  });

  it("defaults to NORMAL with no signals", () => {
    expect(computeTaskPriority({})).toBe("NORMAL");
  });
});
