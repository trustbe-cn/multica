import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import en from "../../locales/en/settings.json";
import { ComputersTab } from "./computers-tab";

const api = vi.hoisted(() => ({
  getComputerSettings: vi.fn(),
  listComputers: vi.fn(),
  listComputerBindings: vi.fn(),
  saveComputerSettings: vi.fn(),
  registerComputer: vi.fn(),
  operateComputer: vi.fn(),
  listComputerBindingRuntimes: vi.fn(),
  installComputerBindingRuntime: vi.fn(),
  getComputerBindingDetail: vi.fn(), listComputerOperations: vi.fn(), discoverComputerBinding: vi.fn(), computerBindingLifecycle: vi.fn(), recoverComputerOperation: vi.fn(),
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
vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "workspace-1", name: "Team" }),
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
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <I18nProvider locale="en" resources={{ en: { settings: en } }}>
      <QueryClientProvider client={client}>
        <ComputersTab />
      </QueryClientProvider>
    </I18nProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getComputerSettings.mockResolvedValue({ operator: false, settings });
  api.listComputers.mockResolvedValue([]);
  api.listComputerBindings.mockResolvedValue([]);
  api.saveComputerSettings.mockResolvedValue(undefined);
  api.listComputerBindingRuntimes.mockResolvedValue([]);
  api.installComputerBindingRuntime.mockResolvedValue({operation_id:"operation-1",state:"queued"});
  api.listComputerOperations.mockResolvedValue([]);
  api.getComputerBindingDetail.mockResolvedValue({id:"binding-1",computer_id:"machine-1",computer_name:"Dev server",workspace_id:"workspace-1",workspace_name:"Team",username:"alice",state:"ready",account_state:"present",daemon_state:"stopped",daemon_id:"binding-1",last_error:"",checked_at:null,last_seen_at:null,archived_at:null});
});
describe("Computers settings", () => {
  it("saves personal settings and does not expose operator controls or multiline secrets", async () => {
    mount();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Git author name");
    expect(
      screen.queryByRole("button", { name: "Register Computer" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Model API keys (KEY=value, one per line)"),
    ).toHaveValue("");
    await user.clear(name);
    await user.type(name, "Alice Human");
    await user.click(screen.getByRole("button", { name: "Save credentials" }));
    await waitFor(() =>
      expect(api.saveComputerSettings).toHaveBeenCalledWith({
        ...settings,
        git_name: "Alice Human",
      }),
    );
    expect(api.operateComputer).not.toHaveBeenCalled();
  });
  it("keeps machine registration out of personal settings even for operators", async () => {
    api.getComputerSettings.mockResolvedValue({operator:true,settings});
    mount();
    await screen.findByLabelText("Git author name");
    expect(screen.queryByRole("button",{name:"Register Computer"})).not.toBeInTheDocument();
  });
  it("surfaces settings errors without an editable empty replacement", async () => {
    api.getComputerSettings.mockRejectedValue(
      new Error("Settings unavailable"),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings unavailable",
    );
    expect(
      screen.queryByRole("button", { name: "Save credentials" }),
    ).not.toBeInTheDocument();
  });
});

it("installs a CLI runtime through the owner's ready binding", async () => {
  api.listComputerBindings.mockResolvedValue([{ id: "binding-1", computer_id: "machine-1", workspace_id: "workspace-1", username: "alice", state: "ready", last_error: "" }]);
  api.listComputers.mockResolvedValue([{ id: "machine-1", name: "Dev server", enabled: true }]);
  api.listComputerBindingRuntimes.mockResolvedValue([{ id: "codex", display_name: "Codex", installed_version: "", can_install: true, version_required: true, probe_error: "" }]);
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Linux User details" }));
  expect(await screen.findByText("Codex")).toBeInTheDocument();
  expect(api.listComputerBindingRuntimes).toHaveBeenCalledWith("binding-1", expect.anything());
  await user.type(screen.getByRole("textbox", { name: "Codex version" }), "1.2.3");
  await user.click(screen.getByRole("button", { name: "Install" }));
  await waitFor(() => expect(api.installComputerBindingRuntime).toHaveBeenCalledWith("binding-1", "codex", "1.2.3"));
});

it("shows separate Linux User rows for different usernames on the same Computer", async () => {
  api.listComputerBindings.mockResolvedValue([
    { id: "binding-1", computer_id: "machine-1", workspace_id: "workspace-1", username: "alice-dev", state: "ready", last_error: "" },
    { id: "binding-2", computer_id: "machine-1", workspace_id: "workspace-2", username: "alice-build", state: "removed", last_error: "" },
  ]);
  api.listComputers.mockResolvedValue([{ id: "machine-1", name: "Dev server", enabled: true }]);
  mount();
  expect(await screen.findByText(/Dev server · alice-dev/)).toBeInTheDocument();
  expect(screen.getByText(/Dev server · alice-build/)).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Linux User details" })).toHaveLength(2);
});

it("does not offer runtime installation for removed bindings", async () => {
  api.listComputerBindings.mockResolvedValue([{ id: "binding-1", computer_id: "machine-1", workspace_id: "workspace-1", username: "alice", state: "removed", last_error: "" }]);
  api.listComputers.mockResolvedValue([{ id: "machine-1", name: "Dev server", enabled: true }]);
  mount();
  expect(await screen.findByText(/Dev server.*alice/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Runtimes" })).not.toBeInTheDocument();
  expect(api.listComputerBindingRuntimes).not.toHaveBeenCalled();
});

it("shows account and daemon status separately and tracks an install after reopening details", async () => {
  api.listComputerBindings.mockResolvedValue([{id:"binding-1",computer_id:"machine-1",workspace_id:"workspace-1",username:"alice",state:"ready",last_error:""}]);
  api.listComputerOperations.mockResolvedValue([{id:"op-1",binding_id:"binding-1",kind:"runtime_install",runtime_id:"codex",state:"running",step:"installing_runtime",requested_version:"latest",actual_version:"",error_code:"",error_summary:"",created_at:"2026-09-25T01:00:00Z",finished_at:null}]);
  api.listComputerBindingRuntimes.mockResolvedValue([{id:"codex",display_name:"Codex",installed_version:"",can_install:true,version_required:true,probe_state:"unknown",probe_error:""}]);
  mount();const user=userEvent.setup();
  await user.click(await screen.findByRole("button",{name:"Linux User details"}));
  expect(await screen.findByText("Present")).toBeInTheDocument();
  expect(screen.getByText(/Stopped · binding-1/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Install"})).toBeDisabled();
  await user.click(screen.getByRole("button",{name:"Linux User details"}));
  await user.click(screen.getByRole("button",{name:"Linux User details"}));
  expect(await screen.findByText(/Requested: latest/)).toBeInTheDocument();
  expect(api.installComputerBindingRuntime).not.toHaveBeenCalled();
});

it("requires typed confirmation before deleting a removed Linux account", async () => {
  api.listComputerBindings.mockResolvedValue([{id:"binding-1",computer_id:"machine-1",workspace_id:"",username:"alice",state:"removed",last_error:""}]);
  api.getComputerBindingDetail.mockResolvedValue({id:"binding-1",computer_id:"machine-1",computer_name:"Dev server",workspace_id:"",workspace_name:"",username:"alice",state:"removed",account_state:"present",daemon_state:"stopped",daemon_id:"binding-1",last_error:"",checked_at:null,last_seen_at:null,archived_at:null});
  api.computerBindingLifecycle.mockResolvedValue({operation_id:"delete-1",state:"queued"});
  mount();const user=userEvent.setup();
  await user.click(await screen.findByRole("button",{name:"Linux User details"}));
  await user.click(await screen.findByRole("button",{name:"Delete Linux user"}));
  expect(screen.getByText(/Permanently delete this Linux account/)).toBeInTheDocument();
  const confirm=screen.getByRole("button",{name:"Confirm action"});expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText("Type alice to confirm"),"alice");
  await user.type(screen.getByLabelText("Linux password for alice"),"test-password");
  await user.click(confirm);
  await waitFor(()=>expect(api.computerBindingLifecycle).toHaveBeenCalledWith("binding-1",{action:"delete_user",confirm_username:"alice",password:"test-password"}));
});
