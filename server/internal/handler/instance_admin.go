package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/computer"
	"github.com/multica-ai/multica/server/pkg/agent"
)

// Explicit instance configuration takes precedence, including an explicitly
// empty value. Legacy Computer operators bootstrap admins only when unset.
// Workspace roles never grant instance-level privileges.
func isInstanceAdmin(uid string) bool {
	if uid == "" {
		return false
	}
	ids, configured := os.LookupEnv("MULTICA_INSTANCE_ADMIN_IDS")
	if !configured {
		ids = os.Getenv("MULTICA_COMPUTER_OPERATOR_IDS")
	}
	for _, id := range strings.Split(ids, ",") {
		if strings.TrimSpace(id) == uid {
			return true
		}
	}
	return false
}
func requireInstanceAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	uid, ok := requireUserID(w, r)
	if !ok {
		return "", false
	}
	w.Header().Set("Cache-Control", "no-store")
	if !isInstanceAdmin(uid) {
		writeError(w, 403, "Instance administrator access required")
		return "", false
	}
	return uid, true
}
func (h *Handler) InstanceAccess(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireUserID(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]bool{"admin": isInstanceAdmin(uid)})
}

type adminComputer struct {
	computer.Machine
	Enabled bool `json:"enabled"`
	// Registration and last-check metadata for the admin list. Secrets never
	// appear here: only who registered it and how the last probe went.
	CreatedBy     string     `json:"created_by,omitempty"`
	CreatedByName string     `json:"created_by_name,omitempty"`
	CreatedAt     *time.Time `json:"created_at,omitempty"`
	CheckedAt     *time.Time `json:"checked_at,omitempty"`
	CheckOK       *bool      `json:"check_ok,omitempty"`
	CheckDetail   string     `json:"check_detail,omitempty"`
	Bindings      int        `json:"bindings"`
}

const adminComputerColumns = `SELECT c.id::text,c.name,c.host,c.port,c.ssh_user,c.enabled,
 c.created_by::text,COALESCE(u.name,c.created_by::text),c.created_at,
 c.checked_at,c.check_ok,c.check_detail,
 (SELECT count(*) FROM computer_binding b WHERE b.computer_id=c.id)
 FROM computer c LEFT JOIN "user" u ON u.id=c.created_by`

func scanAdminComputer(row pgx.Row) (adminComputer, error) {
	var m adminComputer
	err := row.Scan(&m.ID, &m.Name, &m.Host, &m.Port, &m.SSHUser, &m.Enabled,
		&m.CreatedBy, &m.CreatedByName, &m.CreatedAt,
		&m.CheckedAt, &m.CheckOK, &m.CheckDetail, &m.Bindings)
	return m, err
}

func (h *Handler) AdminComputers(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodPost {
		var in computer.Machine
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in) != nil {
			writeError(w, 400, "Invalid Computer")
			return
		}
		if err := in.Validate(); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		// Do not take a registration on trust: a Computer that fails the check
		// is never stored, so the registry cannot hold unusable machines.
		probe, probeErr := probeMachine(in)
		if probeErr != nil {
			writeError(w, 503, probeErr.Error())
			return
		}
		if !probe.OK {
			writeJSON(w, 422, map[string]any{"error": "Computer did not pass the connection check", "code": "computer_check_failed", "probe": probe})
			return
		}
		tx, err := h.TxStarter.Begin(r.Context())
		if err != nil {
			writeError(w, 500, "Cannot register Computer")
			return
		}
		defer tx.Rollback(r.Context())
		var id string
		err = tx.QueryRow(r.Context(), `INSERT INTO computer(name,host,port,ssh_user,created_by,checked_at,check_ok) VALUES($1,$2,$3,$4,$5,now(),true) RETURNING id::text`, in.Name, in.Host, in.Port, in.SSHUser, uid).Scan(&id)
		if err == nil {
			_, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,computer_id,action,outcome) VALUES($1,$2,'register','success')`, uid, id)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			writeError(w, 500, "Cannot register Computer")
			return
		}
		writeJSON(w, 201, map[string]any{"id": id, "probe": probe})
		return
	}
	rows, err := h.DB.Query(r.Context(), adminComputerColumns+` ORDER BY c.name,c.id`)
	if err != nil {
		writeError(w, 500, "Cannot list Computers")
		return
	}
	defer rows.Close()
	list := []adminComputer{}
	for rows.Next() {
		m, err := scanAdminComputer(rows)
		if err != nil {
			writeError(w, 500, "Cannot read Computer")
			return
		}
		list = append(list, m)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Cannot list Computers")
		return
	}
	writeJSON(w, 200, list)
}
func (h *Handler) UpdateAdminComputer(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "Computer ID")
	if !ok {
		return
	}
	var in struct {
		Name    *string `json:"name"`
		Host    *string `json:"host"`
		Port    *int    `json:"port"`
		SSHUser *string `json:"ssh_user"`
		Enabled *bool   `json:"enabled"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil {
		writeError(w, 400, "Invalid Computer update")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "Cannot update Computer")
		return
	}
	defer tx.Rollback(r.Context())
	var m adminComputer
	err = tx.QueryRow(r.Context(), `SELECT name,host,port,ssh_user,enabled FROM computer WHERE id=$1 FOR UPDATE`, id).Scan(&m.Name, &m.Host, &m.Port, &m.SSHUser, &m.Enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "Computer not found")
		return
	}
	if err != nil {
		writeError(w, 500, "Cannot read Computer")
		return
	}
	old := m
	if in.Name != nil {
		m.Name = *in.Name
	}
	if in.Host != nil {
		m.Host = *in.Host
	}
	if in.Port != nil {
		m.Port = *in.Port
	}
	if in.SSHUser != nil {
		m.SSHUser = *in.SSHUser
	}
	if in.Enabled != nil {
		m.Enabled = *in.Enabled
	}
	if err = m.Machine.Validate(); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	// Existing bindings identify OS accounts on a specific machine. Never
	// silently repoint them at a different host or privileged SSH identity.
	if old.Host != m.Host || old.Port != m.Port || old.SSHUser != m.SSHUser {
		var bound bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM computer_binding WHERE computer_id=$1)`, id).Scan(&bound)
		if err != nil {
			writeError(w, 500, "Cannot check bindings")
			return
		}
		if bound {
			writeError(w, 409, "Connection cannot change after account binding; register a new Computer")
			return
		}
	}
	_, err = tx.Exec(r.Context(), `UPDATE computer SET name=$2,host=$3,port=$4,ssh_user=$5,enabled=$6 WHERE id=$1`, id, m.Name, m.Host, m.Port, m.SSHUser, m.Enabled)
	action := "update"
	if in.Enabled != nil && old.Enabled != m.Enabled {
		if m.Enabled {
			action = "enable"
		} else {
			action = "disable"
		}
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,computer_id,action,outcome) VALUES($1,$2,$3,'success')`, uid, id, action)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "Cannot update Computer")
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

// probeMachine is a variable so tests can supply a verdict without a real
// machine. Production always uses sshProbe.
var probeMachine = sshProbe

// sshProbe runs the read-only connectivity probe. Only the SSH key is
// required: a probe installs nothing, so the provisioning artifact and state
// directory are not needed yet.
func sshProbe(m computer.Machine) (computer.ProbeResult, error) {
	keyPath := os.Getenv("MULTICA_COMPUTER_SSH_KEY")
	if keyPath == "" {
		return computer.ProbeResult{}, errors.New("Computer provisioning is not configured")
	}
	remote := computer.SSHRemote{Host: m.Host, Port: m.Port, User: m.SSHUser, KeyPath: keyPath, Timeout: 45 * time.Second}
	return remote.Probe()
}

// CheckAdminComputerDraft probes connection details that are not saved yet so
// an admin sees the verdict before registering a Computer.
func (h *Handler) CheckAdminComputerDraft(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	var in computer.Machine
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in) != nil {
		writeError(w, 400, "Invalid Computer")
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	res, err := probeMachine(in)
	if err != nil {
		writeError(w, 503, err.Error())
		return
	}
	writeJSON(w, 200, res)
}

// CheckAdminComputer probes a registered Computer and records the verdict.
func (h *Handler) CheckAdminComputer(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "Computer ID")
	if !ok {
		return
	}
	var m computer.Machine
	err := h.DB.QueryRow(r.Context(), `SELECT host,port,ssh_user FROM computer WHERE id=$1`, id).Scan(&m.Host, &m.Port, &m.SSHUser)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "Computer not found")
		return
	}
	if err != nil {
		writeError(w, 500, "Cannot read Computer")
		return
	}
	res, err := probeMachine(m)
	if err != nil {
		writeError(w, 503, err.Error())
		return
	}
	outcome := "failure"
	if res.OK {
		outcome = "success"
	}
	if _, err = h.DB.Exec(r.Context(), `UPDATE computer SET checked_at=now(),check_ok=$2,check_detail=$3 WHERE id=$1`, id, res.OK, failedCheckSummary(res)); err != nil {
		writeError(w, 500, "Cannot record check")
		return
	}
	// A recorded probe is an admin action against a specific Computer.
	_, _ = h.DB.Exec(r.Context(), `INSERT INTO computer_audit(user_id,computer_id,action,outcome) VALUES($1,$2,'check',$3)`, uid, id, outcome)
	writeJSON(w, 200, res)
}

// AdminSshPubKey returns the public key that the backend uses to log into
// managed Computers. Admins need it to add the key to a machine's
// authorized_keys before registering it.
func (h *Handler) AdminSshPubKey(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	keyPath := os.Getenv("MULTICA_COMPUTER_SSH_KEY")
	if keyPath == "" {
		writeError(w, 503, "Computer provisioning is not configured")
		return
	}
	// Try <keyPath>.pub first; fall back to deriving the public key from the
	// private key so that different key-file layouts both work.
	pubPath := keyPath + ".pub"
	data, err := os.ReadFile(pubPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			writeError(w, 503, "SSH public key file cannot be read")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		data, err = exec.CommandContext(ctx, "ssh-keygen", "-y", "-P", "", "-f", keyPath).Output()
		if err != nil {
			writeError(w, 503, "SSH public key could not be derived")
			return
		}
	}
	writeJSON(w, 200, map[string]string{"pubkey": strings.TrimSpace(string(data))})
}

// failedCheckSummary keeps the stored detail short and only about failures.
func failedCheckSummary(res computer.ProbeResult) string {
	parts := []string{}
	for _, c := range res.Checks {
		if !c.OK {
			part := c.Name
			if c.Detail != "" {
				part += ": " + c.Detail
			}
			parts = append(parts, part)
		}
	}
	summary := strings.Join(parts, "; ")
	if len(summary) > 500 {
		summary = summary[:500]
	}
	return summary
}

// DeleteAdminComputer removes a Computer that has no account bound to it.
// Audit rows are deliberately kept: computer_id has no foreign key, so the
// history of a removed Computer stays readable.
func (h *Handler) DeleteAdminComputer(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "Computer ID")
	if !ok {
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "Cannot delete Computer")
		return
	}
	defer tx.Rollback(r.Context())
	var name string
	err = tx.QueryRow(r.Context(), `SELECT name FROM computer WHERE id=$1 FOR UPDATE`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "Computer not found")
		return
	}
	if err != nil {
		writeError(w, 500, "Cannot read Computer")
		return
	}
	// A binding names a real OS account on that machine. Deleting the Computer
	// would orphan it and leave the account installed with no way back.
	var bound int
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM computer_binding WHERE computer_id=$1`, id).Scan(&bound); err != nil {
		writeError(w, 500, "Cannot check bindings")
		return
	}
	if bound > 0 {
		writeError(w, 409, "Computer still has bound accounts; remove them before deleting")
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM computer WHERE id=$1`, id); err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,computer_id,action,outcome) VALUES($1,$2,'delete','success')`, uid, id)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "Cannot delete Computer")
		return
	}
	writeJSON(w, 200, map[string]bool{"deleted": true})
}

func (h *Handler) AdminComputerBindings(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT b.id::text,b.computer_id::text,COALESCE(b.workspace_id::text,''),b.username,b.state,b.last_error,b.user_id::text,COALESCE(u.name,b.user_id::text) FROM computer_binding b LEFT JOIN "user" u ON u.id=b.user_id ORDER BY b.updated_at DESC,b.id LIMIT 500`)
	if err != nil {
		writeError(w, 500, "Cannot list bindings")
		return
	}
	defer rows.Close()
	type binding struct {
		computerBinding
		UserID   string `json:"user_id"`
		UserName string `json:"user_name"`
	}
	list := []binding{}
	for rows.Next() {
		var b binding
		if rows.Scan(&b.ID, &b.ComputerID, &b.WorkspaceID, &b.Username, &b.State, &b.LastError, &b.UserID, &b.UserName) != nil {
			writeError(w, 500, "Cannot read binding")
			return
		}
		list = append(list, b)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Cannot list bindings")
		return
	}
	writeJSON(w, 200, list)
}

// runtimeVersionRE accepts only the characters npm/semver versions use.
// It prevents shell-special characters from reaching the install command.
var runtimeVersionRE = regexp.MustCompile(`^[0-9A-Za-z.\-+]+$`)

// AdminComputerRuntimes lists all built-in runtimes and their installed versions
// on the target computer. When linux_user is supplied, probing runs in that
// user's environment so it matches the installation endpoint.
func (h *Handler) AdminComputerRuntimes(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "Computer ID")
	if !ok {
		return
	}
	var m computer.Machine
	err := h.DB.QueryRow(r.Context(), `SELECT host,port,ssh_user FROM computer WHERE id=$1`, id).Scan(&m.Host, &m.Port, &m.SSHUser)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "Computer not found")
		return
	}
	if err != nil {
		writeError(w, 500, "Cannot read Computer")
		return
	}
	keyPath := os.Getenv("MULTICA_COMPUTER_SSH_KEY")
	if keyPath == "" {
		writeError(w, 503, "Computer provisioning is not configured")
		return
	}
	remote := computer.SSHRemote{Host: m.Host, Port: m.Port, User: m.SSHUser, KeyPath: keyPath, Timeout: 30 * time.Second}
	linuxUser := strings.TrimSpace(r.URL.Query().Get("linux_user"))
	if linuxUser != "" {
		if err := computer.ValidateLinuxUsername(linuxUser); err != nil {
			writeError(w, 400, "Invalid linux_user: "+err.Error())
			return
		}
	}

	type runtimeInfo struct {
		ID               string `json:"id"`
		DisplayName      string `json:"display_name"`
		InstalledVersion string `json:"installed_version"`
		CanInstall       bool   `json:"can_install"`
		VersionRequired  bool   `json:"version_required"`
		ProbeError       string `json:"probe_error,omitempty"`
	}
	probeRuntime := func(id, displayName, defaultCmd, installCmd string, versionRequired bool) runtimeInfo {
		info := runtimeInfo{
			ID:              id,
			DisplayName:     displayName,
			CanInstall:      installCmd != "",
			VersionRequired: versionRequired,
		}
		probe := "if command -v " + defaultCmd + " >/dev/null 2>&1; then " + defaultCmd + " --version || { echo 'Executable found, but --version failed' >&2; exit 1; }; fi"
		if linuxUser != "" {
			probe = "sudo -n runuser -u " + linuxUser + " -- sh -c " + computerShellQuote("export PATH=\"$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.grok/bin:/usr/local/bin:/usr/bin:/bin\"; "+probe)
		}
		out, err := remote.RunCommandContext(r.Context(), probe)
		if err == nil {
			info.InstalledVersion = strings.TrimSpace(out)
		} else {
			info.ProbeError = "Version check failed: " + err.Error()
		}
		return info
	}
	type runtimeTarget struct {
		id, displayName, defaultCmd, installCmd string
		versionRequired                         bool
	}
	targets := make([]runtimeTarget, 0, len(agent.BuiltinRuntimes)+len(agent.ProtocolFamilyInstalls))
	for _, rt := range agent.BuiltinRuntimes {
		targets = append(targets, runtimeTarget{rt.ID, rt.DisplayName, rt.DefaultCommand, rt.InstallCommand, !rt.LatestOnly})
	}
	for _, rt := range agent.ProtocolFamilyInstalls {
		targets = append(targets, runtimeTarget{rt.ID, rt.DisplayName, rt.DefaultCommand, rt.InstallCommand, !rt.LatestOnly})
	}
	list := make([]runtimeInfo, len(targets))
	var wg sync.WaitGroup
	for i, target := range targets {
		wg.Add(1)
		go func() {
			defer wg.Done()
			list[i] = probeRuntime(target.id, target.displayName, target.defaultCmd, target.installCmd, target.versionRequired)
		}()
	}
	wg.Wait()
	writeJSON(w, 200, list)
}

// AdminComputerRuntimeInstall installs or upgrades a built-in runtime to the
// requested version on the target computer. The install command runs as root
// via sudo, which then uses runuser to switch to the target Linux user account,
// keeping the installation in that user's private npm prefix.
func (h *Handler) AdminComputerRuntimeInstall(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "Computer ID")
	if !ok {
		return
	}
	var in struct {
		RuntimeID string `json:"runtime_id"`
		Version   string `json:"version"`
		LinuxUser string `json:"linux_user"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil {
		writeError(w, 400, "Invalid request body")
		return
	}
	rt, exists := agent.BuiltinRuntimeByID(in.RuntimeID)
	var installCmd string
	versionRequired := true
	if exists {
		installCmd = rt.InstallCommand
		versionRequired = !rt.LatestOnly
	} else {
		pf, pfExists := agent.ProtocolFamilyInstallByID(in.RuntimeID)
		if !pfExists {
			writeError(w, 400, fmt.Sprintf("Unknown runtime %q", in.RuntimeID))
			return
		}
		installCmd = pf.InstallCommand
		versionRequired = !pf.LatestOnly
	}
	if installCmd == "" {
		writeError(w, 422, fmt.Sprintf("Runtime %q does not support installation via the admin UI", in.RuntimeID))
		return
	}
	if err := computer.ValidateLinuxUsername(in.LinuxUser); err != nil {
		writeError(w, 400, "Invalid linux_user: "+err.Error())
		return
	}
	if versionRequired && (!runtimeVersionRE.MatchString(in.Version) || in.Version == "") {
		writeError(w, 400, "Invalid version: only alphanumeric, dot, hyphen, and plus are allowed")
		return
	}
	if !versionRequired {
		if in.Version != "" && in.Version != "latest" {
			writeError(w, 422, "This runtime only supports latest; omit version or use latest")
			return
		}
		in.Version = "latest"
	}

	var m computer.Machine
	err := h.DB.QueryRow(r.Context(), `SELECT host,port,ssh_user FROM computer WHERE id=$1`, id).Scan(&m.Host, &m.Port, &m.SSHUser)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "Computer not found")
		return
	}
	if err != nil {
		writeError(w, 500, "Cannot read Computer")
		return
	}
	keyPath := os.Getenv("MULTICA_COMPUTER_SSH_KEY")
	if keyPath == "" {
		writeError(w, 503, "Computer provisioning is not configured")
		return
	}

	cmd := strings.ReplaceAll(installCmd, "{{user}}", in.LinuxUser)
	cmd = strings.ReplaceAll(cmd, "{{version}}", in.Version)
	remote := computer.SSHRemote{Host: m.Host, Port: m.Port, User: m.SSHUser, KeyPath: keyPath, Timeout: 5 * time.Minute}
	_, installErr := remote.RunCommandContext(r.Context(), "sudo -n "+cmd)

	outcome := "success"
	if installErr != nil {
		outcome = "failure"
	}
	action := "runtime_install:" + in.RuntimeID + "@" + in.Version
	// A disconnected client must not erase the audit of its remote operation.
	auditCtx, cancelAudit := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	defer cancelAudit()
	_, _ = h.DB.Exec(auditCtx, `INSERT INTO computer_audit(user_id,computer_id,action,outcome) VALUES($1,$2,$3,$4)`, uid, id, action, outcome)

	if installErr != nil {
		writeError(w, 502, "Install failed: "+installErr.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"installed": true})
}

func computerShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func (h *Handler) AdminComputerAudit(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT a.id::text,a.user_id::text,COALESCE(u.name,a.user_id::text),COALESCE(a.computer_id::text,b.computer_id::text,''),COALESCE(a.binding_id::text,''),a.action,a.outcome,a.created_at FROM computer_audit a LEFT JOIN computer_binding b ON b.id=a.binding_id LEFT JOIN "user" u ON u.id=a.user_id ORDER BY a.created_at DESC,a.id LIMIT 200`)
	if err != nil {
		writeError(w, 500, "Cannot list audit")
		return
	}
	defer rows.Close()
	type entry struct {
		ID         string    `json:"id"`
		UserID     string    `json:"user_id"`
		UserName   string    `json:"user_name"`
		ComputerID string    `json:"computer_id"`
		BindingID  string    `json:"binding_id"`
		Action     string    `json:"action"`
		Outcome    string    `json:"outcome"`
		CreatedAt  time.Time `json:"created_at"`
	}
	list := []entry{}
	for rows.Next() {
		var e entry
		if rows.Scan(&e.ID, &e.UserID, &e.UserName, &e.ComputerID, &e.BindingID, &e.Action, &e.Outcome, &e.CreatedAt) != nil {
			writeError(w, 500, "Cannot read audit")
			return
		}
		list = append(list, e)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Cannot list audit")
		return
	}
	writeJSON(w, 200, list)
}
