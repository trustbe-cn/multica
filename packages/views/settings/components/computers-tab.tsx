"use client";

import { useState, type FormEvent } from "react";
import {
  useComputers,
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
  const [username, setUsername] = useState(
    (user?.email ?? "").split("@")[0] ?? "",
  );
  const [password, setPassword] = useState("");
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
    const workspaceID = workspace?.id;
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
        <ul className="space-y-3" aria-live="polite">
          {data.bindings.data?.map((b) => (
            <li key={b.id} className="rounded-lg border p-3 break-words">
              <p>
                {data.machines.data?.find((m) => m.id === b.computer_id)
                  ?.name ?? b.computer_id}{" "}
                · {b.username} ·{" "}
                {b.state === "ready"
                  ? t(($) => $.computers.ready)
                  : b.state === "running"
                    ? t(($) => $.computers.running)
                    : b.state === "removed"
                      ? t(($) => $.computers.removed)
                      : t(($) => $.computers.failed)}
              </p>
              {b.last_error && (
                <p className="text-destructive">{b.last_error}</p>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>
    </SettingsTab>
  );
}
