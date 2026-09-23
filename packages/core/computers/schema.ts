import { z } from "zod";
import { parseWithFallback } from "../api/schema";

export const ComputerSettingsSchema = z.object({
  git_name: z.string(),
  git_email: z.string(),
  gitlab_url: z.string(),
  gitlab_token: z.string(),
  git_ssh_key: z.string().default(""),
  git_known_hosts: z.string().default(""),
  model_env: z.string(),
  multica_pat: z.string(),
});
export type ComputerSettings = z.infer<typeof ComputerSettingsSchema>;
export const PersonalComputerSettingsSchema = z.object({
  operator: z.boolean(),
  settings: ComputerSettingsSchema,
});
export const ComputerSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  ssh_user: z.string(),
});
export type Computer = z.infer<typeof ComputerSchema>;
export const ComputerBindingSchema = z.object({
  id: z.string(),
  computer_id: z.string(),
  workspace_id: z.string(),
  username: z.string(),
  state: z.string(),
  last_error: z.string(),
});
export type ComputerBinding = z.infer<typeof ComputerBindingSchema>;
export type ComputerOperation = {
  computer_id: string;
  workspace_id: string;
  username: string;
  password: string;
  action: "provision" | "sync" | "upgrade" | "remove";
};

// Never send credential-bearing malformed responses to the schema logger.
// A malformed secret response must not become an empty form that overwrites it.
export function parseComputerSettings(data: unknown) {
  const result = PersonalComputerSettingsSchema.safeParse(data);
  if (!result.success) {
    parseWithFallback(null, PersonalComputerSettingsSchema, null, {
      endpoint: "/api/me/computer-settings (redacted)",
    });
    throw new Error("Could not read personal Computer settings");
  }
  return parseWithFallback(
    result.data,
    PersonalComputerSettingsSchema,
    result.data,
    { endpoint: "/api/me/computer-settings" },
  );
}
