"use client";

import { useState } from "react";
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

function PersonalComputersList({ userId }: { userId: string }) {
  const { t } = useT("settings");
  const data = useComputers(userId);
  const navigation = useNavigation();
  const location = resolveLinuxUserLocation(navigation.searchParams);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const states = t(($) => $.linux_user_pages.states, { returnObjects: true });
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
      {(data.bindings.error || data.machines.error) && (
        <p role="alert" className="text-destructive">
          {data.bindings.error?.message || data.machines.error?.message}
        </p>
      )}
      {data.bindings.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {!data.bindings.isPending && !accounts.length && (
        <p>{t(($) => $.linux_user_pages.empty)}</p>
      )}
      <ul className="space-y-3">
        {accounts.map((binding) => {
          const status = bindingSummary(binding);
          const workspace = bindingWorkspaceLabel(binding);
          const op = binding.latest_operation;
          return (
            <li
              key={binding.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0 space-y-1">
                <p className="break-words font-medium">
                  {machineName(binding.computer_id)} · {binding.username}
                </p>
                <p className="text-caption text-muted-foreground">
                  {workspace.name ??
                    t(($) => $.linux_user_pages.workspace[workspace.key!])}
                </p>
                <p>
                  {states[status as keyof typeof states] ??
                    t(($) => $.linux_user.unknown)}
                </p>
                {op &&
                  (op.state === "failed" ||
                    op.state === "interrupted" ||
                    binding.operation_busy) && (
                    <AppLink
                      href={href(binding, true)}
                      className="text-caption underline"
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
              </div>
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
    </SettingsTab>
  );
}
