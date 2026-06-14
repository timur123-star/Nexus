import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "./useToastStore";

beforeEach(() => useToastStore.getState().clear());

describe("toast de-duplication", () => {
  it("collapses identical kind+message toasts (no spam from connect retries)", () => {
    const msg = "У сервера REALITY нет публичного ключа (pbk).";
    const id1 = useToastStore.getState().push({ kind: "error", message: msg, duration: 0 });
    const id2 = useToastStore.getState().push({ kind: "error", message: msg, duration: 0 });
    const id3 = useToastStore.getState().push({ kind: "error", message: msg, duration: 0 });
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("still shows distinct messages and distinct kinds", () => {
    useToastStore.getState().push({ kind: "error", message: "A", duration: 0 });
    useToastStore.getState().push({ kind: "error", message: "B", duration: 0 });
    useToastStore.getState().push({ kind: "warning", message: "A", duration: 0 });
    expect(useToastStore.getState().toasts).toHaveLength(3);
  });
});
