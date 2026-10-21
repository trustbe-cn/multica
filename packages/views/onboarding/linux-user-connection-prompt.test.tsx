import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import { useLinuxUserConnectionStore } from "@multica/core/onboarding";
import enCommon from "../locales/en/common.json";
import enSettings from "../locales/en/settings.json";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { LinuxUserConnectionPrompt } from "./linux-user-connection-prompt";

const mockUser = { id: "user-1" };

vi.mock("@multica/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector?: (state: { user: typeof mockUser }) => unknown) => {
      const state = { user: mockUser };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ user: mockUser }) },
  ),
  registerAuthStore: vi.fn(),
  createAuthStore: vi.fn(),
}));

vi.mock("@multica/core/paths", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/paths")>(
    "@multica/core/paths",
  );
  return {
    ...actual,
    useCurrentWorkspace: () => ({ id: "ws-1", slug: "test-ws", name: "Test WS" }),
  };
});

const mockPush = vi.fn();
const navigationAdapter: NavigationAdapter = {
  push: (path: string) => mockPush(path),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/test",
  searchParams: new URLSearchParams(),
  hash: "",
  getShareableUrl: (path: string) => `https://test.local${path}`,
};

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider
      locale="en"
      resources={{ en: { common: enCommon, settings: enSettings } }}
    >
      <NavigationProvider value={navigationAdapter}>{children}</NavigationProvider>
    </I18nProvider>
  );
}

function renderPrompt() {
  return render(<LinuxUserConnectionPrompt />, { wrapper: TestProviders });
}

beforeEach(() => {
  mockPush.mockReset();
  useLinuxUserConnectionStore.getState().dismiss();
});

describe("LinuxUserConnectionPrompt", () => {
  it("offers the new workspace connection once, with settings available later", () => {
    useLinuxUserConnectionStore
      .getState()
      .setOffer({ userId: "user-1", workspaceId: "ws-1" });
    renderPrompt();
    expect(
      screen.getByRole("dialog", { name: "Connect a Linux User?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    expect(mockPush).toHaveBeenCalledWith("/test-ws/settings?tab=linux-users");
    expect(useLinuxUserConnectionStore.getState().offer).toBeNull();
  });

  it("renders nothing without an offer", () => {
    const { container } = renderPrompt();
    expect(container.firstChild).toBeNull();
  });

  it("ignores an offer for another workspace", () => {
    useLinuxUserConnectionStore
      .getState()
      .setOffer({ userId: "user-1", workspaceId: "ws-2" });
    const { container } = renderPrompt();
    expect(container.firstChild).toBeNull();
  });

  it("ignores an offer left by another user", () => {
    useLinuxUserConnectionStore
      .getState()
      .setOffer({ userId: "user-2", workspaceId: "ws-1" });
    const { container } = renderPrompt();
    expect(container.firstChild).toBeNull();
  });
});
