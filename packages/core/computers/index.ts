import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ComputerOperation, ComputerSettings } from "./schema";
export type {
  Computer,
  ComputerBinding,
  ComputerSettings,
  ComputerOperation,
} from "./schema";

export function useComputers(userId: string) {
  const client = useQueryClient();
  const key = ["computers", userId];
  const settings = useQuery({
    enabled: !!userId,
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
      q.state.data?.some((b) => b.state === "running") ? 2000 : false,
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

export {useInstanceAccess,useComputerAdmin,useComputerBindingRuntimes,useComputerBindingRuntimeInstall} from "./admin";
export type {AdminComputer,ProbeResult,ProbeCheck,AdminComputerRuntime} from "./admin-schema";
