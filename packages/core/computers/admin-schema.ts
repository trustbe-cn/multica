import { z } from "zod";
import { ComputerSchema, ComputerBindingSchema } from "./schema";
export const InstanceAccessSchema = z.object({ admin: z.boolean() });
export const AdminComputerSchema = ComputerSchema.extend({
  enabled: z.boolean(),
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
