# Self-hosted Computer provisioning

The personal **Settings → Computers** page registers Linux accounts and managed
Multica daemons. This feature is disabled until an operator supplies the settings
below. Workspace administrator roles do not grant access to another human's
credentials. Every saved Multica PAT must belong to the authenticated human.

Server configuration:

- `MULTICA_COMPUTER_SECRET_KEY`: a base64-encoded 32-byte encryption key. Preserve
  this separately from database backups; changing it requires re-entering credentials.
- `MULTICA_COMPUTER_OPERATOR_IDS`: comma-separated human UUIDs allowed to register
  Computers. This is a deployment-level operator list.
- `MULTICA_COMPUTER_SSH_KEY`: absolute path to the operator's private SSH key.
  Mount it read-only in the server container. Prepopulate that server user's SSH
  `known_hosts` from independently verified host keys; unknown or changed hosts fail.
- `MULTICA_COMPUTER_CLI_PATH`: trusted Linux executable built from this branch for
  the target architecture. It includes configurable per-user health ports. In the
  standard backend image this can point to `/app/multica` (check the image workdir).
- `MULTICA_COMPUTER_SERVER_URL`: fixed URL reachable from the target Computer.
- `MULTICA_COMPUTER_STATE_DIR`: private persistent directory owned by the backend
  service account, mode 0700. Contains per-machine/account locks and failed PAM
  attempt counters. Do not share it with employees or place it in their homes.

The server needs OpenSSH client access. Target Computers need Linux, Python 3,
PAM (`pam_unix.so`), `sudo`, `runuser`, user management tools and systemd. The
registered SSH operator requires passwordless sudo. Model CLIs must already be
available to each target user; this feature installs Multica, not vendor CLIs.

Before registering a target, its operator must install the fixed PAM service once
(outside request handling), owned by root and not writable by other users:

```sh
printf 'auth required pam_unix.so\naccount required pam_unix.so\n' > /tmp/multica-provision.pam
sudo install -o root -g root -m 0644 /tmp/multica-provision.pam /etc/pam.d/multica-provision
rm /tmp/multica-provision.pam
```

Authentication rejects a missing, symlinked, writable, or unexpected policy file;
it never creates or replaces the service while handling a request.

Existing accounts are reused only after PAM authentication and account checks.
System users, the SSH operator, privileged group members and sudo users are
refused. Five failed checks lock that username for 15 minutes after the last
counted attempt. Infrastructure failures do not count as wrong passwords.
Passwords travel on SSH stdin and are never stored in the database or logs.

Secrets are encrypted in the database and written with mode 0600 as the target
uid. Git identity is managed through an included file; unrelated Git helpers and
Multica JSON fields remain. Each binding uses its own `computer-<id>` CLI profile
and private workspace directory; the default CLI profile is not replaced.
Managed services use `UMask=0077` so newly created code is not world-readable. SSH Git auth requires a private key and independently
verified `known_hosts` entries. Environment keys are provider-allowlisted.

Operations run asynchronously on one bastion. A unique Computer/username binding
prevents concurrent jobs and ownership changes. A process interrupted by restart
shows `interrupted` after 20 minutes and can be retried; passwords are deliberately
not persisted for automatic replay. A managed daemon is reported ready only after
its registration matches owner, workspace, daemon ID and a recent heartbeat.
Port binding failure leaves a failed operation, never a false success.

Uninstall stops/disables the service and removes its managed unit/executable. It
keeps the Linux account, code, credential files and historical runtime registration.
Use the existing runtime deletion UI to delete registration records after unbinding
agents; provisioning does not bypass those dependency checks.

Before enabling on a real host, validate on an explicitly designated nonproduction
Computer/account: PAM match/mismatch/lockout, interrupted creation, symlink defense,
GitLab authentication and author identity, multiple users/Computers, daemon restart,
key synchronization and uninstall. Never aim the tests at the production operator.
