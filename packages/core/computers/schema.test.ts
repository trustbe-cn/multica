// @vitest-environment node
import { InstanceAccessSchema, AdminComputerSchema } from "./admin-schema";
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

// Administrative capabilities fail closed when a response is incomplete.
describe("instance admin response contracts", () => {
  it("requires an explicit boolean capability", () => {
    expect(InstanceAccessSchema.safeParse({}).success).toBe(false);
    expect(InstanceAccessSchema.safeParse({admin:"true"}).success).toBe(false);
    expect(InstanceAccessSchema.parse({admin:false}).admin).toBe(false);
  });
  it("rejects a registry row without its availability state", () => {
    expect(AdminComputerSchema.safeParse({id:"x",name:"Test",host:"test",port:22,ssh_user:"ops"}).success).toBe(false);
  });
});

it("keeps unfamiliar operation and asset states explicitly unknown", async () => {
  const { RemoteOperationSchema } = await import("./schema");
  const { AdminComputerRuntimeSchema } = await import("./admin-schema");
  expect(RemoteOperationSchema.parse({id:"op",binding_id:"b",kind:"new-operation",state:"future-state",created_at:"now"}).state).toBe("interrupted");
  expect(AdminComputerRuntimeSchema.parse({id:"codex",display_name:"Codex",installed_version:"",can_install:true,probe_state:"future-state",registration_state:"future-state"})).toMatchObject({probe_state:"unknown",registration_state:"not_discovered"});
});
