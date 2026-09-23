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
