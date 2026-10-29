import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import { ModelKeyPanel } from "./model-key-panel";
import en from "../locales/en/settings.json";
const api = vi.hoisted(() => ({
  getModelKeySource: vi.fn(),
  getModelKeyDirectory: vi.fn(),
  getModelKeyUsers: vi.fn(),
  saveModelKeySource: vi.fn(),
  refreshModelKeyDirectory: vi.fn(),
  assignModelKeys: vi.fn(),
}));
vi.mock("@multica/core/api", async (original) => ({
  ...(await original<typeof import("@multica/core/api")>()),
  api,
}));
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <I18nProvider locale="en" resources={{ en: { settings: en } }}>
      <QueryClientProvider client={client}>
        <ModelKeyPanel userId="admin" />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return userEvent.setup();
}
const alice = { id: "alice", name: "Alice", email: "alice@example.com" };
const bob = { id: "bob", name: "Bob", email: "bob@example.com" };
const key = (id: string, apiKeyName: string, owner: typeof alice | null, extra = {}) => ({
  id,
  apiKeyName,
  status: "enabled",
  platform: "openai",
  allowedRuntimes: ["codex"],
  position: 0,
  owner,
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  api.getModelKeySource.mockResolvedValue({
    configured: true,
    baseURL: "https://directory.example",
    revision: 7,
    status: "ready",
    directoryCount: 3,
    lastCheckedAt: null,
  });
  api.getModelKeyUsers.mockResolvedValue([alice, bob]);
  api.getModelKeyDirectory.mockResolvedValue({
    items: [
      key("12", "Codex key", null),
      key("9", "Owned key", alice),
      key("30", "Zhipu key", null, { platform: "zhipu", allowedRuntimes: [] }),
    ],
    page: 1,
    hasMore: false,
    platforms: ["openai", "zhipu"],
  });
  api.assignModelKeys.mockResolvedValue({ saved: true });
  api.saveModelKeySource.mockResolvedValue({ saved: true });
});
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}
it("lists every key with its owner and hides disabled keys by default", async () => {
  mount();
  expect(await screen.findByText("Owned key")).toBeInTheDocument();
  expect(screen.getByText("Alice · alice@example.com")).toBeInTheDocument();
  expect(screen.getByText(/3 keys/)).toBeInTheDocument();
  await waitFor(() =>
    expect(api.getModelKeyDirectory).toHaveBeenCalledWith({
      search: "", runtime: "", platform: "", owner: "", status: "", page: 1,
    }),
  );
  // A key without a compatible runtime cannot be selected for assignment.
  expect(screen.getByRole("checkbox", { name: "Zhipu key #30" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
it("filters by owner, platform and disabled state", async () => {
  const user = mount();
  await screen.findByText("Owned key");
  await pick(user, "Owner", "Unassigned");
  await waitFor(() =>
    expect(api.getModelKeyDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({ owner: "none", page: 1 }),
    ),
  );
  await pick(user, "Platform", "zhipu");
  await user.click(screen.getByRole("checkbox", { name: "Show disabled keys" }));
  await waitFor(() =>
    expect(api.getModelKeyDirectory).toHaveBeenLastCalledWith(
      expect.objectContaining({ owner: "none", platform: "zhipu", status: "all" }),
    ),
  );
});
it("assigns unassigned keys directly and confirms before moving owned keys", async () => {
  const user = mount();
  await user.click(await screen.findByRole("checkbox", { name: "Codex key #12" }));
  await pick(user, "Assign to", "Bob · bob@example.com");
  await user.click(screen.getByRole("button", { name: "Assign" }));
  await waitFor(() =>
    expect(api.assignModelKeys).toHaveBeenCalledWith({
      ids: ["12"], userId: "bob", allowTransfer: false,
    }),
  );
  await user.click(await screen.findByRole("checkbox", { name: "Owned key #9" }));
  await user.click(screen.getByRole("button", { name: "Assign" }));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent(
    "Some selected keys belong to Alice · alice@example.com. They will move to Bob · bob@example.com.",
  );
  expect(api.assignModelKeys).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Move keys" }));
  await waitFor(() =>
    expect(api.assignModelKeys).toHaveBeenLastCalledWith({
      ids: ["9"], userId: "bob", allowTransfer: true,
    }),
  );
});
it("revokes only keys that have an owner", async () => {
  const user = mount();
  await user.click(await screen.findByRole("checkbox", { name: "Codex key #12" }));
  expect(screen.getByRole("button", { name: "Revoke" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Owned key #9" }));
  await user.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(api.assignModelKeys).toHaveBeenCalledWith({
      ids: ["9"], userId: null, allowTransfer: false,
    }),
  );
});
it("requires a new directory credential and clears it after successful replacement", async () => {
  const user = mount();
  await screen.findByDisplayValue("https://directory.example");
  const credential = screen.getByLabelText("Directory credential");
  expect(credential).toHaveValue("");
  await user.type(credential, "fixture-directory-secret");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.saveModelKeySource).toHaveBeenCalledWith({
      baseURL: "https://directory.example",
      directoryToken: "fixture-directory-secret",
      revision: 7,
    }),
  );
  await waitFor(() => expect(credential).toHaveValue(""));
});
