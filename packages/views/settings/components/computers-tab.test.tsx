import { useState } from "react";
import { NavigationProvider } from "../../navigation";
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import en from "../../locales/en/settings.json";
import { ComputersTab } from "./computers-tab";

const api = vi.hoisted(() => ({
  getComputerSettings: vi.fn(),
  listWorkspaces: vi.fn(),
  listComputers: vi.fn(),
  listComputerBindings: vi.fn(),
  saveComputerSettings: vi.fn(),
  registerComputer: vi.fn(),
  operateComputer: vi.fn(),
  listComputerBindingRuntimes: vi.fn(),
  installComputerBindingRuntime: vi.fn(),
  getComputerBindingDetail: vi.fn(),
  listComputerOperations: vi.fn(),
  discoverComputerBinding: vi.fn(),
  computerBindingLifecycle: vi.fn(),
  recoverComputerOperation: vi.fn(),
}));
vi.mock("@multica/core/api", () => ({ api }));
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "human-1", email: "alice@example.com" } };
  return {
    useAuthStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
vi.mock("@multica/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/paths")>()),
  useCurrentWorkspace: () => ({
    id: "workspace-1",
    name: "Team",
    slug: "team",
  }),
}));
const settings = {
  git_name: "Alice",
  git_email: "alice@example.com",
  gitlab_url: "https://git.example.com",
  gitlab_token: "fake-token",
  git_ssh_key: "",
  git_known_hosts: "",
  model_env: "OPENAI_API_KEY=fake-key",
  multica_pat: "mul_fake",
};
function TestNavigation({
  initial,
  children,
}: {
  initial: string;
  children: React.ReactNode;
}) {
  const [url, setURL] = useState(initial);
  return (
    <NavigationProvider
      value={{
        pathname: "/team/settings",
        searchParams: new URLSearchParams(url.split("?")[1]),
        hash: "",
        push: setURL,
        replace: setURL,
        back: () => {},
        getShareableUrl: (path) => path,
      }}
    >
      {children}
    </NavigationProvider>
  );
}
function mount(initial = "/team/settings?tab=computers") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <I18nProvider locale="en" resources={{ en: { settings: en } }}>
      <QueryClientProvider client={client}>
        <TestNavigation initial={initial}>
          <ComputersTab />
        </TestNavigation>
      </QueryClientProvider>
    </I18nProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getComputerSettings.mockResolvedValue({ operator: false, settings });
  api.listWorkspaces.mockResolvedValue([
    { id: "workspace-1", name: "Team", slug: "team" },
  ]);
  api.listComputers.mockResolvedValue([]);
  api.listComputerBindings.mockResolvedValue([]);
  api.saveComputerSettings.mockResolvedValue(undefined);
  api.listComputerBindingRuntimes.mockResolvedValue([]);
  api.installComputerBindingRuntime.mockResolvedValue({
    operation_id: "operation-1",
    state: "queued",
  });
  api.listComputerOperations.mockResolvedValue([]);
  api.getComputerBindingDetail.mockResolvedValue({
    id: "binding-1",
    computer_id: "machine-1",
    computer_name: "Dev server",
    workspace_id: "workspace-1",
    workspace_name: "Team",
    username: "alice",
    verified: true,
    state: "ready",
    account_state: "present",
    daemon_state: "stopped",
    daemon_id: "binding-1",
    last_error: "",
    checked_at: null,
    last_seen_at: null,
    archived_at: null,
  });
});

const binding = {
  id: "binding-1",
  computer_id: "machine-1",
  workspace_id: "workspace-1",
  workspace_name: "Team",
  workspace_access: "accessible",
  username: "alice",
  state: "pending",
  verified: true,
  account_state: "present",
  operation_busy: false,
  last_error: "",
};
it("lands on a list, uses detail links, and never reads credentials or runtimes on the list", async () => {
  api.listComputerBindings.mockResolvedValue([
    binding,
    {
      ...binding,
      id: "binding-2",
      username: "build",
      workspace_id: "private-uuid",
      workspace_name: "",
      workspace_access: "unavailable",
      state: "removed",
    },
  ]);
  api.listComputers.mockResolvedValue([
    { id: "machine-1", name: "Dev server", enabled: true },
  ]);
  mount();
  expect(await screen.findByText("Dev server · alice")).toBeInTheDocument();
  expect(screen.getByText("Needs configuration")).toBeInTheDocument();
  expect(screen.getByText("Workspace unavailable")).toBeInTheDocument();
  expect(screen.queryByText("private-uuid")).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("link", { name: "Linux User details" }),
  ).toHaveLength(2);
  expect(screen.queryByLabelText("Linux password")).not.toBeInTheDocument();
  expect(api.getComputerSettings).not.toHaveBeenCalled();
  expect(api.listComputerBindingRuntimes).not.toHaveBeenCalled();
});
it("opens a creation dialog, accepts without credentials, and navigates to operation progress", async () => {
  api.listComputers.mockResolvedValue([
    { id: "machine-1", name: "Dev server", enabled: true },
  ]);
  api.operateComputer.mockResolvedValue(binding);
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New Linux user" }));
  await user.click(screen.getByRole("combobox", { name: en.computers.choose }));
  await user.click(await screen.findByRole("option", { name: "Dev server" }));
  await user.type(screen.getByLabelText(en.computers.username), "alice");
  await user.type(screen.getByLabelText("Linux password"), "password");
  await user.click(
    screen.getByRole("button", { name: en.computers.actions.create_account }),
  );
  await waitFor(() =>
    expect(api.operateComputer).toHaveBeenCalledWith({
      computer_id: "machine-1",
      workspace_id: "workspace-1",
      username: "alice",
      password: "password",
      action: "create_account",
    }),
  );
  expect(
    await screen.findByRole("link", { name: "Operations" }),
  ).toHaveAttribute("aria-current", "page");
  expect(api.getComputerSettings).not.toHaveBeenCalled();
});
it.each(["", "1.2.3"])(
  "installs version %j from a focused dialog",
  async (version) => {
    api.listComputerBindingRuntimes.mockResolvedValue([
      {
        id: "codex",
        display_name: "Codex",
        installed_version: "",
        can_install: true,
        supports_version: true,
        probe_error: "",
      },
    ]);
    mount(
      "/team/settings?tab=computers&linux_user=binding-1&linux_user_view=runtimes",
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Install" }));
    const dialog = screen.getByRole("dialog");
    const { within } = await import("@testing-library/react");
    if (version)
      await user.type(within(dialog).getByLabelText("Codex version"), version);
    await user.click(within(dialog).getByRole("button", { name: "Install" }));
    await waitFor(() =>
      expect(api.installComputerBindingRuntime).toHaveBeenCalledWith(
        "binding-1",
        "codex",
        version || "latest",
      ),
    );
  },
);
it("keeps workspace return context while changing detail sections", async () => {
  mount(
    "/team/settings?tab=computers&linux_user=binding-1&linux_user_from=workspace",
  );
  await screen.findByText("alice · Dev server");
  const user = userEvent.setup();
  expect(
    screen.getByRole("link", { name: "Back to workspace Linux users" }),
  ).toHaveAttribute("href", "/team/settings?tab=linux-users");
  await user.click(screen.getByRole("link", { name: "Operations" }));
  expect(
    screen.getByRole("link", { name: "Back to workspace Linux users" }),
  ).toHaveAttribute("href", "/team/settings?tab=linux-users");
  expect(screen.queryByText("Present")).not.toBeInTheDocument();
});
it("requires typed confirmation in a separate dialog before deleting an account", async () => {
  api.getComputerBindingDetail.mockResolvedValue({
    ...binding,
    computer_name: "Dev server",
    state: "removed",
    daemon_state: "stopped",
    daemon_id: "binding-1",
  });
  api.computerBindingLifecycle.mockResolvedValue({
    operation_id: "op",
    state: "queued",
  });
  mount("/team/settings?tab=computers&linux_user=binding-1");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Delete Linux user" }),
  );
  expect(screen.getByRole("button", { name: "Confirm action" })).toBeDisabled();
  await user.type(screen.getByLabelText("Type alice to confirm"), "alice");
  await user.type(screen.getByLabelText("Linux password for alice"), "secret");
  await user.click(screen.getByRole("button", { name: "Confirm action" }));
  await waitFor(() =>
    expect(api.computerBindingLifecycle).toHaveBeenCalledWith("binding-1", {
      action: "delete_user",
      confirm_username: "alice",
      password: "secret",
    }),
  );
});

it("confirms leaving an edited credential tab and clears its password and draft on return", async () => {
  mount("/team/settings?tab=computers&linux_user=binding-1&linux_user_view=credentials");
  const user=userEvent.setup();
  await user.type(await screen.findByLabelText("Git author name"),"Private draft");
  await user.type(screen.getByLabelText("Linux password"),"do-not-retain");
  await user.click(screen.getByRole("link",{name:"Overview"}));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:en.linux_user.cancel}));
  expect(screen.getByLabelText("Linux password")).toHaveValue("do-not-retain");
  await user.click(screen.getByRole("link",{name:"Overview"}));
  await user.click(screen.getByRole("button",{name:en.linux_user.confirm}));
  expect(screen.queryByLabelText("Linux password")).not.toBeInTheDocument();
  await user.click(screen.getByRole("link",{name:"Account credentials"}));
  expect(screen.getByLabelText("Linux password")).toHaveValue("");
  expect(screen.getByLabelText("Git author name")).toHaveValue("");
  expect(api.getComputerSettings).not.toHaveBeenCalled();
});

it("keeps installing unavailable while another remote operation is running and links its progress",async()=>{
  api.listComputerOperations.mockResolvedValue([{id:"op",kind:"upgrade",state:"running",step:"running",created_at:"2026-09-26T00:00:00Z"}]);
  api.listComputerBindingRuntimes.mockResolvedValue([{id:"codex",display_name:"Codex",can_install:true,installed_version:"",supports_version:true}]);
  mount("/team/settings?tab=computers&linux_user=binding-1&linux_user_view=runtimes");
  expect(await screen.findByRole("button",{name:"Install"})).toBeDisabled();
  expect(screen.getByRole("link",{name:/In progress/})).toHaveAttribute("href",expect.stringContaining("linux_user_view=operations"));
});
