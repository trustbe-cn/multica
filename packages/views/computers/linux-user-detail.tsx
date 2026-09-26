"use client";

import { useState, type ReactNode } from "react";
import {
  useLinuxUserDetail,
  type ComputerLifecycleInput,
} from "@multica/core/computers";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { useT } from "../i18n";

export function LinuxUserDetail({
  userId,
  bindingId,
  admin = false,
  onConfigure,
  children,
}: {
  userId: string;
  bindingId: string;
  admin?: boolean;
  onConfigure?: (action: "create_account" | "upgrade") => void;
  children?: (busy: boolean) => ReactNode;
}) {
  const { t } = useT("settings");
  const data = useLinuxUserDetail(userId, bindingId, admin);
  const [action, setAction] = useState<ComputerLifecycleInput["action"] | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const d = data.detail.data;
  const busy =
    data.busy ||
    data.lifecycle.isPending ||
    data.discover.isPending ||
    d?.state === "running";
  const error =
    data.detail.error ||
    data.operations.error ||
    data.lifecycle.error ||
    data.discover.error ||
    data.recover.error ||
    data.check.error;
  const states = t(($) => $.linux_user.states, { returnObjects: true });
  const kinds = t(($) => $.linux_user.kinds, { returnObjects: true });
  const steps = t(($) => $.linux_user.steps, { returnObjects: true });
  const errors = t(($) => $.linux_user.errors, { returnObjects: true });
  const stateLabel = (state: string) =>
    states[state as keyof typeof states] ?? t(($) => $.linux_user.unknown);
  return (
    <section
      className="mt-3 space-y-3"
      aria-label={t(($) => $.linux_user.details)}
    >
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      {data.detail.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {d && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm break-all">
            <dt>{t(($) => $.computers.title)}</dt>
            <dd>{d.computer_name}</dd>
            <dt>{t(($) => $.computers.username)}</dt>
            <dd>{d.username}</dd>
            <dt>{t(($) => $.admin.linux_user_workspace)}</dt>
            <dd>{d.workspace_name || d.workspace_id || "—"}</dd>
            <dt>{t(($) => $.linux_user.binding)}</dt>
            <dd>
              {d.archived_at
                ? t(($) => $.linux_user.archived)
                : stateLabel(d.state)}
            </dd>
            <dt>{t(($) => $.linux_user.account)}</dt>
            <dd>{stateLabel(d.account_state)}</dd>
            <dt>{t(($) => $.linux_user.daemon)}</dt>
            <dd>
              {stateLabel(d.daemon_state)} · {d.daemon_id}
            </dd>
            <dt>{t(($) => $.linux_user.daemon_checked)}</dt>
            <dd>
              {d.daemon_checked_at
                ? new Date(d.daemon_checked_at).toLocaleString()
                : "—"}
            </dd>
            <dt>{t(($) => $.linux_user.last_check)}</dt>
            <dd>
              {d.checked_at ? new Date(d.checked_at).toLocaleString() : "—"}
            </dd>
            <dt>{t(($) => $.linux_user.last_seen)}</dt>
            <dd>
              {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "—"}
            </dd>
          </dl>
          {["failed", "interrupted", "detached", "removed"].includes(
            d.state,
          ) && <p>{t(($) => $.linux_user.recovery_help)}</p>}
          <Button
            variant="outline"
            disabled={data.check.isPending}
            onClick={() => data.check.mutate()}
          >
            {t(($) => $.admin.linux_user_check)}
          </Button>
          {!admin && !d.archived_at && (
            <div className="flex flex-wrap gap-2">
              {onConfigure &&
                (d.state === "removed" || d.state === "detached") && (
                  <Button
                    variant="outline"
                    onClick={() => onConfigure("create_account")}
                    disabled={busy}
                  >
                    {t(($) => $.computers.actions.create_account)}
                  </Button>
                )}
              {onConfigure && d.workspace_id && d.state !== "removed" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => onConfigure("upgrade")}
                    disabled={busy}
                  >
                    {t(($) => $.computers.actions.upgrade)}
                  </Button>
                </>
              )}
              {["ready", "failed", "pending"].includes(d.state) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => data.discover.mutate()}
                >
                  {t(($) => $.linux_user.discover)}
                </Button>
              )}
              {d.state !== "removed" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setAction("remove")}
                >
                  {t(($) => $.computers.actions.remove)}
                </Button>
              )}
              {d.state === "removed" && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setAction("archive")}
                  >
                    {t(($) => $.linux_user.archive)}
                  </Button>
                  {d.account_state !== "missing" && (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setAction("delete_user")}
                    >
                      {t(($) => $.linux_user.delete_user)}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
          {!admin && (
            <p className="text-sm text-muted-foreground">
              {t(($) => $.linux_user.retry_help)}
            </p>
          )}
          {action && (
            <form
              className="space-y-2 rounded-lg border p-3"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await data.lifecycle.mutateAsync({
                    action,
                    confirm_username: confirmation,
                    ...(action !== "archive" ? { password } : {}),
                  });
                  setAction(null);
                  setConfirmation("");
                  setPassword("");
                  data.lifecycle.reset();
                } catch {
                  /* The mutation error stays visible. */
                }
              }}
            >
              <p>
                {action === "delete_user"
                  ? t(($) => $.linux_user.delete_help)
                  : action === "archive"
                    ? t(($) => $.linux_user.archive_help)
                    : t(($) => $.computers.remove_help)}
              </p>
              <label className="block">
                {t(($) => $.linux_user.confirm_username, {
                  username: d.username,
                })}
                <Input
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              {action !== "archive" && (
                <label className="block">
                  {t(($) => $.linux_user.password_for, {
                    username: d?.username ?? "",
                  })}
                  <Input
                    required
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={busy || confirmation !== d.username}
                >
                  {t(($) => $.linux_user.confirm)}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={data.lifecycle.isPending}
                  onClick={() => {
                    setAction(null);
                    setPassword("");
                    setConfirmation("");
                    data.lifecycle.reset();
                  }}
                >
                  {t(($) => $.linux_user.cancel)}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      <h4 className="font-medium">{t(($) => $.linux_user.operations)}</h4>
      {data.operations.data?.length === 0 && (
        <p>{t(($) => $.linux_user.no_operations)}</p>
      )}
      <ol className="space-y-2">
        {data.operations.data?.map((op) => (
          <li key={op.id} className="rounded border p-2 text-sm">
            <p>
              {kinds[op.kind as keyof typeof kinds] ??
                t(($) => $.linux_user.unknown)}{" "}
              {op.runtime_id} · {stateLabel(op.state)} ·{" "}
              {steps[op.step as keyof typeof steps] ??
                t(($) => $.linux_user.unknown)}
            </p>
            <p className="text-muted-foreground">
              {new Date(op.created_at).toLocaleString()}
              {op.finished_at &&
                ` → ${new Date(op.finished_at).toLocaleString()}`}
            </p>
            {op.requested_version && (
              <p>
                {t(($) => $.linux_user.versions, {
                  requested: op.requested_version,
                  actual: op.actual_version || "—",
                })}
              </p>
            )}
            {op.error_code && (
              <p className="text-destructive">
                {errors[op.error_code as keyof typeof errors] ??
                  op.error_summary}
              </p>
            )}
            {!admin &&
              (op.state === "queued" ||
                (op.state === "interrupted" && !op.finished_at)) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.recover.isPending}
                  onClick={() =>
                    data.recover.mutate({
                      id: op.id,
                      action: op.state === "queued" ? "cancel" : "acknowledge",
                    })
                  }
                >
                  {op.state === "queued"
                    ? t(($) => $.linux_user.cancel)
                    : t(($) => $.linux_user.acknowledge)}
                </Button>
              )}
          </li>
        ))}
      </ol>
      {children?.(busy)}
    </section>
  );
}
