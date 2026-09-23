package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/computer"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
)

type computerBinding struct {
	HealthPort  int    `json:"-"`
	ID          string `json:"id"`
	ComputerID  string `json:"computer_id"`
	WorkspaceID string `json:"workspace_id"`
	Username    string `json:"username"`
	State       string `json:"state"`
	LastError   string `json:"last_error"`
}

func (h *Handler) ComputerBindings(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireUserID(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		rows, err := h.DB.Query(r.Context(), `SELECT id::text,computer_id::text,COALESCE(workspace_id::text,''),username,CASE WHEN state='running' AND updated_at<now()-interval '20 minutes' THEN 'interrupted' ELSE state END,last_error FROM computer_binding WHERE user_id=$1 ORDER BY updated_at DESC`, uid)
		if err != nil {
			writeError(w, 500, "Cannot read your Computers")
			return
		}
		defer rows.Close()
		list := []computerBinding{}
		for rows.Next() {
			var b computerBinding
			if rows.Scan(&b.ID, &b.ComputerID, &b.WorkspaceID, &b.Username, &b.State, &b.LastError) != nil {
				writeError(w, 500, "Cannot read binding")
				return
			}
			list = append(list, b)
		}
		if rows.Err() != nil {
			writeError(w, 500, "Cannot read bindings")
			return
		}
		writeJSON(w, 200, list)
		return
	}
	var in struct {
		ComputerID  string `json:"computer_id"`
		WorkspaceID string `json:"workspace_id"`
		Username    string `json:"username"`
		Password    string `json:"password"`
		Action      string `json:"action"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&in) != nil {
		writeError(w, 400, "Invalid operation")
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, in.ComputerID, "computer_id"); !ok {
		return
	}
	if _, ok := parseUUIDOrBadRequest(w, in.WorkspaceID, "workspace_id"); !ok {
		return
	}
	if in.Action != "provision" && in.Action != "sync" && in.Action != "upgrade" && in.Action != "remove" {
		writeError(w, 400, "Invalid operation")
		return
	}
	if _, err := computer.Decide(computer.Input{Username: in.Username}); err != nil {
		writeError(w, 400, "Invalid Linux username")
		return
	}
	if len(in.Password) < 1 || len(in.Password) > 4096 {
		writeError(w, 400, "Linux password is required")
		return
	}
	if _, ok := h.requireWorkspaceMember(w, r, in.WorkspaceID, "Workspace membership required"); !ok {
		return
	}
	key, err := secretbox.LoadKey("MULTICA_COMPUTER_SECRET_KEY")
	if err != nil {
		writeError(w, 503, "Computer provisioning is not configured")
		return
	}
	box, err := secretbox.New(key)
	if err != nil {
		writeError(w, 503, "Computer provisioning is not configured")
		return
	}
	var cipher []byte
	if h.DB.QueryRow(r.Context(), `SELECT ciphertext FROM computer_credential WHERE user_id=$1`, uid).Scan(&cipher) != nil {
		writeError(w, 400, "Save your credentials first")
		return
	}
	plain, err := box.Open(cipher)
	if err != nil {
		writeError(w, 500, "Cannot decrypt settings")
		return
	}
	var saved struct {
		Owner    string            `json:"owner"`
		Settings computer.Settings `json:"settings"`
	}
	if json.Unmarshal(plain, &saved) != nil || saved.Owner != uid {
		writeError(w, 500, "Invalid settings owner")
		return
	}
	settings := saved.Settings
	pat, err := h.Queries.GetPersonalAccessTokenByHash(r.Context(), auth.HashToken(settings.MulticaPAT))
	if err != nil || uuidToString(pat.UserID) != uid {
		writeError(w, 400, "Multica token must be valid and belong to you")
		return
	}
	var m computer.Machine
	err = h.DB.QueryRow(r.Context(), `SELECT id::text,name,host,port,ssh_user FROM computer WHERE id=$1 AND enabled`, in.ComputerID).Scan(&m.ID, &m.Name, &m.Host, &m.Port, &m.SSHUser)
	if err != nil {
		writeError(w, 404, "Computer unavailable")
		return
	}
	serverURL := os.Getenv("MULTICA_COMPUTER_SERVER_URL")
	keyPath := os.Getenv("MULTICA_COMPUTER_SSH_KEY")
	binary := os.Getenv("MULTICA_COMPUTER_CLI_PATH")
	lockDir := os.Getenv("MULTICA_COMPUTER_STATE_DIR")
	if serverURL == "" || keyPath == "" || binary == "" || lockDir == "" {
		writeError(w, 503, "Computer provisioning is not configured")
		return
	}
	if in.Action != "provision" {
		var owned bool
		if h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM computer_binding WHERE computer_id=$1 AND username=$2 AND user_id=$3 AND (workspace_id=$4 OR $5='remove') AND verified)`, m.ID, in.Username, uid, in.WorkspaceID, in.Action).Scan(&owned) != nil || !owned {
			writeError(w, 404, "Create or reuse this account first")
			return
		}
	}
	// The unique machine/account record is also the ownership boundary. Failed
	// attempts never let a second caller race the first caller's remote job.
	var b computerBinding
	err = h.DB.QueryRow(r.Context(), claimComputerBindingSQL, m.ID, uid, in.WorkspaceID, in.Username, in.Action).Scan(&b.ID, &b.ComputerID, &b.WorkspaceID, &b.Username, &b.State, &b.LastError, &b.HealthPort)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 409, "This account is already bound or an operation is running")
		return
	}
	if err != nil {
		writeError(w, 500, "Cannot start operation")
		return
	}
	remote := computer.SSHRemote{Host: m.Host, Port: m.Port, User: m.SSHUser, KeyPath: keyPath, BinaryPath: binary, DaemonID: b.ID, HealthPort: b.HealthPort, WorkspaceID: b.WorkspaceID, Timeout: 90 * time.Second}
	req := computer.Request{ComputerID: m.ID, ServerURL: serverURL, Username: in.Username, Password: in.Password, GitName: settings.GitName, GitEmail: settings.GitEmail, GitLabURL: settings.GitLabURL, GitLabToken: settings.GitLabToken, GitSSHKey: settings.GitSSHKey, GitKnownHosts: settings.GitKnownHosts, ModelEnv: settings.ModelEnv, MulticaPAT: settings.MulticaPAT, FailureLimit: 5}
	action := in.Action
	go h.runComputerOperation(uid, b, remote, &computer.FileStore{Dir: lockDir}, req, action)
	writeJSON(w, 202, b)
}

func (h *Handler) runComputerOperation(uid string, b computerBinding, remote computer.SSHRemote, store *computer.FileStore, req computer.Request, action string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	state, message := "failed", "Operation failed; check the Computer connection and configuration, then retry"
	defer func() {
		if recover() != nil {
			state = "failed"
			message = "Operation interrupted; retry after checking the Computer"
		}
		finish, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = h.DB.Exec(finish, `UPDATE computer_binding SET state=$2,last_error=$3,updated_at=now() WHERE id=$1`, b.ID, state, message)
		_, _ = h.DB.Exec(finish, `INSERT INTO computer_audit(user_id,binding_id,action,outcome) VALUES($1,$2,$3,$4)`, uid, b.ID, action, state)
	}()
	if action == "remove" {
		err := store.WithKey(b.ComputerID, b.Username, func(a computer.Attempt) error {
			_, allowed, err := a.Reserve(5)
			if err != nil {
				return err
			}
			if !allowed {
				return errors.New("locked")
			}
			ok, err := remote.PasswordMatches(b.Username, req.Password)
			if err != nil {
				_ = a.Refund()
				return err
			}
			if !ok {
				return errors.New("password mismatch")
			}
			if err = a.Reset(); err != nil {
				return err
			}
			return remote.RemoveDaemon(b.Username)
		})
		if err == nil {
			state = "removed"
			message = ""
		}
		return
	}
	result, err := computer.Apply(remote, store, req)
	if err != nil {
		return
	}
	if result.Action == computer.ActionLocked {
		message = "Too many password attempts; retry after 15 minutes"
		return
	}
	if result.Action == computer.ActionRename {
		message = "Password did not match; retry or choose another username"
		return
	}
	_, _ = h.DB.Exec(ctx, `UPDATE computer_binding SET verified=true WHERE id=$1`, b.ID)
	// A live registration by this exact user/workspace/daemon is the success gate.
	deadline := time.NewTimer(90 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		var online bool
		err := h.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM agent_runtime WHERE daemon_id=$1 AND owner_id=$2 AND workspace_id=$3 AND status='online' AND last_seen_at>now()-interval '30 seconds')`, b.ID, uid, b.WorkspaceID).Scan(&online)
		if err == nil && online {
			state = "ready"
			message = ""
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-deadline.C:
			message = "Daemon has not registered in your workspace; check connectivity and retry"
			return
		case <-ticker.C:
		}
	}
}

// A failed, unverified attempt is not ownership of an OS account. It may be
// retried by another human, who must still pass PAM. Verified ownership never
// transfers, including after failure or uninstall. Running jobs never overlap.
const claimComputerBindingSQL = `
INSERT INTO computer_binding(computer_id,user_id,workspace_id,username,state,health_port)
VALUES($1,$2,$3,$4,'running',CASE
  WHEN EXISTS (SELECT 1 FROM computer_binding WHERE computer_id=$1 AND username=$4)
  THEN (SELECT health_port FROM computer_binding WHERE computer_id=$1 AND username=$4)
  ELSE nextval('computer_health_port_seq') END)
ON CONFLICT(computer_id,username) DO UPDATE SET
 user_id=EXCLUDED.user_id,
 workspace_id=CASE
  WHEN NOT computer_binding.verified
    OR ($5='provision' AND computer_binding.state IN ('removed','detached'))
  THEN $3 ELSE computer_binding.workspace_id END,
 health_port=CASE WHEN computer_binding.state='failed'
  THEN EXCLUDED.health_port ELSE computer_binding.health_port END,
 state='running',last_error='',updated_at=now()
WHERE (
 (computer_binding.user_id=$2 AND
  (computer_binding.workspace_id=$3 OR $5='remove' OR computer_binding.state IN ('removed','detached')))
 OR (NOT computer_binding.verified AND computer_binding.state='failed' AND $5='provision')
) AND (computer_binding.state<>'running' OR computer_binding.updated_at<now()-interval '20 minutes')
RETURNING id::text,computer_id::text,COALESCE(workspace_id::text,''),username,state,last_error,health_port
`
