"use client";

import { useState } from "react";
import { useLinuxUserDetail } from "@multica/core/computers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import { AppLink, useNavigation } from "../navigation";
import { useT } from "../i18n";
import { SettingsTab } from "../settings/components/settings-layout";
import {
  linuxUserHref,
  linuxUserViews,
  resolveLinuxUserLocation,
  settingsHref,
} from "../settings/components/settings-navigation";
import { LinuxUserDetail } from "./linux-user-detail";
import { BindingRuntimes } from "./binding-runtimes";
import { LinuxUserOperationForm } from "./linux-user-operation-form";
import { AccountCredentials } from "../settings/components/credentials-tab";

export function LinuxUserPage({
  userId,
  bindingId,
}: {
  userId: string;
  bindingId: string;
}) {
  const { t } = useT("settings");
  const navigation = useNavigation();
  const location = resolveLinuxUserLocation(navigation.searchParams);
  const data = useLinuxUserDetail(userId, bindingId);
  const d = data.detail.data;
  const needsRecovery =
    data.operations.data?.some(
      (operation) =>
        operation.state === "interrupted" && !operation.finished_at,
    ) ?? false;
  const [action, setAction] = useState<"create_account" | "upgrade" | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const href = (view: typeof location.view) =>
    linuxUserHref(navigation.pathname, navigation.searchParams, {
      id: bindingId,
      view,
      fromWorkspace: location.fromWorkspace,
    });
  const back = location.fromWorkspace
    ? settingsHref(navigation.pathname, navigation.searchParams, "linux-users")
    : linuxUserHref(navigation.pathname, navigation.searchParams);
  const guard = (event: React.MouseEvent, target: string) => {
    if (
      dirty &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      setLeaving(target);
    }
  };
  return (
    <SettingsTab
      title={
        d
          ? `${d.username} · ${d.computer_name}`
          : t(($) => $.linux_user.details)
      }
    >
      <AppLink
        href={back}
        onClick={(e) => guard(e, back)}
        className="text-body underline"
      >
        {location.fromWorkspace
          ? t(($) => $.linux_user_pages.back_workspace)
          : t(($) => $.linux_user_pages.back)}
      </AppLink>
      <nav
        aria-label={t(($) => $.linux_user.details)}
        className="flex flex-wrap gap-2"
      >
        {linuxUserViews.map((view) => (
          <AppLink
            key={view}
            href={href(view)}
            onClick={(e) => guard(e, href(view))}
            aria-current={view === location.view ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-body ${view === location.view ? "bg-accent font-medium hover:bg-accent" : "hover:bg-muted"}`}
          >
            {t(($) => $.linux_user_pages.views[view])}
          </AppLink>
        ))}
      </nav>
      {data.detail.error && (
        <p role="alert" className="text-destructive">
          {data.detail.error.message}
        </p>
      )}
      {data.detail.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {(data.busy || needsRecovery) && location.view !== "operations" && (
        <AppLink
          className="text-body underline"
          href={href("operations")}
          onClick={(event) => guard(event, href("operations"))}
        >
          {needsRecovery
            ? t(($) => $.linux_user_pages.states.interrupted)
            : t(($) => $.linux_user_pages.states.running)}{" "}
          · {t(($) => $.linux_user.operations)}
        </AppLink>
      )}
      {d && (
        <div key={location.view}>
          {(location.view === "overview" || location.view === "operations") && (
            <LinuxUserDetail
              userId={userId}
              bindingId={bindingId}
              view={location.view}
              operationId={location.operation}
              onConfigure={setAction}
            />
          )}
          {location.view === "runtimes" &&
            (["ready", "pending", "failed"].includes(d.state) &&
            !d.archived_at &&
            d.verified &&
            d.account_state !== "missing" ? (
              <BindingRuntimes
                userId={userId}
                bindingId={bindingId}
                busy={
                  needsRecovery ||
                  data.busy ||
                  d.operation_busy ||
                  d.state === "running" ||
                  d.state === "interrupted"
                }
              />
            ) : (
              <p>{t(($) => $.linux_user_pages.configure_first)}</p>
            ))}
          {location.view === "credentials" && !d.archived_at && (
            <AccountCredentials
              userId={userId}
              binding={{
                ...d,
                operation_busy: d.operation_busy || data.busy || needsRecovery,
              }}
              onDirtyChange={setDirty}
            />
          )}
        </div>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !submitting) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action ? t(($) => $.computers.actions[action]) : ""}
            </DialogTitle>
          </DialogHeader>
          {action && d && (
            <LinuxUserOperationForm
              onBusyChange={setSubmitting}
              userId={userId}
              binding={d}
              action={action}
              onAccepted={() => {
                setAction(null);
                navigation.push(href("operations"));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!leaving}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.linux_user_pages.discard_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.linux_user_pages.discard_help)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline" />}>
              {t(($) => $.linux_user.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              render={<Button />}
              onClick={() => {
                if (leaving) {
                  setDirty(false);
                  navigation.push(leaving);
                  setLeaving(null);
                }
              }}
            >
              {t(($) => $.linux_user.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsTab>
  );
}
