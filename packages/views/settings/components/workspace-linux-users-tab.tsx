"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@multica/core/auth";
import { clientErrorMessage, errorCode } from "@multica/core/api";
import {
  bindingEligibility,
  bindingSummary,
  useComputers,
  type ComputerBinding,
} from "@multica/core/computers";
import { useCurrentWorkspace } from "@multica/core/paths";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { AppLink, useNavigation } from "../../navigation";
import { LinuxPasswordInput } from "../../computers/linux-password-input";
import { LinuxUserOperationForm } from "../../computers/linux-user-operation-form";
import { useT } from "../../i18n";
import { SettingsTab } from "./settings-layout";
import { linuxUserHref } from "./settings-navigation";

export function WorkspaceLinuxUsersTab() {
  const workspace = useCurrentWorkspace();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  return workspace ? (
    <WorkspaceAccounts
      key={`${userId}:${workspace.id}`}
      userId={userId}
      workspaceId={workspace.id}
    />
  ) : null;
}

function WorkspaceAccounts({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId: string;
}) {
  const { t } = useT("settings");
  const navigation = useNavigation();
  const data = useComputers(userId);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const connected =
    data.bindings.data?.filter(
      (b) =>
        b.workspace_id === workspaceId &&
        !["removed", "detached"].includes(b.state),
    ) ?? [];
  const machineName = (id: string) =>
    data.machines.data?.find((m) => m.id === id)?.name ??
    t(($) => $.linux_user.unknown);
  const href = (b: ComputerBinding) =>
    linuxUserHref(navigation.pathname, navigation.searchParams, {
      id: b.id,
      fromWorkspace: true,
    });
  const states = t(($) => $.linux_user_pages.states, { returnObjects: true });
  return (
    <SettingsTab
      title={
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span>{t(($) => $.workspace_linux_users.connected)}</span>
          <Dialog
            open={open}
            onOpenChange={(value) => {
              if (!submitting) setOpen(value);
            }}
          >
            <DialogTrigger render={<Button />}>
              {t(($) => $.workspace_linux_users.connect)}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $.workspace_linux_users.connect)}
                </DialogTitle>
              </DialogHeader>
              {open && (
                <ConnectionForm
                  busy={submitting}
                  onBusyChange={setSubmitting}
                  userId={userId}
                  workspaceId={workspaceId}
                  onAccepted={(b) => {
                    setOpen(false);
                    navigation.push(
                      linuxUserHref(
                        navigation.pathname,
                        navigation.searchParams,
                        { id: b.id, view: "operations", fromWorkspace: true },
                      ),
                    );
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </span>
      }
    >
      {data.bindings.error && <p role="alert">{data.bindings.error.message}</p>}
      {data.bindings.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {!connected.length && !data.bindings.isPending && (
        <p>{t(($) => $.workspace_linux_users.none_connected)}</p>
      )}
      <ul className="space-y-3">
        {connected.map((b) => (
          <li
            key={b.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">
                {machineName(b.computer_id)} · {b.username}
              </p>
              <p className="text-caption text-muted-foreground">
                {states[bindingSummary(b) as keyof typeof states] ??
                  t(($) => $.linux_user.unknown)}
              </p>
            </div>
            <AppLink href={href(b)} className="underline">
              {t(($) => $.linux_user.details)}
            </AppLink>
          </li>
        ))}
      </ul>
    </SettingsTab>
  );
}

function ConnectionForm({
  userId,
  workspaceId,
  onAccepted,
  onBusyChange,
  busy = false,
}: {
  userId: string;
  workspaceId: string;
  onAccepted: (b: ComputerBinding) => void;
  onBusyChange: (busy: boolean) => void;
  busy?: boolean;
}) {
  const { t } = useT("settings");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label={t(($) => $.workspace_linux_users.mode)}
        className="flex flex-wrap gap-2"
      >
        {(["existing", "new"] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? "secondary" : "outline"}
            aria-pressed={mode === value}
            disabled={busy}
            onClick={() => setMode(value)}
          >
            {t(($) => $.workspace_linux_users[value])}
          </Button>
        ))}
      </div>
      {mode === "new" ? (
        <LinuxUserOperationForm
          userId={userId}
          workspaceId={workspaceId}
          onAccepted={onAccepted}
          onBusyChange={onBusyChange}
        />
      ) : (
        <ExistingConnectionForm
          userId={userId}
          workspaceId={workspaceId}
          onAccepted={onAccepted}
          onBusyChange={onBusyChange}
        />
      )}
    </div>
  );
}

function ExistingConnectionForm({
  userId,
  workspaceId,
  onAccepted,
  onBusyChange,
}: {
  userId: string;
  workspaceId: string;
  onAccepted: (b: ComputerBinding) => void;
  onBusyChange: (busy: boolean) => void;
  busy?: boolean;
}) {
  const { t } = useT("settings");
  const navigation = useNavigation();
  const data = useComputers(userId);
  useEffect(() => {
    onBusyChange(data.operate.isPending);
  }, [data.operate.isPending, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const existing = data.bindings.data?.filter((b) => b.verified) ?? [];
  const machines = data.machines.data ?? [];
  const eligibility = (b: ComputerBinding) =>
    bindingEligibility(
      b,
      workspaceId,
      machines.find((m) => m.id === b.computer_id),
    );
  const selected = existing.find(
    (b) => b.id === id && eligibility(b) === "available",
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!selected || !password || data.operate.isPending) return;
        setError("");
        try {
          const binding = await data.operate.mutateAsync({
            computer_id: selected.computer_id,
            username: selected.username,
            workspace_id: workspaceId,
            password,
            action: "create_account",
          });
          onAccepted(binding);
        } catch (err) {
          const code = errorCode(err);
          const messages = t(($) => $.workspace_linux_users.errors, {
            returnObjects: true,
          });
          setError(
            code && Object.hasOwn(messages, code)
              ? messages[code as keyof typeof messages]
              : (clientErrorMessage(err) ?? t(($) => $.computers.failed)),
          );
        } finally {
          setPassword("");
          data.operate.reset();
        }
      }}
    >
      {data.bindings.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {(data.bindings.error || data.machines.error) && (
        <p role="alert">
          {data.bindings.error?.message || data.machines.error?.message}
        </p>
      )}
      {!existing.length && !data.bindings.isPending && (
        <p>{t(($) => $.workspace_linux_users.none_existing)}</p>
      )}
      <fieldset className="space-y-2">
        <legend>{t(($) => $.workspace_linux_users.choose_existing)}</legend>
        {existing.map((b) => {
          const status = eligibility(b);
          return (
            <div key={b.id} className="space-y-1 rounded border p-3">
              <label className="flex gap-2">
                <input
                  type="radio"
                  name="binding"
                  value={b.id}
                  disabled={status !== "available" || data.operate.isPending}
                  checked={id === b.id}
                  onChange={() => {
                    setId(b.id);
                    setPassword("");
                  }}
                />
                <span>
                  {machines.find((m) => m.id === b.computer_id)?.name ??
                    t(($) => $.linux_user.unknown)}{" "}
                  · {b.username}
                </span>
              </label>
              <p className="text-caption text-muted-foreground">
                {t(($) => $.workspace_linux_users.eligibility[status])}
              </p>
              {(status === "other_workspace" ||
                status === "recovery_required") && (
                <AppLink
                  className="text-caption underline"
                  href={linuxUserHref(
                    navigation.pathname,
                    navigation.searchParams,
                    {
                      id: b.id,
                      view:
                        status === "recovery_required"
                          ? "operations"
                          : "overview",
                      fromWorkspace: true,
                    },
                  )}
                >
                  {t(($) => $.linux_user.details)}
                </AppLink>
              )}
            </div>
          );
        })}
      </fieldset>
      <LinuxPasswordInput
        autoComplete="off"
        required
        disabled={data.operate.isPending}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {(!selected || !password) && (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.workspace_linux_users.required_fields)}
        </p>
      )}
      <Button
        type="submit"
        disabled={!selected || !password || data.operate.isPending}
      >
        {t(($) => $.workspace_linux_users.connect_action)}
      </Button>
    </form>
  );
}
