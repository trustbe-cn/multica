package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/computer"
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
		tx, err := h.TxStarter.Begin(r.Context())
		if err != nil {
			writeError(w, 500, "Cannot register Computer")
			return
		}
		defer tx.Rollback(r.Context())
		var id string
		err = tx.QueryRow(r.Context(), `INSERT INTO computer(name,host,port,ssh_user,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id::text`, in.Name, in.Host, in.Port, in.SSHUser, uid).Scan(&id)
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
		writeJSON(w, 201, map[string]string{"id": id})
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT id::text,name,host,port,ssh_user,enabled FROM computer ORDER BY name,id`)
	if err != nil {
		writeError(w, 500, "Cannot list Computers")
		return
	}
	defer rows.Close()
	list := []adminComputer{}
	for rows.Next() {
		var m adminComputer
		if rows.Scan(&m.ID, &m.Name, &m.Host, &m.Port, &m.SSHUser, &m.Enabled) != nil {
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
