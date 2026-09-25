import { z } from "zod";
import { ComputerSchema, ComputerBindingSchema } from "./schema";
export const InstanceAccessSchema = z.object({ admin: z.boolean() });
export const ProbeCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().optional(),
});
export const ProbeResultSchema = z.object({
  ok: z.boolean(),
  facts: z
    .object({
      hostname: z.string().optional(),
      os: z.string().optional(),
      kernel: z.string().optional(),
      cpus: z.number().optional(),
      memory_mb: z.number().optional(),
    })
    .default({}),
  checks: ProbeCheckSchema.array().default([]),
});
export type ProbeCheck = z.infer<typeof ProbeCheckSchema>;
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
export const AdminComputerSchema = ComputerSchema.extend({
  enabled: z.boolean(),
  created_by: z.string().optional(),
  created_by_name: z.string().optional(),
  created_at: z.string().optional(),
  checked_at: z.string().optional(),
  check_ok: z.boolean().optional(),
  check_detail: z.string().optional(),
  bindings: z.number().default(0),
});
export type AdminComputer = z.infer<typeof AdminComputerSchema>;
export const AdminBindingSchema = ComputerBindingSchema.extend({
  user_id: z.string(),
  user_name: z.string(),
});
export const ComputerAuditSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  computer_id: z.string(),
  binding_id: z.string(),
  action: z.string(),
  outcome: z.string(),
  created_at: z.string(),
});

export type AdminBinding = z.infer<typeof AdminBindingSchema>;
export type ComputerAudit = z.infer<typeof ComputerAuditSchema>;

export const AdminComputerRuntimeSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  installed_version: z.string(),
  can_install: z.boolean(),
  version_required: z.boolean().default(true),
  probe_error: z.string().default(""),
  probe_state: z.enum(["unknown", "missing", "installed", "version_failed", "check_failed"]).catch("unknown"),
  error_code: z.string().default(""), executable_path: z.string().default(""), install_dir: z.string().default(""),
  requested_version: z.string().default(""), actual_version: z.string().default(""), installer_source: z.string().default(""),
  installed_at: z.string().nullable().default(null), checked_at: z.string().nullable().default(null), probe_environment: z.string().default(""),
  registration_state: z.enum(["not_discovered", "online", "offline"]).catch("not_discovered"),
});
export type AdminComputerRuntime = z.infer<typeof AdminComputerRuntimeSchema>;

export const AdminSshPubKeySchema = z.object({ pubkey: z.string().trim().min(1) });
export const LinuxUserCheckSchema = z.object({ present: z.boolean() });
