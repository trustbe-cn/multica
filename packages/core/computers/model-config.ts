import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ModelConfigAction,
  ModelConfigInput,
  ModelTemplate,
} from "./model-config-schema";

export const modelConfigKeys = {
  admin: (userId: string) => ["model-configuration", userId, "admin"] as const,
  options: (userId: string, bindingId: string, kind: string) =>
    ["model-configuration", userId, bindingId, kind, "keys"] as const,
};
export interface ModelKeyFilters {
  search: string;
  runtime: string;
  platform: string;
  /** "" = all keys, "none" = unassigned, otherwise a user ID. */
  owner: string;
  /** "" = enabled only; "all" includes disabled keys. */
  status: string;
  page: number;
}
export function useModelKeyAdmin(
  userId: string,
  filters: ModelKeyFilters,
  userSearch: string,
) {
  const client = useQueryClient();
  const key = modelConfigKeys.admin(userId);
  const source = useQuery({
    queryKey: [...key, "source"],
    queryFn: () => api.getModelKeySource(),
    retry: false,
  });
  const directory = useQuery({
    queryKey: [...key, "directory", filters],
    queryFn: () => api.getModelKeyDirectory(filters),
    enabled: source.data?.configured === true,
    retry: false,
  });
  const users = useQuery({
    queryKey: [...key, "users", userSearch],
    queryFn: () => api.getModelKeyUsers(userSearch),
  });
  const invalidate = () => client.invalidateQueries({ queryKey: key });
  const saveSource = useMutation({
    gcTime: 0,
    mutationFn: (input: {
      baseURL: string;
      directoryToken: string;
      revision: number;
    }) => api.saveModelKeySource(input),
    onSuccess: invalidate,
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshModelKeyDirectory(),
    onSettled: invalidate,
  });
  const assign = useMutation({
    mutationFn: (input: {
      ids: string[];
      userId: string | null;
      allowTransfer: boolean;
    }) => api.assignModelKeys(input),
    // Every affected owner's runtime key options change, so refetch them all.
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["model-configuration"] }),
  });
  return { source, directory, users, saveSource, refresh, assign };
}
export function useModelTemplates(userId: string) {
  const client = useQueryClient();
  const key = [...modelConfigKeys.admin(userId), "templates"];
  const templates = useQuery({
    queryKey: key,
    queryFn: () => api.getModelTemplates(),
    retry: false,
  });
  const save = useMutation({
    gcTime: 0,
    mutationFn: (template: ModelTemplate) => api.saveModelTemplate(template),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return { templates, save };
}
export function useRuntimeModelConfig(
  userId: string,
  bindingId: string,
  kind: string,
) {
  const client = useQueryClient();
  const keys = useQuery({
    queryKey: modelConfigKeys.options(userId, bindingId, kind),
    queryFn: () => api.getRuntimeModelKeys(bindingId, kind),
    retry: false,
  });
  // Passwords and file bodies live only while the editor is mounted. Mutation
  // records are reset after each request so devtools do not retain snapshots.
  const action = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: ({
      action,
      input,
    }: {
      action: ModelConfigAction;
      input: ModelConfigInput;
    }) => api.runtimeModelConfig(bindingId, kind, action, input),
    onSettled: async (_result, _error, variables) => {
      if (variables.action === "save" || variables.action === "test")
        await client.invalidateQueries({ queryKey: ["computers", userId] });
    },
  });
  return { keys, action };
}
