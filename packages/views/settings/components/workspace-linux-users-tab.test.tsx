import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import en from "../../locales/en/settings.json";
import { WorkspaceLinuxUsersTab } from "./workspace-linux-users-tab";

const api = vi.hoisted(() => ({
  getComputerSettings: vi.fn(), listComputers: vi.fn(),
  listComputerBindings: vi.fn(), operateComputer: vi.fn(),
}));
vi.mock("@multica/core/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@multica/core/api")>(), api,
}));
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "alice", email: "alice@example.test" } };
  return { useAuthStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
vi.mock("@multica/core/paths", async (importOriginal) => ({
  ...await importOriginal<typeof import("@multica/core/paths")>(),
  useCurrentWorkspace: () => ({ id: "new-workspace", slug: "new", name: "New" }),
}));
vi.mock("../../navigation", () => ({ AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const removed = {
  id: "available", computer_id: "machine", workspace_id: "old-workspace",
  username: "alice-worker", state: "removed", last_error: "", verified: true,
  account_state: "present", operation_busy: false,
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<I18nProvider locale="en" resources={{ en: { settings: en } }}>
    <QueryClientProvider client={client}><WorkspaceLinuxUsersTab /></QueryClientProvider>
  </I18nProvider>);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getComputerSettings.mockResolvedValue({ operator: false, settings: { multica_pat: "personal-token" } });
  api.listComputers.mockResolvedValue([{ id: "machine", name: "Host", enabled: true }]);
  api.listComputerBindings.mockResolvedValue([removed, { ...removed, id: "occupied", username: "alice-busy", state: "ready" }]);
  api.operateComputer.mockResolvedValue(undefined);
});

describe("workspace Linux User connection", () => {
  it("only submits an eligible account to the current workspace", async () => {
    mount();
    const user = userEvent.setup();
    const occupied = await screen.findByRole("radio", { name: /alice-busy/ });
    expect(occupied).toBeDisabled();
    expect(screen.getByText(/Remove its managed daemon there first/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /alice-worker/ }));
    await user.type(screen.getByLabelText("Linux password"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect account" }));
    await waitFor(() => expect(api.operateComputer).toHaveBeenCalledWith({
      computer_id: "machine", workspace_id: "new-workspace",
      username: "alice-worker", password: "secret", action: "provision",
    }));
  });

  it("requires personal credentials before provisioning", async () => {
    api.getComputerSettings.mockResolvedValue({ operator: false, settings: { multica_pat: "" } });
    mount();
    expect(await screen.findByText(/Save your personal credentials/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect account" })).toBeDisabled();
  });

  it("provisions a new Linux username on the selected Computer", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New account" }));
    await user.click(screen.getByRole("combobox", { name: "Choose a Computer" }));
    await user.click(await screen.findByRole("option", { name: "Host" }));
    await user.type(screen.getByLabelText("Linux username"), "alice-build");
    await user.type(screen.getByLabelText("Linux password"), "secret");
    await user.click(screen.getByRole("button", { name: "Connect account" }));
    await waitFor(() => expect(api.operateComputer).toHaveBeenCalledWith({
      computer_id: "machine", workspace_id: "new-workspace",
      username: "alice-build", password: "secret", action: "provision",
    }));
  });

  it("shows an unverified provisioning attempt and its eventual failure", async () => {
    api.listComputerBindings.mockResolvedValueOnce([{
      ...removed, id: "pending", workspace_id: "new-workspace", username: "alice-new",
      verified: false, state: "running",
    }]).mockResolvedValue([{
      ...removed, id: "pending", workspace_id: "new-workspace", username: "alice-new",
      verified: false, state: "failed", last_error: "Remote setup failed",
    }]);
    const client = mount();
    expect(await screen.findByText(/Host · alice-new/)).toBeInTheDocument();
    await client.invalidateQueries({ queryKey: ["computers", "alice", "bindings"] });
    expect(await screen.findByText("Remote setup failed")).toBeInTheDocument();
    expect(screen.queryByText("You have no account connection in this workspace.")).not.toBeInTheDocument();
  });

  it("lets the owner open account management for an occupied account", async () => {
    mount();
    await screen.findByRole("radio", { name: /alice-busy/ });
    expect(screen.getAllByRole("link", { name: "Open my environments" })[0]).toHaveAttribute(
      "href", "/new/settings?tab=computers",
    );
  });
});
