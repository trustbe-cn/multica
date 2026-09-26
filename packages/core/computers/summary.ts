import type { ComputerBinding } from "./schema";

/** Account facts take precedence over an unrelated CLI operation's outcome. */
export function bindingSummary(binding: ComputerBinding): string {
  if (binding.operation_busy || binding.state === "running") return "running";
  if (
    binding.state === "interrupted" ||
    (binding.latest_operation?.state === "interrupted" &&
      !binding.latest_operation.finished_at)
  )
    return "interrupted";
  if (["missing", "unavailable"].includes(binding.account_state))
    return binding.account_state;
  if (!binding.verified) return "unverified";
  if (
    ["pending", "removed", "detached", "ready", "failed"].includes(
      binding.state,
    )
  )
    return binding.state;
  return "unknown";
}

export function bindingWorkspaceLabel(
  binding: Pick<
    ComputerBinding,
    "workspace_access" | "workspace_name" | "state"
  >,
) {
  if (binding.workspace_access === "accessible" && binding.workspace_name)
    return { name: binding.workspace_name, key: null };
  if (binding.workspace_access === "unavailable")
    return { name: null, key: "unavailable" as const };
  if (binding.workspace_access === "none")
    return {
      name: null,
      key:
        binding.state === "detached" ? ("deleted" as const) : ("none" as const),
    };
  return { name: null, key: "unknown" as const };
}
