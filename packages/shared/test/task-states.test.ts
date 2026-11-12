import { describe, expect, it } from "vitest";
import {
  TASK_STATES,
  TASK_TRANSITIONS,
  TERMINAL_TASK_STATES,
  canTransition,
} from "../src/index.js";

describe("task state machine", () => {
  it("covers the eight spec states", () => {
    expect(TASK_STATES).toEqual([
      "pending",
      "starting",
      "running",
      "waiting_input",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]);
  });

  it("allows the happy path", () => {
    expect(canTransition("pending", "starting")).toBe(true);
    expect(canTransition("starting", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
  });

  it("allows waiting_input round trip", () => {
    expect(canTransition("running", "waiting_input")).toBe(true);
    expect(canTransition("waiting_input", "running")).toBe(true);
  });

  it("allows continue from all four terminal states", () => {
    for (const state of TERMINAL_TASK_STATES) {
      expect(canTransition(state, "running")).toBe(true);
    }
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("pending", "running")).toBe(false);
    expect(canTransition("cancelled", "completed")).toBe(false);
  });

  it("has no state with zero outgoing transitions", () => {
    for (const state of TASK_STATES) {
      expect(TASK_TRANSITIONS[state].length).toBeGreaterThan(0);
    }
  });
});
