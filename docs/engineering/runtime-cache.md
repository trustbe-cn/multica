# Server runtime cache

Managed Linux-user installations use Multica Server as their runtime download
entry point. Version checks use the same cache as installer downloads. Cache
content is public upstream metadata and artifacts; account credentials and
installation capabilities are never written into cached files.

## Storage and eviction

`MULTICA_RUNTIME_CACHE_DIR` selects the directory. By default it is
`runtime-cache` under `MULTICA_COMPUTER_STATE_DIR`; when no Computer state directory
is configured it is under the OS user cache directory, `multica/runtime-cache`.
The self-host deployment's existing Computer state volume therefore retains
runtime downloads across application container replacements without a new volume.
Use a separate directory per server process; this cache does not coordinate
writers across replicas.

The cache limit is 10 GiB. Individual binaries are limited to 512 MiB and metadata
to 16 MiB, with at most three concurrent upstream downloads. Space is reserved
before downloading and older, less recently used entries are evicted first.
Metadata expires after one hour, immutable release files after 30 days. Successful
version checks live for one hour; failed version checks retry after one minute.
Downloads are deduplicated, hashed, written to temporary files, and published by
atomic rename. Restart cleanup removes incomplete temporary and orphaned files.

## Installation routing

`MULTICA_COMPUTER_SERVER_URL` must be reachable from managed Computers. npm
installations use a temporary server registry URL; package metadata is rewritten
at response time so tarballs also come from the server. Oh-My-Pi and Kimi installer
URLs and supported release URLs are rewritten through that same entry point.
Grok's installer script is cached, but other downloads made by its upstream
installer are not guaranteed to use the cache. The admin page displays this limit.

A six-minute, HMAC-authenticated capability binds download access to one active
`runtime_install` operation. Each request verifies its expiry, signature, operation
state and deadline, runtime identity, and allowed upstream origin/path. Completed
operations cannot continue downloading. Redirects are restricted to supported
origins and GitHub's release asset hosts. The service is not an arbitrary URL proxy.
Downloaded binaries are served unchanged; npm retains its own package integrity
checks. Hashes in the cache inventory identify stored bytes and are not vendor
signatures. No agent CLI is executed on the server to fill the cache.

## Management

The shared web/desktop Admin Area contains **Runtime cache**:

- Runtime release states and the download coverage for each provider.
- Cache usage, active downloads, and a paginated file inventory.
- Refresh versions: removes cached metadata and schedules new release checks.
- Clear cache: removes downloaded copies without uninstalling any CLI. It is
  rejected while a managed installation or download is active.

Admin API routes require an instance administrator:

- `GET /api/admin/runtime-cache`
- `POST /api/admin/runtime-cache/refresh`
- `DELETE /api/admin/runtime-cache`

Installer downloads use `GET`/`HEAD` on
`/api/runtime-downloads/{operation}/{expiry}/{signature}/{source}/*`.
Do not retain these temporary URLs in application data or expose them in UI copy.
A reverse proxy must forward this API path, including scoped npm package paths,
and allow sufficient upstream response time for a cold artifact download.

No schema migration is needed. Application rollback can retain or discard this
rebuildable cache; installed CLIs and Computer credentials are independent of it.
