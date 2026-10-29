"use client";

import { useRef, useState } from "react";
import {
  modelRuntimeKinds,
  useModelKeyAdmin,
  type ModelDirectoryKey,
} from "@multica/core/computers";
import { ApiError } from "@multica/core/api";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@multica/ui/components/ui/table";
import {
  ModelChoice,
  ModelError,
  ModelStatus,
} from "../computers/model-config-controls";
import { useT } from "../i18n";
import { useDebouncedValue } from "../common/use-debounced-value";

type Assignment = { ids: string[]; userId: string | null };

export function ModelKeyPanel({ userId }: { userId: string }) {
  const { t } = useT("settings");
  const [search, setSearch] = useState("");
  const [runtime, setRuntime] = useState("");
  const [platform, setPlatform] = useState("");
  const [owner, setOwner] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [page, setPage] = useState(1);
  const [userSearch, setUserSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  // Selection is kept by ID with its row so it survives paging and filters.
  const [selection, setSelection] = useState<Map<string, ModelDirectoryKey>>(
    () => new Map(),
  );
  const [transfer, setTransfer] = useState<Assignment | null>(null);
  const pendingAssignment = useRef<Assignment | null>(null);
  const [baseURL, setBaseURL] = useState<string | null>(null);
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedUserSearch = useDebouncedValue(userSearch, 300);
  const data = useModelKeyAdmin(
    userId,
    {
      search: debouncedSearch,
      runtime,
      platform,
      owner,
      status: showDisabled ? "all" : "",
      page,
    },
    debouncedUserSearch,
  );
  const busy =
    data.saveSource.isPending ||
    data.refresh.isPending ||
    data.assign.isPending;
  const perform = async (fn: () => Promise<unknown>, done?: () => void) => {
    setError(null);
    setNotice("");
    try {
      await fn();
      done?.();
      setNotice(t(($) => $.model_configuration.saved));
    } catch (err) {
      // Another admin assigned a key after this page loaded: ask again.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        typeof err.body === "object" &&
        err.body !== null &&
        "code" in err.body &&
        err.body.code === "model_key_assigned_elsewhere" &&
        pendingAssignment.current
      ) {
        setTransfer(pendingAssignment.current);
        return;
      }
      setError(err);
    }
  };
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const toggle = (key: ModelDirectoryKey, checked: boolean) =>
    setSelection((current) => {
      const next = new Map(current);
      if (checked) next.set(key.id, key);
      else next.delete(key.id);
      return next;
    });
  const userLabel = (u: { name: string; email: string }) =>
    u.name ? `${u.name} · ${u.email}` : u.email;
  const userOptions = (data.users.data ?? []).map((u) => ({
    value: u.id,
    label: userLabel(u),
  }));
  const rows = data.directory.data?.items ?? [];
  const pageIds = rows.filter((k) => assignable(k) || k.owner).map((k) => k.id);
  const selected = [...selection.values()];
  const assignableSelected = selected.filter(assignable);
  const submit = async (assignment: Assignment, allowTransfer: boolean) => {
    pendingAssignment.current = assignment;
    await perform(
      () => data.assign.mutateAsync({ ...assignment, allowTransfer }),
      () => {
        setSelection(new Map());
        setTransfer(null);
      },
    );
  };
  const assignTo = (target: string) => {
    const ids = assignableSelected.map((k) => k.id);
    // Moving a key away from someone else is confirmed before the request.
    const moving = assignableSelected.some(
      (k) => k.owner && k.owner.id !== target,
    );
    if (moving) setTransfer({ ids, userId: target });
    else void submit({ ids, userId: target }, false);
  };
  const transferOwners = transfer
    ? [
        ...new Set(
          selected
            .filter((k) => transfer.ids.includes(k.id) && k.owner)
            .map((k) => userLabel(k.owner!)),
        ),
      ].join(", ")
    : "";
  const transferTarget = transfer?.userId
    ? (userOptions.find((u) => u.value === transfer.userId)?.label ?? "")
    : "";
  return (
    <div className="space-y-8">
      <section
        className="space-y-4"
        aria-label={t(($) => $.model_configuration.source)}
      >
        <h2 className="text-title font-semibold">
          {t(($) => $.model_configuration.source)}
        </h2>
        <p className="text-caption text-muted-foreground">
          {t(($) => $.model_configuration.source_help)}
        </p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              try {
                await data.saveSource.mutateAsync({
                  baseURL: baseURL ?? data.source.data?.baseURL ?? "",
                  directoryToken: token,
                  revision: sourceRevision ?? data.source.data?.revision ?? 0,
                });
                setToken("");
                setBaseURL(null);
                setSourceRevision(null);
              } finally {
                data.saveSource.reset();
              }
            });
          }}
        >
          <label className="space-y-1">
            <span>{t(($) => $.model_configuration.base_url)}</span>
            <Input
              required
              type="url"
              value={baseURL ?? data.source.data?.baseURL ?? ""}
              placeholder="https://sub2api.example.com"
              onChange={(e) => {
                setBaseURL(e.target.value);
                setSourceRevision(
                  (revision) => revision ?? data.source.data?.revision ?? 0,
                );
              }}
              disabled={busy}
            />
          </label>
          <label className="space-y-1">
            <span>{t(($) => $.model_configuration.directory_token)}</span>
            <Input
              required
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setSourceRevision(
                  (revision) => revision ?? data.source.data?.revision ?? 0,
                );
              }}
              placeholder={t(($) => $.model_configuration.credential_hint)}
              disabled={busy}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button
              type="submit"
              disabled={
                busy || data.source.isPending || !!data.source.error || !token
              }
            >
              {t(($) => $.model_configuration.save)}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !data.source.data?.configured}
              onClick={() => void perform(() => data.refresh.mutateAsync())}
            >
              {t(($) => $.model_configuration.refresh)}
            </Button>
            {data.source.data && (
              <span className="text-caption tabular-nums">
                <ModelStatus status={data.source.data.status} /> ·{" "}
                {t(($) => $.model_configuration.key_count, {
                  count: data.source.data.directoryCount,
                })}
                {data.source.data.lastCheckedAt &&
                  ` · ${t(($) => $.model_configuration.last_updated, {
                    time: new Date(
                      data.source.data.lastCheckedAt,
                    ).toLocaleString(),
                  })}`}
              </span>
            )}
          </div>
        </form>
        <ModelError
          error={data.source.error || error || data.source.data?.lastErrorCode}
        />
        {notice && (
          <p role="status" className="text-caption text-success">
            {notice}
          </p>
        )}
      </section>
      <section
        className="space-y-4"
        aria-label={t(($) => $.model_configuration.keys_section)}
      >
        <h2 className="text-title font-semibold">
          {t(($) => $.model_configuration.keys_section)}
        </h2>
        <p className="text-caption text-muted-foreground">
          {t(($) => $.model_configuration.ownership_help)}
        </p>
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            aria-label={t(($) => $.model_configuration.search_keys)}
            placeholder={t(($) => $.model_configuration.search_keys)}
            value={search}
            onChange={(e) => filter(() => setSearch(e.target.value))}
          />
          <ModelChoice
            label={t(($) => $.model_configuration.owner)}
            value={owner}
            options={[
              { value: "", label: t(($) => $.model_configuration.all_owners) },
              {
                value: "none",
                label: t(($) => $.model_configuration.unassigned),
              },
              ...userOptions,
            ]}
            onSearch={setUserSearch}
            onChange={(value) => filter(() => setOwner(value))}
          />
          <ModelChoice
            label={t(($) => $.model_configuration.platform)}
            value={platform}
            options={[
              {
                value: "",
                label: t(($) => $.model_configuration.all_platforms),
              },
              ...(data.directory.data?.platforms ?? []).map((p) => ({
                value: p,
                label: p,
              })),
            ]}
            onChange={(value) => filter(() => setPlatform(value))}
          />
          <ModelChoice
            label={t(($) => $.model_configuration.allowed_runtimes)}
            value={runtime}
            options={[
              { value: "", label: t(($) => $.model_configuration.all_runtimes) },
              ...modelRuntimeKinds.map((kind) => ({ value: kind, label: kind })),
            ]}
            onChange={(value) => filter(() => setRuntime(value))}
          />
        </div>
        <label className="flex items-center gap-2 text-caption">
          <Checkbox
            checked={showDisabled}
            onCheckedChange={(checked) => filter(() => setShowDisabled(checked))}
          />
          {t(($) => $.model_configuration.show_disabled)}
        </label>
        <div
          role="toolbar"
          aria-label={t(($) => $.model_configuration.bulk_actions)}
          className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
        >
          <span className="text-caption tabular-nums" aria-live="polite">
            {t(($) => $.model_configuration.selected_count, {
              count: selection.size,
            })}
          </span>
          <div className="w-64">
            <ModelChoice
              label={t(($) => $.model_configuration.assign_to)}
              value={assignee}
              options={userOptions}
              onSearch={setUserSearch}
              disabled={busy}
              onChange={setAssignee}
            />
          </div>
          <Button
            disabled={busy || !assignee || assignableSelected.length === 0}
            onClick={() => assignTo(assignee)}
          >
            {t(($) => $.model_configuration.assign)}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !selected.some((k) => k.owner)}
            onClick={() =>
              void submit(
                {
                  ids: selected.filter((k) => k.owner).map((k) => k.id),
                  userId: null,
                },
                false,
              )
            }
          >
            {t(($) => $.model_configuration.revoke)}
          </Button>
          {selection.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setSelection(new Map())}
            >
              {t(($) => $.model_configuration.clear_selection)}
            </Button>
          )}
        </div>
        <ModelError error={data.directory.error || data.users.error} />
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t(($) => $.model_configuration.select_page)}
                    checked={
                      pageIds.length > 0 &&
                      pageIds.every((id) => selection.has(id))
                    }
                    disabled={busy || pageIds.length === 0}
                    onCheckedChange={(checked) =>
                      rows
                        .filter((k) => pageIds.includes(k.id))
                        .forEach((k) => toggle(k, checked))
                    }
                  />
                </TableHead>
                <TableHead>{t(($) => $.model_configuration.key_name)}</TableHead>
                <TableHead>{t(($) => $.model_configuration.platform)}</TableHead>
                <TableHead>
                  {t(($) => $.model_configuration.allowed_runtimes)}
                </TableHead>
                <TableHead>{t(($) => $.model_configuration.status)}</TableHead>
                <TableHead>{t(($) => $.model_configuration.owner)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((key) => (
                <TableRow
                  key={key.id}
                  data-state={selection.has(key.id) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`${key.apiKeyName} #${key.id}`}
                      checked={selection.has(key.id)}
                      // Unusable keys can only be selected to revoke them.
                      disabled={busy || (!assignable(key) && !key.owner)}
                      onCheckedChange={(checked) => toggle(key, checked)}
                    />
                  </TableCell>
                  <TableCell>
                    {key.apiKeyName}{" "}
                    <span className="text-caption text-muted-foreground">
                      #{key.id}
                    </span>
                  </TableCell>
                  <TableCell>{key.platform || "—"}</TableCell>
                  <TableCell>{key.allowedRuntimes.join(", ") || "—"}</TableCell>
                  <TableCell>
                    <ModelStatus status={key.status} />
                  </TableCell>
                  <TableCell>
                    {key.owner ? (
                      userLabel(key.owner)
                    ) : (
                      <span className="text-muted-foreground">
                        {t(($) => $.model_configuration.unassigned)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.directory.data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    {t(($) => $.model_configuration.empty)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1 || data.directory.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t(($) => $.model_configuration.previous)}
          </Button>
          <span className="tabular-nums">{page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!data.directory.data?.hasMore || data.directory.isFetching}
            onClick={() => setPage(page + 1)}
          >
            {t(($) => $.model_configuration.next)}
          </Button>
        </div>
        <AlertDialog
          open={transfer !== null}
          onOpenChange={(open) => {
            if (!open && !data.assign.isPending) setTransfer(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(($) => $.model_configuration.transfer_title)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $.model_configuration.transfer_help, {
                  from: transferOwners,
                  to: transferTarget,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                render={
                  <Button variant="outline" disabled={data.assign.isPending} />
                }
              >
                {t(($) => $.linux_user.cancel)}
              </AlertDialogCancel>
              <Button
                disabled={data.assign.isPending}
                aria-busy={data.assign.isPending}
                onClick={() => transfer && void submit(transfer, true)}
              >
                {t(($) => $.model_configuration.transfer_confirm)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
}

// Only enabled keys with at least one compatible runtime can gain an owner.
function assignable(key: ModelDirectoryKey) {
  return (
    key.status === "enabled" &&
    key.allowedRuntimes.some((k) => modelRuntimeKinds.some((kind) => kind === k))
  );
}
