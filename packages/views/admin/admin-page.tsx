"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@multica/core/auth";
import {
  useInstanceAccess,
  useComputerAdmin,
  type AdminComputer,
} from "@multica/core/computers";
import { paths } from "@multica/core/paths";
import { Button } from "@multica/ui/components/ui/button";
import { DropdownMenuItem } from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { AppLink, useNavigation } from "../navigation";
import { DragStrip } from "../platform";
import { useT } from "../i18n";

export function AdminAreaLink() {
  const user = useAuthStore((s) => s.user);
  const access = useInstanceAccess(user?.id ?? "");
  const { t } = useT("settings");
  return user && !access.error && access.data?.admin === true ? (
    <DropdownMenuItem render={<AppLink href={paths.admin()} />}>
      {t(($) => $.admin.title)}
    </DropdownMenuItem>
  ) : null;
}

export function AdminPage({ onBack }: { onBack?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.isLoading);
  const access = useInstanceAccess(user?.id ?? "");
  const { replace } = useNavigation();
  const { t } = useT("settings");
  useEffect(() => {
    if (!loading && !user)
      replace(`${paths.login()}?next=${encodeURIComponent(paths.admin())}`);
  }, [loading, user, replace]);
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <DragStrip />
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t(($) => $.admin.title)}</h1>
          <p className="text-sm text-muted-foreground">
            {t(($) => $.admin.scope)}
          </p>
        </div>
        {onBack ? (
          <Button variant="outline" onClick={onBack}>
            {t(($) => $.admin.back)}
          </Button>
        ) : (
          <AppLink href={paths.root()}>{t(($) => $.admin.back)}</AppLink>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-8 p-6">
        {loading || !user || access.isPending ? (
          <p role="status">{t(($) => $.computers.loading)}</p>
        ) : access.error ? (
          <p role="alert">{access.error.message}</p>
        ) : access.data?.admin !== true ? (
          <p role="alert">{t(($) => $.admin.denied)}</p>
        ) : (
          <ComputerManagement key={user.id} userId={user.id} />
        )}
      </main>
    </div>
  );
}
function ComputerManagement({ userId }: { userId: string }) {
  const { t } = useT("settings");
  const data = useComputerAdmin(userId, true);
  const empty = { name: "", host: "", port: 22, ssh_user: "" };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = data.register.isPending || data.update.isPending;
  const reset = () => {
    setEditing(null);
    setForm(empty);
  };
  const perform = async (fn: () => Promise<unknown>, done?: () => void) => {
    setError("");
    setNotice("");
    try {
      await fn();
      done?.();
      setNotice(t(($) => $.admin.saved));
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.computers.failed));
    }
  };
  const edit = (m: AdminComputer) => {
    setEditing(m.id);
    setForm({ name: m.name, host: m.host, port: m.port, ssh_user: m.ssh_user });
  };
  const name = (id: string) =>
    data.computers.data?.find((m) => m.id === id)?.name ?? id;
  const fetchError =
    data.computers.error || data.bindings.error || data.audit.error;
  return (
    <>
      {(error || fetchError) && (
        <p role="alert" className="text-destructive">
          {error || fetchError?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="space-y-4" aria-labelledby="computer-registry">
        <div className="flex items-center justify-between">
          <h2 id="computer-registry" className="text-lg font-semibold">
            {t(($) => $.computers.title)}
          </h2>
          <Button variant="outline" onClick={() => void data.refresh()}>
            {t(($) => $.admin.refresh)}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t(($) => $.admin.disable_help)}
        </p>
        {data.computers.isPending && (
          <p role="status">{t(($) => $.computers.loading)}</p>
        )}
        {data.computers.data?.length === 0 && (
          <p>{t(($) => $.admin.no_computers)}</p>
        )}
        <ul className="space-y-3">
          {data.computers.data?.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div>
                <p className="font-medium">
                  {m.name} ·{" "}
                  {m.enabled
                    ? t(($) => $.admin.enabled)
                    : t(($) => $.admin.disabled)}
                </p>
                <p className="break-all text-sm text-muted-foreground">
                  {m.ssh_user}@{m.host}:{m.port}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => edit(m)}
                >
                  {t(($) => $.admin.edit)}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      data.update.mutateAsync({
                        id: m.id,
                        enabled: !m.enabled,
                      }),
                    )
                  }
                >
                  {m.enabled
                    ? t(($) => $.admin.disable)
                    : t(($) => $.admin.enable)}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <form
          className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () =>
                editing
                  ? data.update.mutateAsync({ id: editing, ...form })
                  : data.register.mutateAsync(form),
              reset,
            );
          }}
        >
          <h3 className="font-medium sm:col-span-2">
            {editing ? t(($) => $.admin.edit) : t(($) => $.computers.register)}
          </h3>
          {(["name", "host", "ssh_user"] as const).map((k) => (
            <label key={k} className="space-y-1">
              <span>{t(($) => $.computers.machine_fields[k])}</span>
              <Input
                required
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="space-y-1">
            <span>{t(($) => $.computers.port)}</span>
            <Input
              required
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) =>
                setForm({ ...form, port: Number(e.target.value) })
              }
            />
          </label>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {t(($) => $.admin.connection_help)}
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {editing
                ? t(($) => $.admin.save)
                : t(($) => $.computers.register)}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={reset}
              >
                {t(($) => $.admin.cancel)}
              </Button>
            )}
          </div>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(($) => $.admin.bindings)}</h2>
        <p className="text-sm text-muted-foreground">
          {t(($) => $.admin.bindings_help)}
        </p>
        <ul className="space-y-2">
          {data.bindings.data?.map((b) => (
            <li className="rounded border p-3" key={b.id}>
              {name(b.computer_id)} · {b.user_name} · {b.username} · {b.state}
              <p className="text-sm text-muted-foreground">{b.workspace_id}</p>
            </li>
          ))}
        </ul>
        {data.bindings.data?.length === 0 && <p>{t(($) => $.admin.empty)}</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t(($) => $.admin.audit)}</h2>
        <p className="text-sm text-muted-foreground">
          {t(($) => $.admin.audit_help)}
        </p>
        <ul className="space-y-2">
          {data.audit.data?.map((a) => (
            <li className="rounded border p-3 text-sm" key={a.id}>
              <time dateTime={a.created_at}>
                {new Date(a.created_at).toLocaleString()}
              </time>{" "}
              · {a.user_name} · {name(a.computer_id)} · {a.action} · {a.outcome}
            </li>
          ))}
        </ul>
        {data.audit.data?.length === 0 && <p>{t(($) => $.admin.empty)}</p>}
      </section>
    </>
  );
}
