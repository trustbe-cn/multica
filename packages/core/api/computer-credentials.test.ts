// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import { setSchemaLogger } from "./schema";

afterEach(() => vi.unstubAllGlobals());

it("rejects malformed server credentials without logging returned secrets", async () => {
  const warn = vi.fn();
  setSchemaLogger({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          operator: false,
          settings: { multica_pat: "never-log-returned-secret" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const api = new ApiClient("https://api.example.test");
  await expect(
    api.readComputerCredentials("binding", "fake-password"),
  ).rejects.toThrow();
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://api.example.test/api/me/computer-bindings/binding/credentials/read",
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain(
    "never-log-returned-secret",
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain("fake-password");
});

it("requires a successful write receipt and redacts malformed responses", async () => {
  const warn = vi.fn();
  setSchemaLogger({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const settings = {
    git_name: "",
    git_email: "",
    gitlab_url: "",
    gitlab_token: "",
    git_ssh_key: "",
    git_known_hosts: "",
    model_env: "",
    multica_pat: "",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ saved: true }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ saved: false, secret: "never-log-write-secret" }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const api = new ApiClient("https://api.example.test");
  await expect(
    api.writeComputerCredentials("binding", "fake-password", settings),
  ).resolves.toEqual({ saved: true });
  await expect(
    api.writeComputerCredentials("binding", "fake-password", settings),
  ).rejects.toThrow();
  expect(JSON.stringify(warn.mock.calls)).not.toContain(
    "never-log-write-secret",
  );
});
