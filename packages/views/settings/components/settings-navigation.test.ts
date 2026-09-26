// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveSettingsLocation, settingsHref } from "./settings-navigation";

describe("settings location", () => {
  it.each([
    ["issue", "preferences", "issue", null],
    ["chat", "preferences", "chat", null],
    ["github", "integrations", null, "github"],
    ["lark", "integrations", null, "lark"],
    ["labs", "workspace", null, null],
  ])("resolves the retired %s entry", (old, tab, section, integration) => {
    expect(resolveSettingsLocation(new URLSearchParams({ tab: old! }))).toEqual(
      { tab, section, integration },
    );
  });

  it("preserves unrelated query state while replacing page-specific state", () => {
    expect(
      settingsHref(
        "/acme/settings",
        new URLSearchParams("tab=preferences&section=chat&keep=1"),
        "integrations",
        { integration: "slack" },
      ),
    ).toBe("/acme/settings?tab=integrations&keep=1&integration=slack");
  });
});

import { linuxUserHref, resolveLinuxUserLocation } from "./settings-navigation";

it("clears account context on leaving the module without stripping callbacks", () => {
  const params = new URLSearchParams(
    "tab=computers&linux_user=b&linux_user_view=operations&operation=o&linux_user_from=workspace&linux_user_search=alice&code=callback",
  );
  expect(settingsHref("/acme/settings", params, "profile")).toBe(
    "/acme/settings?tab=profile&code=callback",
  );
  expect(linuxUserHref("/acme/settings", params)).toBe(
    "/acme/settings?tab=computers&code=callback&linux_user_search=alice",
  );
});
it("preserves explicit workspace origin and removes stale operation on tab switch", () => {
  const params = new URLSearchParams(
    "tab=computers&linux_user=b&linux_user_view=operations&operation=o",
  );
  const href = linuxUserHref("/acme/settings", params, {
    id: "b",
    view: "credentials",
    fromWorkspace: true,
  });
  expect(
    resolveLinuxUserLocation(new URLSearchParams(href.split("?")[1])),
  ).toMatchObject({
    id: "b",
    view: "credentials",
    fromWorkspace: true,
    operation: null,
  });
});
it("ignores orphaned and unknown account parameters", () => {
  expect(
    resolveLinuxUserLocation(
      new URLSearchParams(
        "tab=profile&linux_user=b&linux_user_view=credentials",
      ),
    ),
  ).toMatchObject({ id: null, view: "overview" });
  expect(
    resolveLinuxUserLocation(
      new URLSearchParams(
        "tab=computers&linux_user=b&linux_user_view=unknown&linux_user_from=https://evil.test",
      ),
    ),
  ).toMatchObject({ id: "b", view: "overview", fromWorkspace: false });
});
