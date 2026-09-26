import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ComputerOperation, ComputerSettings } from "./schema";
export type {
  Computer,
  ComputerBinding,
  ComputerSettings,
  ComputerOperation,
} from "./schema";
export { bindingEligibility } from "./eligibility";
export type { BindingEligibility } from "./eligibility";

export function useComputers(userId: string, includeCredentials = false) {
  const client = useQueryClient();
  const key = ["computers", userId];
  const settings = useQuery({
    enabled: !!userId && includeCredentials,
    queryKey: [...key, "settings"],
    queryFn: () => api.getComputerSettings(),
    gcTime: 0,
    retry: false,
  });
  const machines = useQuery({
    enabled: !!userId,
    queryKey: [...key, "machines"],
    queryFn: () => api.listComputers(),
    retry: false,
  });
  const bindings = useQuery({
    enabled: !!userId,
    queryKey: [...key, "bindings"],
    queryFn: () => api.listComputerBindings(),
    refetchInterval: (q) =>
      q.state.data?.some((b) => b.state === "running" || b.operation_busy)
        ? 2000
        : false,
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const save = useMutation({
    gcTime: 0,
    mutationFn: (input: ComputerSettings) => api.saveComputerSettings(input),
    onSuccess: refresh,
  });
  const operate = useMutation({
    gcTime: 0,
    mutationFn: (input: ComputerOperation) => api.operateComputer(input),
    onSuccess: refresh,
  });
  return { settings, machines, bindings, save, operate };
}

export {
  useInstanceAccess,
  useComputerAdmin,
  useComputerBindingRuntimes,
  useComputerBindingRuntimeInstall,
} from "./admin";
export type {
  AdminComputer,
  ProbeResult,
  ProbeCheck,
  AdminComputerRuntime,
} from "./admin-schema";
export { useLinuxUserDetail } from "./detail";
export type { RemoteOperation, ComputerLifecycleInput } from "./schema";

export function useComputerCredentials(userId: string) {
  const client = useQueryClient();
  const read = useMutation({
    gcTime: 0,
    mutationFn: (input: { id: string; password: string }) =>
      api.readComputerCredentials(input.id, input.password),
  });
  const write = useMutation({
    gcTime: 0,
    mutationFn: (input: {
      id: string;
      password: string;
      settings: ComputerSettings;
    }) =>
      api.writeComputerCredentials(input.id, input.password, input.settings),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["computers", userId] }),
  });
  return { read, write };
}
