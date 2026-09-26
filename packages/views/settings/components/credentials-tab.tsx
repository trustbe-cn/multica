"use client";

import { useState } from "react";
import { clientErrorMessage, errorCode } from "@multica/core/api";
import { useAuthStore } from "@multica/core/auth";
import {
  useComputers,
  useComputerCredentials,
  type ComputerSettings,
} from "@multica/core/computers";
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
import { useT } from "../../i18n";
import { SettingsSection, SettingsTab } from "./settings-layout";

const fields: (keyof ComputerSettings)[] = [
  "git_name",
  "git_email",
  "gitlab_url",
  "gitlab_token",
  "git_ssh_key",
  "git_known_hosts",
  "model_env",
  "multica_pat",
];
const secrets = new Set<keyof ComputerSettings>([
  "gitlab_token",
  "git_ssh_key",
  "model_env",
  "multica_pat",
]);
const multiline = new Set<keyof ComputerSettings>([
  "git_ssh_key",
  "git_known_hosts",
  "model_env",
]);

export function CredentialsTab() {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  return <PersonalCredentialsTab key={userId} userId={userId} />;
}

function PersonalCredentialsTab({ userId }: { userId: string }) {
  const { t } = useT("settings");
  const data = useComputers(userId, true);
  const transfer = useComputerCredentials(userId);
  const [draft, setDraft] = useState<ComputerSettings | null>(null);
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [bindingId, setBindingId] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const settings =
    draftSource && draftSource !== bindingId
      ? undefined
      : (draft ?? data.settings.data?.settings);
  const accounts = (data.bindings.data ?? []).filter((b) => b.verified);
  const selected = accounts.find((b) => b.id === bindingId);
  const busy =
    data.save.isPending || transfer.read.isPending || transfer.write.isPending;
  const blocked =
    !selected ||
    selected.operation_busy ||
    selected.state === "running" ||
    selected.state === "interrupted";
  const labels = {
    git_name: t(($) => $.computers.git_name),
    git_email: t(($) => $.computers.git_email),
    gitlab_url: t(($) => $.computers.gitlab_url),
    gitlab_token: t(($) => $.computers.gitlab_token),
    git_ssh_key: t(($) => $.computers.ssh_key),
    git_known_hosts: t(($) => $.computers.known_hosts),
    model_env: t(($) => $.computers.model_keys),
    multica_pat: t(($) => $.computers.multica_pat),
  };
  const help = t(($) => $.credential_page.field_help, { returnObjects: true });
  async function perform(kind: "save" | "read" | "write") {
    setNotice("");
    setError("");
    try {
      if (kind === "read") {
        const result = await transfer.read.mutateAsync({
          id: bindingId,
          password,
        });
        setDraft(result.settings);
        setDraftSource(bindingId);
        setImportConfirmed(false);
        setReveal(false);
        setPassword("");
        setNotice(t(($) => $.credential_page.read_done));
      } else if (settings && kind === "write") {
        await transfer.write.mutateAsync({ id: bindingId, password, settings });
        setPassword("");
        setNotice(t(($) => $.credential_page.write_done));
      } else if (settings) {
        if (draftSource && !importConfirmed) return;
        await data.save.mutateAsync(settings);
        setDraft(null);
        setDraftSource(null);
        setImportConfirmed(false);
        setNotice(t(($) => $.credential_page.saved));
      }
    } catch (err) {
      const code = errorCode(err);
      const messages = t(($) => $.linux_user.errors, { returnObjects: true });
      const connectionErrors = t(($) => $.workspace_linux_users.errors, {
        returnObjects: true,
      });
      setError(
        code && Object.hasOwn(messages, code)
          ? messages[code as keyof typeof messages]
          : code && Object.hasOwn(connectionErrors, code)
            ? connectionErrors[code as keyof typeof connectionErrors]
            : (clientErrorMessage(err) ?? t(($) => $.computers.failed)),
      );
    } finally {
      transfer.read.reset();
      transfer.write.reset();
      data.save.reset();
    }
  }
  return (
    <SettingsTab title={t(($) => $.credential_page.title)}>
      <p>{t(($) => $.credential_page.help)}</p>
      {(error ||
        data.settings.error ||
        data.bindings.error ||
        data.machines.error) && (
        <p role="alert" className="text-destructive">
          {error ||
            data.settings.error?.message ||
            data.bindings.error?.message ||
            data.machines.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data.settings.isPending && (
        <p role="status">{t(($) => $.computers.loading)}</p>
      )}
      {draftSource && selected && (
        <p role="status">
          {t(($) => $.credential_page.remote_source, {
            username: selected.username,
          })}
        </p>
      )}
      {settings && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("save");
          }}
        >
          {fields.map((field) => {
            const hidden = secrets.has(field) && !reveal;
            const props = {
              id: `credential-${field}`,
              "aria-describedby": `credential-help-${field}`,
              autoComplete: "off",
              value: hidden && multiline.has(field) ? "" : settings[field],
              disabled: busy,
              onChange: (
                event: React.ChangeEvent<
                  HTMLInputElement | HTMLTextAreaElement
                >,
              ) => setDraft({ ...settings, [field]: event.target.value }),
            };
            return (
              <div key={field} className="space-y-1">
                <label htmlFor={`credential-${field}`}>{labels[field]}</label>
                {multiline.has(field) ? (
                  <Textarea
                    {...props}
                    readOnly={hidden}
                    placeholder={
                      hidden ? t(($) => $.computers.hidden) : undefined
                    }
                  />
                ) : (
                  <Input {...props} type={hidden ? "password" : "text"} />
                )}
                <p
                  id={`credential-help-${field}`}
                  className="text-sm text-muted-foreground"
                >
                  {help[field]}
                </p>
              </div>
            );
          })}
          {draftSource && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={importConfirmed}
                disabled={busy}
                onChange={(event) => setImportConfirmed(event.target.checked)}
              />
              <span>{t(($) => $.credential_page.confirm_import)}</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={busy || (!!draftSource && !importConfirmed)}
            >
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
      )}
      <SettingsSection title={t(($) => $.credential_page.transfer)}>
        <p>{t(($) => $.credential_page.transfer_help)}</p>
        <label className="block space-y-1">
          <span>{t(($) => $.credential_page.target)}</span>
          <Select
            value={bindingId}
            disabled={busy}
            items={accounts.map((b) => ({
              value: b.id,
              label: `${data.machines.data?.find((m) => m.id === b.computer_id)?.name ?? b.computer_id} · ${b.username}`,
            }))}
            onValueChange={(value) => {
              if ((value ?? "") === bindingId) return;
              setBindingId(value ?? "");
              setDraft(null);
              setDraftSource(null);
              setImportConfirmed(false);
              setReveal(false);
              setPassword("");
              setNotice("");
              setError("");
            }}
          >
            <SelectTrigger
              aria-label={t(($) => $.credential_page.target)}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {data.machines.data?.find((m) => m.id === b.computer_id)
                    ?.name ?? b.computer_id}{" "}
                  · {b.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block space-y-1">
          <span>{t(($) => $.computers.password)}</span>
          <Input
            type="password"
            autoComplete="off"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {accounts.length === 0 && !data.bindings.isPending && (
          <p>{t(($) => $.credential_page.no_accounts)}</p>
        )}
        {selected && blocked && (
          <p>{t(($) => $.workspace_linux_users.eligibility.busy)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || blocked || !password}
            onClick={() => void perform("read")}
          >
            {t(($) => $.credential_page.read)}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || blocked || !password || !settings}
            onClick={() => void perform("write")}
          >
            {t(($) => $.credential_page.write)}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(($) => $.credential_page.locations)}
        </p>
      </SettingsSection>
    </SettingsTab>
  );
}
