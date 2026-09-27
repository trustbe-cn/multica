"use client";

import { useState, type ReactNode } from "react";
import {
  useComputers,
  bindingSummary,
  bindingWorkspaceLabel,
  type ComputerBinding,
} from "@multica/core/computers";
import { useAuthStore } from "@multica/core/auth";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { AppLink, useNavigation } from "../../navigation";
import { SettingsTab } from "./settings-layout";
import { LinuxUserOperationForm } from "../../computers/linux-user-operation-form";
import { LinuxUserPage } from "../../computers/linux-user-page";
import { linuxUserHref, resolveLinuxUserLocation } from "./settings-navigation";
import { useT } from "../../i18n";

export function ComputersTab() {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const navigation = useNavigation();
  const location = resolveLinuxUserLocation(navigation.searchParams);
  if (location.id)
    return (
      <LinuxUserPage
        key={`${userId}:${location.id}`}
        userId={userId}
        bindingId={location.id}
      />
    );
  return <PersonalComputersList key={userId} userId={userId} />;
}

function ListCell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-caption text-muted-foreground md:sr-only">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}

function PersonalComputersList({ userId }: { userId: string }) {
  const { t } = useT("settings");
  const data = useComputers(userId);
  const navigation = useNavigation();
  const location = resolveLinuxUserLocation(navigation.searchParams);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const states = t(($) => $.linux_user_pages.states, { returnObjects: true });
  const hints = t(($) => $.linux_user_pages.hints, { returnObjects: true });
  const kinds = t(($) => $.linux_user.kinds, { returnObjects: true });
  const machineName = (id: string) =>
    data.machines.data?.find((m) => m.id === id)?.name ??
    t(($) => $.linux_user.unknown);
  const href = (binding: ComputerBinding, operations = false) =>
    linuxUserHref(navigation.pathname, navigation.searchParams, {
      id: binding.id,
      view: operations ? "operations" : "overview",
      operation: operations ? binding.latest_operation?.id : undefined,
    });
  const accounts =
    data.bindings.data?.filter((b) =>
      `${b.username} ${machineName(b.computer_id)}`
        .toLocaleLowerCase()
        .includes(location.search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <SettingsTab
      title={
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span>{t(($) => $.computers.personal_title)}</span>
          <Dialog
            open={open}
            onOpenChange={(value) => {
              if (!submitting) setOpen(value);
            }}
          >
            <DialogTrigger render={<Button />}>
              {t(($) => $.linux_user_pages.create)}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t(($) => $.linux_user_pages.create)}</DialogTitle>
              </DialogHeader>
              {open && (
                <LinuxUserOperationForm
                  onBusyChange={setSubmitting}
                  userId={userId}
                  onAccepted={(b) => {
                    setOpen(false);
                    navigation.push(href(b, true));
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        </span>
      }
    >
      {((data.bindings.data?.length ?? 0) > 0 || location.search) && (
        <Input
          aria-label={t(($) => $.linux_user_pages.search)}
          placeholder={t(($) => $.linux_user_pages.search)}
          value={location.search}
          onChange={(e) =>
            navigation.replace(
              linuxUserHref(navigation.pathname, navigation.searchParams, {
                search: e.target.value,
              }),
            )
          }
        />
      )}
      {(data.bindings.error || data.machines.error) && (
        <p role="alert" className="text-destructive">
          {data.bindings.error?.message || data.machines.error?.message}
        </p>
      )}
      {data.bindings.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {!data.bindings.isPending && accounts.length === 0 && (
        <p>
          {location.search
            ? t(($) => $.linux_user_pages.empty_search)
            : t(($) => $.linux_user_pages.empty_accounts)}
        </p>
      )}
      {!data.bindings.isPending &&
        !location.search &&
        !data.bindings.error &&
        !data.machines.error &&
        data.bindings.data !== undefined &&
        data.machines.data !== undefined &&
        (data.bindings.data?.length ?? 0) === 0 &&
        (data.machines.data?.filter((m) => m.enabled).length ?? 0) === 0 &&
        !data.machines.isPending && (
          <p>{t(($) => $.workspace_linux_users.no_computers)}</p>
        )}
      {accounts.length > 0 && (
        <ul className="space-y-3">
          <li className="hidden gap-3 px-4 text-caption text-muted-foreground md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
            <span>{t(($) => $.linux_user_pages.columns.user)}</span>
            <span>{t(($) => $.linux_user_pages.columns.computer)}</span>
            <span>{t(($) => $.linux_user_pages.columns.workspace)}</span>
            <span>{t(($) => $.linux_user_pages.columns.status)}</span>
            <span className="sr-only">{t(($) => $.linux_user.details)}</span>
          </li>
          {accounts.map((binding) => {
            const status = bindingSummary(binding);
            const workspace = bindingWorkspaceLabel(binding);
            const op = binding.latest_operation;
            const showOp =
              op &&
              (op.state === "failed" ||
                op.state === "interrupted" ||
                binding.operation_busy);
            return (
              <li
                key={binding.id}
                className="grid gap-2 rounded-lg border p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-3"
              >
                <ListCell label={t(($) => $.linux_user_pages.columns.user)}>
                  <span className="font-medium">{binding.username}</span>
                </ListCell>
                <ListCell label={t(($) => $.linux_user_pages.columns.computer)}>
                  {machineName(binding.computer_id)}
                </ListCell>
                <ListCell label={t(($) => $.linux_user_pages.columns.workspace)}>
                  {workspace.name ??
                    t(($) => $.linux_user_pages.workspace[workspace.key!])}
                </ListCell>
                <ListCell label={t(($) => $.linux_user_pages.columns.status)}>
                  <span>
                    {states[status as keyof typeof states] ??
                      t(($) => $.linux_user.unknown)}
                  </span>
                  <p className="mt-1 text-caption text-muted-foreground">
                    {hints[status as keyof typeof hints] ??
                      hints.unknown}
                  </p>
                  {showOp && (
                    <AppLink
                      href={href(binding, true)}
                      className="mt-1 block text-caption underline"
                    >
                      {kinds[op.kind as keyof typeof kinds] ??
                        t(($) => $.linux_user.operations)}{" "}
                      ·{" "}
                      {t(
                        ($) =>
                          $.linux_user.states[
                            op.state as keyof typeof $.linux_user.states
                          ] ?? $.linux_user.unknown,
                      )}
                    </AppLink>
                  )}
                </ListCell>
                <AppLink
                  href={href(binding)}
                  className="shrink-0 text-body underline"
                >
                  {t(($) => $.linux_user.details)}
                </AppLink>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsTab>
  );
}
