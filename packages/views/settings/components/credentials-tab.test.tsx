import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import en from "../../locales/en/settings.json";
import { CredentialsTab } from "./credentials-tab";

const api = vi.hoisted(() => ({
  getComputerSettings: vi.fn(),
  readComputerCredentials: vi.fn(),
  writeComputerCredentials: vi.fn(),
  listComputers: vi.fn(),
  listComputerBindings: vi.fn(),
  saveComputerSettings: vi.fn(),
  operateComputer: vi.fn(),
}));
vi.mock("@multica/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/api")>()),
  api,
}));
vi.mock("@multica/core/auth", () => {
  const state = { user: { id: "human-1", email: "alice@example.com" } };
  return {
    useAuthStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
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
        <CredentialsTab />
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
});

describe("Personal credentials", () => {
  it("saves the template without changing a remote account and hides secrets", async () => {
    mount();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Git author name");
    expect(
      screen.getByLabelText("Model API keys (KEY=value, one per line)"),
    ).toHaveValue("");
    expect(name).toHaveAccessibleDescription(/git config --global user.name/);
    await user.clear(name);
    await user.type(name, "Changed");
    await user.click(screen.getByRole("button", { name: "Save credentials" }));
    await waitFor(() =>
      expect(api.saveComputerSettings).toHaveBeenCalledWith({
        ...settings,
        git_name: "Changed",
      }),
    );
    expect(api.writeComputerCredentials).not.toHaveBeenCalled();
    expect(api.operateComputer).not.toHaveBeenCalled();
  });
  it("reads a selected account into a draft without saving or writing it", async () => {
    api.listComputers.mockResolvedValue([{ id: "machine-1", name: "Host" }]);
    api.listComputerBindings.mockResolvedValue([
      {
        id: "binding-1",
        computer_id: "machine-1",
        username: "alice",
        verified: true,
        state: "pending",
      },
    ]);
    api.readComputerCredentials.mockResolvedValue({
      operator: false,
      settings: { ...settings, git_name: "From server" },
    });
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Git author name");
    await user.click(screen.getByRole("combobox", { name: "Linux user" }));
    await user.click(
      await screen.findByRole("option", { name: "Host · alice" }),
    );
    await user.type(screen.getByLabelText("Linux password"), "secret");
    await user.click(screen.getByRole("button", { name: "Read from server" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Git author name")).toHaveValue(
        "From server",
      ),
    );
    expect(api.readComputerCredentials).toHaveBeenCalledWith(
      "binding-1",
      "secret",
    );
    expect(api.saveComputerSettings).not.toHaveBeenCalled();
    expect(api.writeComputerCredentials).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Linux password")).toHaveValue("");
    await user.click(
      screen.getByRole("checkbox", { name: /Save these remote credentials/ }),
    );
    await user.click(screen.getByRole("button", { name: "Save credentials" }));
    await waitFor(() =>
      expect(api.saveComputerSettings).toHaveBeenCalledWith({
        ...settings,
        git_name: "From server",
      }),
    );
  });
  it("writes the form to the selected account without saving the template", async () => {
    api.listComputers.mockResolvedValue([{ id: "machine-1", name: "Host" }]);
    api.listComputerBindings.mockResolvedValue([
      {
        id: "binding-1",
        computer_id: "machine-1",
        username: "alice",
        verified: true,
        state: "pending",
      },
    ]);
    api.writeComputerCredentials.mockResolvedValue(undefined);
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Git author name");
    await user.click(screen.getByRole("combobox", { name: "Linux user" }));
    await user.click(
      await screen.findByRole("option", { name: "Host · alice" }),
    );
    await user.type(screen.getByLabelText("Linux password"), "secret");
    await user.click(
      screen.getByRole("button", { name: "Write to Linux user" }),
    );
    await waitFor(() =>
      expect(api.writeComputerCredentials).toHaveBeenCalledWith(
        "binding-1",
        "secret",
        settings,
      ),
    );
    expect(api.saveComputerSettings).not.toHaveBeenCalled();
  });
  it("requires explicit template import and discards edited remote secrets when switching accounts", async () => {
    api.listComputers.mockResolvedValue([{ id: "machine-1", name: "Host" }]);
    api.listComputerBindings.mockResolvedValue(
      ["alice", "bob"].map((username) => ({
        id: username,
        computer_id: "machine-1",
        username,
        verified: true,
        state: "pending",
      })),
    );
    const remote = {
      ...settings,
      multica_pat: "mul_alice_private",
      gitlab_token: "alice-token",
      git_ssh_key: "alice-private-key",
      model_env: "OPENAI_API_KEY=alice-key",
    };
    api.readComputerCredentials.mockResolvedValue({
      operator: false,
      settings: remote,
    });
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Git author name");
    await user.click(screen.getByRole("combobox", { name: "Linux user" }));
    await user.click(
      await screen.findByRole("option", { name: "Host · alice" }),
    );
    await user.type(screen.getByLabelText("Linux password"), "secret");
    await user.click(screen.getByRole("button", { name: "Read from server" }));
    const confirm = await screen.findByRole("checkbox", {
      name: /Save these remote credentials/,
    });
    expect(
      screen.getByRole("button", { name: "Save credentials" }),
    ).toBeDisabled();
    expect(api.saveComputerSettings).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Git author name"), " edited");
    await user.click(confirm);
    expect(
      screen.getByRole("button", { name: "Save credentials" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("combobox", { name: "Linux user" }));
    await user.click(await screen.findByRole("option", { name: "Host · bob" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Linux password")).toHaveValue("");
    await user.type(screen.getByLabelText("Linux password"), "bob-password");
    await user.click(
      screen.getByRole("button", { name: "Write to Linux user" }),
    );
    await waitFor(() =>
      expect(api.writeComputerCredentials).toHaveBeenCalledWith(
        "bob",
        "bob-password",
        settings,
      ),
    );
    expect(api.saveComputerSettings).not.toHaveBeenCalled();
  });
  it("localizes password failures instead of displaying the server message", async () => {
    const { ApiError } = await import("@multica/core/api");
    api.listComputerBindings.mockResolvedValue([
      {
        id: "alice",
        computer_id: "host",
        username: "alice",
        verified: true,
        state: "pending",
      },
    ]);
    api.readComputerCredentials.mockRejectedValue(
      new ApiError("server message", 403, "Forbidden", {
        code: "password_mismatch",
      }),
    );
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Git author name");
    await user.click(screen.getByRole("combobox", { name: "Linux user" }));
    await user.click(
      await screen.findByRole("option", { name: "host · alice" }),
    );
    await user.type(screen.getByLabelText("Linux password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Read from server" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.linux_user.errors.password_mismatch,
    );
  });
  it("does not replace a failed credential response with an editable empty form", async () => {
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
