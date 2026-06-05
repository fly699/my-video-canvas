import { describe, it, expect, beforeEach } from "vitest";
import { useComfyServersStore } from "../hooks/useComfyServersStore";

describe("useComfyServersStore", () => {
  beforeEach(() => useComfyServersStore.setState({ servers: [] }));

  it("adds, trims whitespace, and de-duplicates", () => {
    const { add } = useComfyServersStore.getState();
    add("  http://127.0.0.1:8188 ");
    add("http://127.0.0.1:8188"); // dup after trim
    add("");                       // ignored
    expect(useComfyServersStore.getState().servers).toEqual(["http://127.0.0.1:8188"]);
  });

  it("removes an address", () => {
    useComfyServersStore.setState({ servers: ["a", "b", "c"] });
    useComfyServersStore.getState().remove("b");
    expect(useComfyServersStore.getState().servers).toEqual(["a", "c"]);
  });

  it("caps the list at 50 (keeps the most recent)", () => {
    const { add } = useComfyServersStore.getState();
    for (let i = 0; i < 60; i++) add(`http://host-${i}`);
    const s = useComfyServersStore.getState().servers;
    expect(s.length).toBe(50);
    expect(s[s.length - 1]).toBe("http://host-59");
    expect(s[0]).toBe("http://host-10");
  });
});
