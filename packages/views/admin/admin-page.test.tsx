import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@multica/ui/components/ui/dropdown-menu";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import en from "../locales/en/settings.json";
import { AdminPage, AdminAreaLink } from "./admin-page";

const api = vi.hoisted(() => ({
  getInstanceAccess: vi.fn(),
  listAdminComputers: vi.fn(),
  listAdminComputerBindings: vi.fn(),
  listComputerAudit: vi.fn(),
  registerComputer: vi.fn(),
  updateAdminComputer: vi.fn(),
}));
const state = vi.hoisted(() => ({
  user: { id: "admin-human" },
  isLoading: false,
}));
const replace = vi.hoisted(() => vi.fn());
vi.mock("@multica/core/api", () => ({ api }));
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock("../navigation", () => ({
  useNavigation: () => ({ replace }),
  AppLink: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("../platform", () => ({ DragStrip: () => null }));
function mount(link = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <I18nProvider locale="en" resources={{ en: { settings: en } }}>
      <QueryClientProvider client={client}>
        {link ? <DropdownMenu defaultOpen><DropdownMenuTrigger>Menu</DropdownMenuTrigger><DropdownMenuContent><AdminAreaLink /></DropdownMenuContent></DropdownMenu> : <AdminPage />}
      </QueryClientProvider>
    </I18nProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.getInstanceAccess.mockResolvedValue({ admin: false });
  api.listAdminComputers.mockResolvedValue([]);
  api.listAdminComputerBindings.mockResolvedValue([]);
  api.listComputerAudit.mockResolvedValue([]);
  api.registerComputer.mockResolvedValue(undefined);
  api.updateAdminComputer.mockResolvedValue(undefined);
});
describe("instance Admin Area", () => {
  it("denies non-admins before any registry or employee data is loaded", async () => {
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only instance administrators",
    );
    expect(api.listAdminComputers).not.toHaveBeenCalled();
    expect(api.listAdminComputerBindings).not.toHaveBeenCalled();
    expect(api.listComputerAudit).not.toHaveBeenCalled();
  });
  it("fails closed when access check errors", async () => {
    api.getInstanceAccess.mockRejectedValue(new Error("Access unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Access unavailable",
    );
    expect(api.listAdminComputers).not.toHaveBeenCalled();
  });
  it("registers and disables a Computer without any workspace context", async () => {
    api.getInstanceAccess.mockResolvedValue({ admin: true });
    api.listAdminComputers.mockResolvedValue([
      {
        id: "machine",
        name: "Dev server",
        host: "dev.invalid",
        port: 22,
        ssh_user: "operator",
        enabled: true,
      },
    ]);
    mount();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Register Computer" });
    await user.type(screen.getByLabelText("Name"), "New server");
    await user.type(screen.getByLabelText("SSH host"), "new.invalid");
    await user.type(screen.getByLabelText("SSH operator username"), "operator");
    await user.click(screen.getByRole("button", { name: "Register Computer" }));
    await waitFor(() =>
      expect(api.registerComputer).toHaveBeenCalledWith({
        name: "New server",
        host: "new.invalid",
        port: 22,
        ssh_user: "operator",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Disable" }),
    );
    await waitFor(() =>
      expect(api.updateAdminComputer).toHaveBeenCalledWith("machine", {
        enabled: false,
      }),
    );
  });
  it("only shows the standalone link to instance admins", async () => {
    api.getInstanceAccess.mockResolvedValue({ admin: true });
    mount(true);
    expect(
      await screen.findByRole("menuitem", { name: "Admin Area" }),
    ).toHaveAttribute("href", "/admin");
  });
});
