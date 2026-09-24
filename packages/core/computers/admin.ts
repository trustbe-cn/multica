import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Computer } from "./schema";
import type { AdminComputer, AdminComputerRuntime } from "./admin-schema";

export function useInstanceAccess(userId: string) {
  return useQuery({
    queryKey: ["instance-access", userId],
    enabled: !!userId,
    queryFn: () => api.getInstanceAccess(),
    retry: false,
    staleTime: 0,
  });
}
export function useComputerAdmin(userId: string, allowed: boolean) {
  const client = useQueryClient();
  const key = ["computer-admin", userId];
  const enabled = !!userId && allowed;
  const computers = useQuery({
    queryKey: [...key, "computers"],
    enabled,
    queryFn: () => api.listAdminComputers(),
    retry: false,
  });
  const bindings = useQuery({
    queryKey: [...key, "bindings"],
    enabled,
    queryFn: () => api.listAdminComputerBindings(),
    retry: false,
  });
  const audit = useQuery({
    queryKey: [...key, "audit"],
    enabled,
    queryFn: () => api.listComputerAudit(),
    retry: false,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ["computers"] }),
    ]);
  };
  const register = useMutation({
    mutationFn: (input: Omit<Computer, "id" | "enabled">) => api.registerComputer(input),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      ...input
    }: Partial<Omit<AdminComputer, "id">> & { id: string }) =>
      api.updateAdminComputer(id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAdminComputer(id),
    onSuccess: refresh,
  });
  // Checking a draft does not touch the registry, so it must not invalidate.
  const checkDraft = useMutation({
    mutationFn: (input: Omit<Computer, "id" | "enabled">) => api.checkAdminComputerDraft(input),
  });
  // Checking a registered Computer records the verdict, so the list refreshes.
  const check = useMutation({
    mutationFn: (id: string) => api.checkAdminComputer(id),
    onSuccess: refresh,
  });
  return { computers, bindings, audit, register, update, remove, check, checkDraft, refresh };
}

export function useAdminComputerRuntimes(userId: string, computerId: string, linuxUser: string) {
  const isInstalling = useIsMutating({ mutationKey: ["admin-runtime-install", userId, computerId] }) > 0;
  const enabled = !!userId && !!computerId && !!linuxUser;
  const runtimes = useQuery<AdminComputerRuntime[]>({
    queryKey: ["computer-admin", userId, "runtimes", computerId, linuxUser],
    enabled,
    queryFn: ({ signal }) => api.listAdminComputerRuntimes(computerId, linuxUser, signal),
    retry: false,
  });
  return { runtimes, isInstalling };
}

export function useAdminRuntimeInstall(userId: string, computerId: string, linuxUser: string, runtimeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["admin-runtime-install", userId, computerId, linuxUser, runtimeId],
    mutationFn: (version: string) =>
      api.installAdminComputerRuntime(computerId, runtimeId, version, linuxUser),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ["computer-admin", userId] });
    },
  });
}
