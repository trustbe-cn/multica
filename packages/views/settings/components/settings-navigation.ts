/** Resolve bookmarks for settings pages that now live inside another page. */
export function resolveSettingsLocation(params: URLSearchParams) {
  const tab = params.get("tab") ?? "profile";
  if (tab === "issue" || tab === "chat") {
    return { tab: "preferences", section: tab, integration: null };
  }
  if (tab === "github" || tab === "lark") {
    return { tab: "integrations", section: null, integration: tab };
  }
  return {
    tab: tab === "labs" ? "workspace" : tab,
    section: params.get("section"),
    integration: params.get("integration"),
  };
}

/** Clear page-specific state while preserving unrelated callback parameters. */
export function settingsHref(
  pathname: string,
  searchParams: URLSearchParams,
  tab: string,
  detail: { section?: string; integration?: string } = {},
) {
  const params = new URLSearchParams(searchParams);
  params.set("tab", tab);
  params.delete("section");
  params.delete("integration");
  for (const key of linuxUserParams) params.delete(key);
  if (detail.section) params.set("section", detail.section);
  if (detail.integration) params.set("integration", detail.integration);
  return `${pathname}?${params.toString()}`;
}

const linuxUserParams = [
  "linux_user",
  "linux_user_view",
  "operation",
  "linux_user_from",
  "linux_user_search",
];
export const linuxUserViews = [
  "overview",
  "runtimes",
  "credentials",
  "operations",
] as const;
export type LinuxUserView = (typeof linuxUserViews)[number];

export function resolveLinuxUserLocation(params: URLSearchParams) {
  const id =
    params.get("tab") === "computers" ? params.get("linux_user") : null;
  const rawView = params.get("linux_user_view");
  const view =
    id && linuxUserViews.some((value) => value === rawView)
      ? (rawView as LinuxUserView)
      : "overview";
  return {
    id,
    view,
    operation: id && view === "operations" ? params.get("operation") : null,
    fromWorkspace: !!id && params.get("linux_user_from") === "workspace",
    search:
      params.get("tab") === "computers"
        ? (params.get("linux_user_search") ?? "")
        : "",
  };
}

export function linuxUserHref(
  pathname: string,
  params: URLSearchParams,
  detail: {
    id?: string;
    view?: LinuxUserView;
    operation?: string;
    fromWorkspace?: boolean;
    search?: string;
  } = {},
) {
  const next = new URLSearchParams(
    settingsHref(pathname, params, "computers").split("?")[1],
  );
  const search = detail.search ?? params.get("linux_user_search");
  if (search) next.set("linux_user_search", search);
  if (detail.id) {
    next.set("linux_user", detail.id);
    next.set("linux_user_view", detail.view ?? "overview");
    if (detail.fromWorkspace) next.set("linux_user_from", "workspace");
    if (detail.view === "operations" && detail.operation)
      next.set("operation", detail.operation);
  }
  return `${pathname}?${next.toString()}`;
}
