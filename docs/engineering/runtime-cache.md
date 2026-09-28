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
npm metadata requests negotiate the abbreviated install format, which retains
dependencies, optional platform packages, executable mappings, and integrity data
without full registry documents and readmes. Upstream downloads have a four-minute
deadline within the managed installer’s overall time limit.
Downloads are deduplicated, hashed, written to temporary files, and published by
atomic rename. Restart cleanup removes incomplete temporary and orphaned files.

## Installation routing

`MULTICA_COMPUTER_SERVER_URL` must be reachable from managed Computers. npm
installations use a temporary server registry URL; package metadata is rewritten
at response time so tarballs also come from the server. Oh-My-Pi and Kimi installer
URLs and supported release URLs are rewritten through that same entry point.
Kimi’s official `code.kimi.com` → `cdn.kimi.com` redirects are supported only
under `/kimi-code/`. OMP’s installer response extends its 30-second curl low-speed
window to 250 seconds so a cold cache can finish the binary download before
responding; stored upstream scripts remain unchanged.
Grok’s public installer, stable version pointer, and release files use the cache,
including its official `storage.googleapis.com/grok-build-public-artifacts/cli/`
source. Compressed and uncompressed Grok binaries use the artifact size limit
and support HEAD and byte-range requests. Vendor account/deployment API calls
remain outside this public artifact cache.

A six-minute, HMAC-authenticated capability binds download access to one active
`runtime_install` operation. Each request verifies its expiry, signature, operation
state and deadline, runtime identity, and allowed upstream origin/path. Completed
operations cannot continue downloading. Redirects are restricted to supported
origins and GitHub's release asset hosts. The service is not an arbitrary URL proxy.
Downloaded binaries are served unchanged; npm retains its own package integrity
checks. Hashes in the cache inventory identify stored bytes and are not vendor
signatures. No agent CLI is executed on the server to fill the cache.

## Upstream proxy

Set `MULTICA_RUNTIME_DOWNLOAD_PROXY` on the backend to an HTTP, HTTPS, SOCKS5,
or SOCKS5H proxy URL, including its port. For example,
`http://proxy.example:3128` or `socks5h://proxy.example:1080`.
This setting applies to runtime metadata, installers, artifacts, and upstream
redirects; installed Computers still download from Multica Server. Other backend
HTTP clients are unaffected. An empty value retains Go's standard `HTTP_PROXY`,
`HTTPS_PROXY`, and `NO_PROXY` behavior. Invalid non-empty configuration fails the
download instead of silently connecting directly.

Keep proxy credentials in deployment secrets/environment configuration. Do not
commit authenticated proxy URLs. HTTPS proxy certificates must match the proxy
hostname. Configure this variable in the backend container's environment, then
recreate that service after active Computer operations finish.

For an SSH egress host, run a persistent `ssh -N -D` client alongside the backend
and use `socks5h://runtime-proxy:1080` on the private Compose network. Pin the SSH
host key, mount a dedicated forwarding key, and restrict that account to the
approved upstream hosts on port 443. Keep the SOCKS port unpublished; configure
SSH keepalives and container restart so interrupted tunnels reconnect. Deployment
keys, service definitions, and rollback records belong in the separate deployment
checkout, not this repository.

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
Failed Linux-user operation rows offer **Copy error information** with the operation
ID, runtime, versions, failure stage/code, safe summary, and UTC timestamps. Use
the operation ID to correlate server download warnings; copied summaries contain
no raw SSH output or temporary download capabilities. A download failure can mean
network failure, rejected upstream redirects, or cache limits; consult the server
log rather than assuming a connectivity problem.

Do not retain these temporary URLs in application data or expose them in UI copy.
A reverse proxy must forward this API path, including scoped npm package paths,
and allow sufficient upstream response time for a cold artifact download.

No schema migration is needed. Application rollback can retain or discard this
rebuildable cache; installed CLIs and Computer credentials are independent of it.
