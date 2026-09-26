"use client";

import { useState, type FormEvent } from "react";
import { useAuthStore } from "@multica/core/auth";
import { clientErrorMessage, errorCode } from "@multica/core/api";
import {
  bindingEligibility,
  useComputers,
  type BindingEligibility,
} from "@multica/core/computers";
import { paths, useCurrentWorkspace } from "@multica/core/paths";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { SettingsSection, SettingsTab } from "./settings-layout";

export function WorkspaceLinuxUsersTab() {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const data = useComputers(userId);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState("");
  const [computerId, setComputerId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const [accepted, setAccepted] = useState(false);
  if (!workspace) return null;
  const workspaceId = workspace.id;

  const machines = data.machines.data ?? [];
  const bindings = data.bindings.data ?? [];
  const machineName = (id: string) =>
    machines.find((m) => m.id === id)?.name ?? id;
  const eligibility = (
    binding: (typeof bindings)[number],
  ): BindingEligibility =>
    bindingEligibility(
      binding,
      workspaceId,
      machines.find((m) => m.id === binding.computer_id),
    );
  const existing = bindings.filter((b) => b.verified);
  const connected = bindings.filter(
    (b) =>
      b.workspace_id === workspaceId &&
      b.state !== "removed" &&
      b.state !== "detached",
  );
  const selected = existing.find((b) => b.id === selectedId);
  const target =
    mode === "existing" && selected && eligibility(selected) === "available"
      ? { computer_id: selected.computer_id, username: selected.username }
      : mode === "new" && machines.some((m) => m.id === computerId && m.enabled)
        ? { computer_id: computerId, username: username.trim() }
        : null;
  const personalHref = `${paths.workspace(workspace.slug).settings()}?tab=computers`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || !target.username || !password || data.operate.isPending)
      return;
    setError("");
    setRecoveryError(false);
    setAccepted(false);
    try {
      await data.operate.mutateAsync({
        ...target,
        workspace_id: workspaceId,
        password,
        action: "create_account",
      });
      setPassword("");
      setAccepted(true);
    } catch (err) {
      const code = errorCode(err);
      setRecoveryError(code === "operation_recovery_required");
      const known =
        code === "username_unavailable" ||
        code === "operation_busy" ||
        code === "binding_workspace_conflict" ||
        code === "binding_conflict" ||
        code === "operation_recovery_required";
      setError(
        known
          ? t(($) => $.workspace_linux_users.errors[code])
          : (clientErrorMessage(err) ??
              t(($) => $.workspace_linux_users.errors.generic)),
      );
    }
  }

  return (
    <SettingsTab title={t(($) => $.workspace_linux_users.title)}>
      <SettingsSection title={t(($) => $.workspace_linux_users.connected)}>
        {data.bindings.isPending ? (
          <p role="status">{t(($) => $.computers.loading)}</p>
        ) : null}
        {connected.length === 0 && !data.bindings.isPending ? (
          <p className="text-muted-foreground">
            {t(($) => $.workspace_linux_users.none_connected)}
          </p>
        ) : null}
        <ul className="space-y-2">
          {connected.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2"
            >
              <span>
                {machineName(b.computer_id)} · {b.username}
                {b.last_error && (
                  <span className="block text-sm text-destructive">
                    {b.last_error}
                  </span>
                )}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(
                  ($) =>
                    $.linux_user.states[
                      b.state as keyof typeof $.linux_user.states
                    ] ?? $.linux_user.unknown,
                )}
              </span>
              {(b.state === "interrupted" || b.state === "pending") && (
                <AppLink href={personalHref} className="text-sm underline">
                  {t(($) => $.workspace_linux_users.open_personal)}
                </AppLink>
              )}
              {!b.verified && b.state === "failed" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMode("new");
                    setComputerId(b.computer_id);
                    setUsername(b.username);
                    setAccepted(false);
                    setError("");
                    setRecoveryError(false);
                  }}
                >
                  {t(($) => $.workspace_linux_users.retry_new)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>
      <SettingsSection title={t(($) => $.workspace_linux_users.connect)}>
        {(data.machines.error || data.bindings.error) && (
          <p role="alert" className="text-destructive">
            {data.machines.error?.message || data.bindings.error?.message}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t(($) => $.workspace_linux_users.account_help)}
        </p>
        {machines.filter((m) => m.enabled).length === 0 &&
          !data.machines.isPending && (
            <p>{t(($) => $.workspace_linux_users.no_computers)}</p>
          )}
        <div
          className="flex gap-2"
          role="group"
          aria-label={t(($) => $.workspace_linux_users.mode)}
        >
          <Button
            type="button"
            variant={mode === "existing" ? "secondary" : "outline"}
            aria-pressed={mode === "existing"}
            onClick={() => {
              setMode("existing");
              setAccepted(false);
              setError("");
              setRecoveryError(false);
            }}
          >
            {t(($) => $.workspace_linux_users.existing)}
          </Button>
          <Button
            type="button"
            variant={mode === "new" ? "secondary" : "outline"}
            aria-pressed={mode === "new"}
            onClick={() => {
              setMode("new");
              setAccepted(false);
              setError("");
              setRecoveryError(false);
            }}
          >
            {t(($) => $.workspace_linux_users.new)}
          </Button>
        </div>
        <form
          onSubmit={(event) => void submit(event)}
          className="max-w-xl space-y-4"
        >
          {mode === "existing" ? (
            existing.length ? (
              <fieldset className="space-y-2">
                <legend className="font-medium">
                  {t(($) => $.workspace_linux_users.choose_existing)}
                </legend>
                {existing.map((b) => {
                  const status = eligibility(b);
                  return (
                    <div key={b.id} className="border-b py-2">
                      <label className="flex gap-3">
                        <input
                          type="radio"
                          name="linux-user"
                          value={b.id}
                          checked={selectedId === b.id}
                          disabled={status !== "available"}
                          onChange={() => setSelectedId(b.id)}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {machineName(b.computer_id)} · {b.username}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {t(
                              ($) =>
                                $.workspace_linux_users.eligibility[status],
                            )}
                          </span>
                        </span>
                      </label>
                      {(status === "other_workspace" ||
                        status === "recovery_required") && (
                        <AppLink
                          href={personalHref}
                          className="ml-6 text-sm underline"
                        >
                          {t(($) => $.workspace_linux_users.open_personal)}
                        </AppLink>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            ) : (
              <p className="text-muted-foreground">
                {t(($) => $.workspace_linux_users.none_existing)}
              </p>
            )
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t(($) => $.workspace_linux_users.new_account_help)}
              </p>
              <label className="block space-y-1">
                <span>{t(($) => $.computers.choose)}</span>
                <Select
                  items={machines
                    .filter((m) => m.enabled)
                    .map((m) => ({ value: m.id, label: m.name }))}
                  value={computerId}
                  onValueChange={(value) => setComputerId(value ?? "")}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t(($) => $.computers.choose)}
                  >
                    <SelectValue placeholder={t(($) => $.computers.choose)} />
                  </SelectTrigger>
                  <SelectContent>
                    {machines
                      .filter((m) => m.enabled)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-1">
                <span>{t(($) => $.computers.username)}</span>
                <Input
                  value={username}
                  required
                  pattern="[a-z_][a-z0-9_-]{0,31}"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
            </>
          )}
          <label className="block space-y-1">
            <span>{t(($) => $.computers.password)}</span>
            <Input
              type="password"
              autoComplete="off"
              value={password}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {recoveryError && (
            <AppLink href={personalHref} className="text-sm underline">
              {t(($) => $.workspace_linux_users.open_personal)}
            </AppLink>
          )}
          {accepted && (
            <p role="status">{t(($) => $.workspace_linux_users.accepted)}</p>
          )}
          {(!target || !target.username || !password) && (
            <p className="text-sm text-muted-foreground">
              {t(($) => $.workspace_linux_users.required_fields)}
            </p>
          )}
          <Button
            type="submit"
            disabled={
              !target || !target.username || !password || data.operate.isPending
            }
            aria-busy={data.operate.isPending}
          >
            {t(($) => $.workspace_linux_users.connect_action)}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">
          <AppLink href={personalHref} className="underline">
            {t(($) => $.workspace_linux_users.manage_personal)}
          </AppLink>
        </p>
      </SettingsSection>
    </SettingsTab>
  );
}
