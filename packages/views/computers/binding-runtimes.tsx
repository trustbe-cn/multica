"use client";
import { useState } from "react";
import {
  useComputerBindingRuntimes,
  useComputerBindingRuntimeInstall,
  type AdminComputerRuntime,
} from "@multica/core/computers";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@multica/ui/components/ui/dialog";
import { toast } from "sonner";
import { useT } from "../i18n";

export function BindingRuntimes({
  bindingId,
  userId,
  busy,
}: {
  bindingId: string;
  userId: string;
  busy: boolean;
}) {
  const { t } = useT("settings");
  const { runtimes, isInstalling } = useComputerBindingRuntimes(
    userId,
    bindingId,
  );
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <p className="text-sm text-muted-foreground">
        {t(($) => $.admin.runtimes_prerequisites)}
      </p>
      <p>{t(($) => $.linux_user.discover_help)}</p>
      {runtimes.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {runtimes.error && (
        <p role="alert" className="text-destructive">
          {runtimes.error.message}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={runtimes.isFetching || isInstalling}
        onClick={() => void runtimes.refetch()}
      >
        {t(($) => $.admin.refresh)}
      </Button>
      {runtimes.isSuccess && runtimes.data.length === 0 && (
        <p>{t(($) => $.admin.runtimes_empty)}</p>
      )}
      <ul className="space-y-2">
        {runtimes.data?.map((runtime) => (
          <RuntimeRow
            key={runtime.id}
            runtime={runtime}
            bindingId={bindingId}
            userId={userId}
            busy={busy}
          />
        ))}
      </ul>
    </div>
  );
}

function RuntimeRow({
  runtime,
  bindingId,
  userId,
  busy,
}: {
  runtime: AdminComputerRuntime;
  bindingId: string;
  userId: string;
  busy: boolean;
}) {
  const { t } = useT("settings");
  const [version, setVersion] = useState("");
  const [open, setOpen] = useState(false);
  const install = useComputerBindingRuntimeInstall(
    userId,
    bindingId,
    runtime.id,
  );
  const errors = t(($) => $.linux_user.errors, { returnObjects: true });
  const supportsVersion = runtime.supports_version ?? runtime.version_required;
  const handleInstall = async () => {
    if (install.isPending) return;
    try {
      await install.mutateAsync(
        supportsVersion ? version.trim() || "latest" : "latest",
      );
      toast.success(t(($) => $.computers.accepted));
      setOpen(false);
      setVersion("");
    } catch {
      toast.error(t(($) => $.admin.runtimes_install_failed));
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 text-sm">
      <span className="w-24 font-medium">{runtime.display_name}</span>
      <span className="text-muted-foreground">
        {runtime.probe_error
          ? t(($) => $.admin.runtimes_probe_failed)
          : runtime.installed_version
            ? `${t(($) => $.admin.runtimes_version)}: ${runtime.installed_version}`
            : runtime.probe_state === "missing"
              ? t(($) => $.admin.runtimes_not_installed)
              : t(($) => $.linux_user.unknown)}
      </span>
      {!supportsVersion && (
        <span className="text-muted-foreground">
          {t(($) => $.admin.runtimes_latest)}
        </span>
      )}
      {runtime.can_install && (
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!install.isPending) {
              setOpen(value);
              setVersion("");
              install.reset();
            }
          }}
        >
          <DialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || install.isPending}
              />
            }
          >
            {runtime.installed_version
              ? t(($) => $.admin.runtimes_update)
              : t(($) => $.admin.runtimes_install)}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{runtime.display_name}</DialogTitle>
            </DialogHeader>
            {supportsVersion && (
              <label className="space-y-1">
                <span>
                  {t(($) => $.admin.runtimes_version_label, {
                    runtime: runtime.display_name,
                  })}
                </span>
                <Input
                  placeholder={t(($) => $.admin.runtimes_version_placeholder)}
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  disabled={install.isPending}
                />
              </label>
            )}
            {install.error && (
              <p role="alert" className="text-destructive">
                {install.error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                disabled={busy || install.isPending}
                onClick={() => void handleInstall()}
              >
                {install.isPending
                  ? t(($) => $.admin.runtimes_installing)
                  : t(($) => $.admin.runtimes_install)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <details className="w-full">
        <summary>{t(($) => $.linux_user.assets)}</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all">
          <dt>{t(($) => $.linux_user.path)}</dt>
          <dd>{runtime.executable_path || "—"}</dd>
          <dt>{t(($) => $.linux_user.source)}</dt>
          <dd>{runtime.installer_source || "—"}</dd>
          <dt>{t(($) => $.linux_user.checked)}</dt>
          <dd>
            {runtime.checked_at
              ? new Date(runtime.checked_at).toLocaleString()
              : "—"}
          </dd>
          <dt>{t(($) => $.linux_user.environment)}</dt>
          <dd>{runtime.probe_environment || "—"}</dd>
          <dt>{t(($) => $.linux_user.registration)}</dt>
          <dd>
            {runtime.registration_state === "online"
              ? t(($) => $.linux_user.states.online)
              : runtime.registration_state === "offline"
                ? t(($) => $.linux_user.states.offline)
                : t(($) => $.linux_user.states.not_discovered)}
          </dd>
        </dl>
      </details>
      {runtime.probe_error && (
        <p className="w-full whitespace-pre-wrap break-words text-destructive">
          {errors[runtime.error_code as keyof typeof errors] ??
            runtime.probe_error}
        </p>
      )}
      {install.error && (
        <p
          role="alert"
          className="w-full whitespace-pre-wrap break-words text-destructive"
        >
          {install.error.message}
        </p>
      )}
    </li>
  );
}
