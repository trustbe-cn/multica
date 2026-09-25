import type { Computer, ComputerBinding } from "./schema";

export type BindingEligibility =
  | "available"
  | "current_workspace"
  | "busy"
  | "other_workspace"
  | "unverified"
  | "computer_unavailable"
  | "account_unavailable";

export function bindingEligibility(
  binding: ComputerBinding,
  workspaceId: string,
  computer: Computer | undefined,
): BindingEligibility {
  if (!binding.verified) return "unverified";
  if (binding.operation_busy || binding.state === "running") return "busy";
  if (!computer?.enabled) return "computer_unavailable";
  if (binding.account_state === "unavailable") return "account_unavailable";
  if (binding.workspace_id === workspaceId && binding.state === "ready") {
    return "current_workspace";
  }
  if (binding.workspace_id !== workspaceId &&
      binding.state !== "removed" && binding.state !== "detached") {
    return "other_workspace";
  }
  return "available";
}
