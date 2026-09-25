"use client";

import { LinuxUserDetail } from "../../computers/linux-user-detail";

import { useState, useRef, type FormEvent } from "react";
import {
  useComputers,
  useComputerBindingRuntimes,
  useComputerBindingRuntimeInstall,
  type AdminComputerRuntime,
  type ComputerBinding,
  type ComputerSettings,
  type ComputerOperation,
} from "@multica/core/computers";
import { useAuthStore } from "@multica/core/auth";
import { useCurrentWorkspace } from "@multica/core/paths";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { SettingsSection, SettingsTab } from "./settings-layout";
import { useT } from "../../i18n";
import { toast } from "sonner";

export function ComputersTab() {
  const userId = useAuthStore((s) => s.user?.id);
  return <PersonalComputersTab key={userId ?? "anonymous"} />;
}

function PersonalComputersTab() {
  const { t } = useT("settings");
  const user = useAuthStore((s) => s.user);
  const workspace = useCurrentWorkspace();
  const data = useComputers(user?.id ?? "");
  const [draft, setDraft] = useState<ComputerSettings | null>(null);
  const [reveal, setReveal] = useState(false);
  const [machine, setMachine] = useState("");
  const [workspaceTarget, setWorkspaceTarget] = useState("");
  const [username, setUsername] = useState(
    (user?.email ?? "").split("@")[0] ?? "",
  );
  const [password, setPassword] = useState("");
  const passwordInput = useRef<HTMLInputElement>(null);
  const [action, setAction] =
    useState<ComputerOperation["action"]>("provision");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const availableMachines = data.machines.data?.filter(m => m.enabled || action === "remove") ?? [];
  const settings = draft ?? data.settings.data?.settings;
  const busy =
    data.save.isPending || data.operate.isPending;
  async function perform(operation: () => Promise<unknown>, done: () => void) {
    setError("");
    setNotice("");
    try {
      await operation();
      done();
      setNotice(t(($) => $.computers.accepted));
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.computers.failed));
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const workspaceID = workspaceTarget || workspace?.id;
    if (!workspaceID) return;
    void perform(
      () =>
        data.operate.mutateAsync({
          computer_id: machine,
          workspace_id: workspaceID,
          username,
          password,
          action,
        }),
      () => {
        setPassword("");
        data.operate.reset();
      },
    );
  }
  const fieldLabels = {
    git_name: t(($) => $.computers.git_name),
    git_email: t(($) => $.computers.git_email),
    gitlab_url: t(($) => $.computers.gitlab_url),
    gitlab_token: t(($) => $.computers.gitlab_token),
    multica_pat: t(($) => $.computers.multica_pat),
  };
  return (
    <SettingsTab title={t(($) => $.computers.personal_title)}>
      {(error ||
        data.settings.error ||
        data.machines.error ||
        data.bindings.error) && (
        <p role="alert" className="text-destructive">
          {error ||
            data.settings.error?.message ||
            data.machines.error?.message ||
            data.bindings.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data.settings.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {settings && (
        <SettingsSection
          title={t(($) => $.computers.credentials)}
          description={t(($) => $.computers.credentials_help)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                () => data.save.mutateAsync(settings),
                () => {
                  setDraft(null);
                  data.save.reset();
                },
              );
            }}
          >
            {(Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).map(
              (key) => (
                <label key={key} className="block space-y-1">
                  <span>{fieldLabels[key]}</span>
                  <Input
                    required={key !== "gitlab_token"}
                    value={settings[key]}
                    type={
                      !reveal &&
                      (key === "gitlab_token" || key === "multica_pat")
                        ? "password"
                        : "text"
                    }
                    autoComplete="off"
                    onChange={(e) =>
                      setDraft({ ...settings, [key]: e.target.value })
                    }
                  />
                </label>
              ),
            )}
            <label className="block space-y-1">
              <span>{t(($) => $.computers.ssh_key)}</span>
              <Textarea
                autoComplete="off"
                value={reveal ? settings.git_ssh_key : ""}
                readOnly={!reveal}
                placeholder={reveal ? "" : t(($) => $.computers.hidden)}
                onChange={(e) =>
                  setDraft({ ...settings, git_ssh_key: e.target.value })
                }
              />
            </label>
            <label className="block space-y-1">
              <span>{t(($) => $.computers.known_hosts)}</span>
              <Textarea
                value={settings.git_known_hosts}
                onChange={(e) =>
                  setDraft({ ...settings, git_known_hosts: e.target.value })
                }
              />
            </label>
            <label className="block space-y-1">
              <span>{t(($) => $.computers.model_keys)}</span>
              <Textarea
                value={reveal ? settings.model_env : ""}
                autoComplete="off"
                readOnly={!reveal}
                placeholder={
                  reveal
                    ? t(($) => $.computers.model_example)
                    : t(($) => $.computers.hidden)
                }
                onChange={(e) =>
                  setDraft({ ...settings, model_env: e.target.value })
                }
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {t(($) => $.computers.save)}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReveal(!reveal)}
              >
                {reveal
                  ? t(($) => $.computers.hide)
                  : t(($) => $.computers.reveal)}
              </Button>
            </div>
          </form>
        </SettingsSection>
      )}
      <SettingsSection
        title={t(($) => $.computers.setup)}
        description={t(($) => $.computers.setup_help)}
      >
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1">
            <span>{t(($) => $.computers.title)}</span>
            <Select
              items={availableMachines.map((m) => ({
                value: m.id,
                label: m.name,
              }))}
              value={machine}
              onValueChange={(v) => setMachine(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t(($) => $.computers.choose)} />
              </SelectTrigger>
              <SelectContent>
                {availableMachines.map((m) => (
                  <SelectItem value={m.id} key={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <p>{t(($) => $.admin.linux_user_workspace)}: {workspaceTarget || workspace?.name || workspace?.id || "—"}</p>
          <label className="block space-y-1">
            <span>{t(($) => $.computers.username)}</span>
            <Input
              value={username}
              required
              pattern="[a-z_][a-z0-9_-]{0,31}"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span>{t(($) => $.computers.password)}</span>
            <Input
              ref={passwordInput}
              type="password"
              autoComplete="off"
              value={password}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span>{t(($) => $.computers.action)}</span>
            <Select
              items={(["provision", "sync", "upgrade", "remove"] as const).map(
                (a) => ({ value: a, label: t(($) => $.computers.actions[a]) }),
              )}
              value={action}
              onValueChange={(v) => {
                if (
                  v === "provision" ||
                  v === "sync" ||
                  v === "upgrade" ||
                  v === "remove"
                )
                  setAction(v);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["provision", "sync", "upgrade", "remove"] as const).map(
                  (a) => (
                    <SelectItem key={a} value={a}>
                      {t(($) => $.computers.actions[a])}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </label>
          {action === "remove" && <p>{t(($) => $.computers.remove_help)}</p>}
          <Button
            type="submit"
            disabled={busy || !machine || !availableMachines.some(m => m.id === machine) || !workspace || !settings}
            variant={action === "remove" ? "destructive" : "default"}
          >
            {t(($) => $.computers.execute)}
          </Button>
        </form>
      </SettingsSection>
      <SettingsSection title={t(($) => $.workspace_linux_users.choose_existing)}>
        <ul className="space-y-3" aria-live="polite">
          {data.bindings.data?.map((b) => (
            <BindingRow key={b.id} binding={b} machineName={data.machines.data?.find((m) => m.id === b.computer_id)?.name ?? b.computer_id} userId={user?.id ?? ""} onConfigure={(nextAction) => { setMachine(b.computer_id);setUsername(b.username);setAction(nextAction);setWorkspaceTarget(nextAction === "provision" ? "" : b.workspace_id);setPassword("");setNotice(t(($) => $.linux_user.prompt_password));passwordInput.current?.focus(); }} />
          ))}
        </ul>
      </SettingsSection>
    </SettingsTab>
  );
}

function BindingRow({ binding, machineName, userId, onConfigure }: { binding: ComputerBinding; machineName: string; userId: string; onConfigure: (action: "provision" | "sync" | "upgrade") => void }) {
  const { t } = useT("settings");
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border p-3 break-words">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>{machineName} · {binding.username} · {t(($) => $.linux_user.states[binding.state as keyof typeof $.linux_user.states] ?? $.linux_user.unknown)}</p>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{t(($) => $.linux_user.details)}</Button>
      </div>
      <p className="break-all text-sm text-muted-foreground">{t(($) => $.admin.linux_user_workspace)}: {binding.workspace_id}</p>
      {binding.last_error && <p className="text-destructive">{binding.last_error}</p>}
      {open && <LinuxUserDetail userId={userId} bindingId={binding.id} onConfigure={onConfigure}>{(busy) => ["ready", "failed"].includes(binding.state) ? <BindingRuntimes bindingId={binding.id} userId={userId} busy={busy} /> : null}</LinuxUserDetail>}
    </li>
  );
}

function BindingRuntimes({ bindingId, userId, busy }: { bindingId: string; userId: string; busy: boolean }) {
  const { t } = useT("settings");
  const { runtimes, isInstalling } = useComputerBindingRuntimes(userId, bindingId);
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <p className="text-sm text-muted-foreground">{t(($) => $.admin.runtimes_prerequisites)}</p><p>{t(($) => $.linux_user.discover_help)}</p>
      {runtimes.isPending && <p role="status">{t(($) => $.computers.loading)}</p>}
      {runtimes.error && <p role="alert" className="text-destructive">{runtimes.error.message}</p>}
      <Button type="button" variant="outline" size="sm" disabled={runtimes.isFetching || isInstalling} onClick={() => void runtimes.refetch()}>{t(($) => $.admin.refresh)}</Button>
      {runtimes.isSuccess && runtimes.data.length === 0 && <p>{t(($) => $.admin.runtimes_empty)}</p>}
      <ul className="space-y-2">{runtimes.data?.map((runtime) => <RuntimeRow key={runtime.id} runtime={runtime} bindingId={bindingId} userId={userId} busy={busy} />)}</ul>
    </div>
  );
}

function RuntimeRow({ runtime, bindingId, userId, busy }: { runtime: AdminComputerRuntime; bindingId: string; userId: string; busy: boolean }) {
  const { t } = useT("settings");
  const [version, setVersion] = useState("");
  const install = useComputerBindingRuntimeInstall(userId, bindingId, runtime.id);
  const errors = t(($) => $.linux_user.errors, {returnObjects:true});
  const handleInstall = async () => {
    if (install.isPending || (runtime.version_required && !version.trim())) return;
    try {
      await install.mutateAsync(runtime.version_required ? version.trim() : "latest");
      toast.success(t(($) => $.computers.accepted));
    } catch {
      toast.error(t(($) => $.admin.runtimes_install_failed));
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 text-sm">
      <span className="w-24 font-medium">{runtime.display_name}</span>
      <span className="text-muted-foreground">{runtime.probe_error ? t(($) => $.admin.runtimes_probe_failed) : runtime.installed_version ? `${t(($) => $.admin.runtimes_version)}: ${runtime.installed_version}` : runtime.probe_state === "missing" ? t(($) => $.admin.runtimes_not_installed) : t(($) => $.linux_user.unknown)}</span>
      {!runtime.version_required && <span className="text-muted-foreground">{t(($) => $.admin.runtimes_latest)}</span>}
      {runtime.can_install && <div className="flex flex-wrap items-center gap-2">
        {runtime.version_required && <Input className="h-7 w-24 text-xs" placeholder={t(($) => $.admin.runtimes_version_placeholder)} value={version} onChange={(e) => setVersion(e.target.value)} disabled={busy || install.isPending} aria-label={t(($) => $.admin.runtimes_version_label, { runtime: runtime.display_name })} />}
        <Button type="button" variant="outline" size="sm" disabled={busy || install.isPending || (runtime.version_required && !version.trim())} onClick={() => void handleInstall()}>{install.isPending ? t(($) => $.admin.runtimes_installing) : runtime.installed_version ? t(($) => $.admin.runtimes_update) : t(($) => $.admin.runtimes_install)}</Button>
      </div>}
      <details className="w-full"><summary>{t(($) => $.linux_user.assets)}</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 break-all">
          <dt>{t(($) => $.linux_user.path)}</dt><dd>{runtime.executable_path || "—"}</dd>
          <dt>{t(($) => $.linux_user.source)}</dt><dd>{runtime.installer_source || "—"}</dd>
          <dt>{t(($) => $.linux_user.checked)}</dt><dd>{runtime.checked_at ? new Date(runtime.checked_at).toLocaleString() : "—"}</dd>
          <dt>{t(($) => $.linux_user.environment)}</dt><dd>{runtime.probe_environment || "—"}</dd>
          <dt>{t(($) => $.linux_user.registration)}</dt><dd>{runtime.registration_state === "online" ? t(($) => $.linux_user.states.online) : runtime.registration_state === "offline" ? t(($) => $.linux_user.states.offline) : t(($) => $.linux_user.states.not_discovered)}</dd>
        </dl>
      </details>
      {runtime.probe_error && <p className="w-full whitespace-pre-wrap break-words text-destructive">{errors[runtime.error_code as keyof typeof errors] ?? runtime.probe_error}</p>}
      {install.error && <p role="alert" className="w-full whitespace-pre-wrap break-words text-destructive">{install.error.message}</p>}
    </li>
  );
}
