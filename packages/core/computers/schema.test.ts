// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { parseComputerSettings } from "./schema";
import { setSchemaLogger } from "../api/schema";

describe("Computer settings response", () => {
  it("rejects malformed secrets without logging their value", () => {
    const warn = vi.fn();
    setSchemaLogger({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() });
    expect(() =>
      parseComputerSettings({
        operator: true,
        settings: { multica_pat: "never-log-this" },
      }),
    ).toThrow();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("never-log-this");
  });
  it("returns the owner's valid settings", () => {
    const data = {
      operator: false,
      settings: {
        git_name: "User",
        git_email: "u@example.com",
        gitlab_url: "https://git.example.com",
        gitlab_token: "fake",
        git_ssh_key: "",
        git_known_hosts: "",
        model_env: "",
        multica_pat: "mul_fake",
      },
    };
    expect(parseComputerSettings(data)).toEqual(data);
  });
});
