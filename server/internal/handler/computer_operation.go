package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/multica-ai/multica/server/internal/computer"
)

type remoteOperation struct {
	ID               string     `json:"id"`
	BindingID        string     `json:"binding_id"`
	Kind             string     `json:"kind"`
	RuntimeID        string     `json:"runtime_id"`
	RequestedVersion string     `json:"requested_version"`
	ActualVersion    string     `json:"actual_version"`
	State            string     `json:"state"`
	Step             string     `json:"step"`
	ErrorCode        string     `json:"error_code"`
	ErrorSummary     string     `json:"error_summary"`
	CreatedAt        time.Time  `json:"created_at"`
	StartedAt        *time.Time `json:"started_at"`
	FinishedAt       *time.Time `json:"finished_at"`
}

func insertComputerOperation(ctx context.Context, tx pgx.Tx, uid, bindingID, kind, runtimeID, version string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO computer_operation(binding_id,computer_id,username,user_id,kind,runtime_id,requested_version)
 SELECT id,computer_id,username,$2,$3,$4,$5 FROM computer_binding WHERE id=$1 RETURNING id::text`, bindingID, uid, kind, runtimeID, version).Scan(&id)
	return id, err
}

func (h *Handler) beginBindingOperation(ctx context.Context, uid, bindingID, kind, runtimeID, version string) (string, error) {
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var state string
	err = tx.QueryRow(ctx, `SELECT state FROM computer_binding WHERE id=$1 AND user_id=$2 AND archived_at IS NULL FOR UPDATE`, bindingID, uid).Scan(&state)
	if err != nil {
		return "", err
	}
	if (kind == "runtime_install" || kind == "runtime_discovery") && state != "ready" && state != "failed" {
		return "", errors.New("binding_not_ready")
	}
	if state == "running" {
		return "", errors.New("operation_busy")
	}
	id, err := insertComputerOperation(ctx, tx, uid, bindingID, kind, runtimeID, version)
	if err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func operationStartError(w http.ResponseWriter, err error) {
	if err.Error() == "binding_not_ready" {
		writeJSON(w, 409, map[string]string{"code": "binding_not_ready", "error": "Linux User binding changed; reload its details before retrying."})
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" || err.Error() == "operation_busy" {
		writeJSON(w, 409, map[string]string{"code": "operation_busy", "error": "Another operation is active for this Linux user; wait or inspect its recovery status."})
		return
	}
	writeError(w, 500, "Cannot save remote operation")
}

func (h *Handler) operationStep(id, step string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = h.DB.Exec(ctx, `UPDATE computer_operation SET step=$2 WHERE id=$1 AND state='running'`, id, step)
}

// A queued operation contains metadata only. Credentials live exclusively in
// the caller's goroutine and are never replayed after a process restart.
func (h *Handler) runRemoteOperation(id string, work func(context.Context) (string, error)) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	tag, err := h.DB.Exec(ctx, `UPDATE computer_operation SET state='running',started_at=now(),deadline_at=now()+interval '20 minutes',step='checking_account' WHERE id=$1 AND state='queued' AND deadline_at>now()`, id)
	if err != nil || tag.RowsAffected() != 1 {
		return
	}
	actual, code, state := "", "", "succeeded"
	defer func() {
		if recover() != nil {
			code = "interrupted"
			state = "interrupted"
		}
		finish, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		summary := ""
		if code != "" {
			summary = computer.ErrorSummary(code)
		}
		tx, err := h.TxStarter.Begin(finish)
		if err != nil {
			return
		}
		defer tx.Rollback(finish)
		tag, err := tx.Exec(finish, `UPDATE computer_operation SET state=$2,error_code=$3,error_summary=$4,actual_version=$5,finished_at=now() WHERE id=$1 AND state='running'`, id, state, code, summary, actual)
		if err != nil || tag.RowsAffected() != 1 {
			return
		}
		_, err = tx.Exec(finish, `INSERT INTO computer_audit(user_id,computer_id,binding_id,action,outcome) SELECT user_id,computer_id,binding_id,kind||CASE WHEN runtime_id='' THEN '' ELSE ':'||runtime_id||'@'||requested_version END,$2 FROM computer_operation WHERE id=$1`, id, state)
		if err == nil {
			_ = tx.Commit(finish)
		}
	}()
	actual, err = work(ctx)
	if err != nil {
		state = "failed"
		code = computer.ErrorCode(err, "remote_step_failed")
		var coded *computerOperationError
		if errors.As(err, &coded) {
			code = coded.code
		}
		if code == "cancelled" {
			state = "cancelled"
		}
	}
}

type computerOperationError struct{ code string }

func (e *computerOperationError) Error() string { return e.code }
func operationFailure(code string) error        { return &computerOperationError{code: code} }

func (h *Handler) bindingAccess(w http.ResponseWriter, r *http.Request, admin bool) (string, string, bool) {
	var uid string
	var ok bool
	if admin {
		uid, ok = requireInstanceAdmin(w, r)
	} else {
		uid, ok = requireUserID(w, r)
	}
	if !ok {
		return "", "", false
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "Binding ID")
	if !ok {
		return "", "", false
	}
	var exists bool
	err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM computer_binding WHERE id=$1 AND (user_id=$2 OR $3))`, id, uid, admin).Scan(&exists)
	if err != nil {
		writeError(w, 500, "Cannot read binding")
		return "", "", false
	}
	if !exists {
		writeError(w, 404, "Linux User binding not found")
		return "", "", false
	}
	w.Header().Set("Cache-Control", "no-store")
	return uid, uuidToString(id), true
}

func (h *Handler) ComputerBindingOperations(w http.ResponseWriter, r *http.Request) {
	h.bindingOperations(w, r, false)
}
func (h *Handler) AdminBindingOperations(w http.ResponseWriter, r *http.Request) {
	h.bindingOperations(w, r, true)
}
func (h *Handler) bindingOperations(w http.ResponseWriter, r *http.Request, admin bool) {
	_, id, ok := h.bindingAccess(w, r, admin)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT id::text,binding_id::text,kind,runtime_id,requested_version,actual_version,
 CASE WHEN state IN ('queued','running') AND deadline_at<now() THEN 'interrupted' ELSE state END,step,
 CASE WHEN state IN ('queued','running') AND deadline_at<now() THEN 'interrupted' ELSE error_code END,
 error_summary,created_at,started_at,finished_at FROM computer_operation WHERE binding_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`, id)
	if err != nil {
		writeError(w, 500, "Cannot read operation history")
		return
	}
	defer rows.Close()
	list := []remoteOperation{}
	for rows.Next() {
		var op remoteOperation
		if rows.Scan(&op.ID, &op.BindingID, &op.Kind, &op.RuntimeID, &op.RequestedVersion, &op.ActualVersion, &op.State, &op.Step, &op.ErrorCode, &op.ErrorSummary, &op.CreatedAt, &op.StartedAt, &op.FinishedAt) != nil {
			writeError(w, 500, "Cannot read operation")
			return
		}
		if op.ErrorCode == "interrupted" {
			op.ErrorSummary = computer.ErrorSummary(op.ErrorCode)
		}
		list = append(list, op)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Cannot read operations")
		return
	}
	writeJSON(w, 200, list)
}

// Recovery releases only expired metadata after explicit acknowledgment. It
// never replays a password or guesses whether the previous side effect succeeded.
func (h *Handler) RecoverComputerOperation(w http.ResponseWriter, r *http.Request) {
	uid, bindingID, ok := h.bindingAccess(w, r, false)
	if !ok {
		return
	}
	var in struct {
		ID     string `json:"operation_id"`
		Action string `json:"action"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&in) != nil {
		writeError(w, 400, "Invalid recovery")
		return
	}
	id, ok := parseUUIDOrBadRequest(w, in.ID, "Operation ID")
	if !ok {
		return
	}
	if in.Action != "acknowledge" && in.Action != "cancel" {
		writeError(w, 400, "Invalid recovery action")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "Cannot recover operation")
		return
	}
	defer tx.Rollback(r.Context())
	var state string
	err = tx.QueryRow(r.Context(), `UPDATE computer_operation SET state=CASE WHEN $4='cancel' THEN 'cancelled' ELSE 'interrupted' END,error_code=CASE WHEN $4='cancel' THEN 'cancelled' ELSE 'interrupted' END,finished_at=now()
 WHERE id=$1 AND binding_id=$2 AND user_id=$3 AND (($4='cancel' AND state='queued') OR ($4='acknowledge' AND state IN ('queued','running') AND deadline_at<now())) RETURNING state`, id, bindingID, uid, in.Action).Scan(&state)
	if err != nil {
		writeError(w, 409, "Only queued operations can be cancelled; acknowledge interrupted operations after their 20-minute safety window.")
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE computer_binding SET state='failed',last_error=$2,updated_at=now() WHERE id=$1 AND state='running'`, bindingID, computer.ErrorSummary(state))
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,binding_id,action,outcome) VALUES($1,$2,$3,$4)`, uid, bindingID, "operation_"+in.Action, state)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "Cannot recover operation")
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

// Older desktop clients expect installation to finish before the response.
// New clients explicitly request an asynchronous receipt; both use the same job.
func (h *Handler) runtimeInstallReceipt(w http.ResponseWriter, r *http.Request, id string) {
	if r.Header.Get("Prefer") == "respond-async" {
		w.Header().Set("Preference-Applied", "respond-async")
		writeJSON(w, 202, map[string]string{"operation_id": id, "state": "queued"})
		return
	}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		var state, code string
		err := h.DB.QueryRow(r.Context(), `SELECT state,error_code FROM computer_operation WHERE id=$1`, id).Scan(&state, &code)
		if err != nil {
			if r.Context().Err() == nil {
				writeError(w, 500, "Cannot read installation result")
			}
			return
		}
		switch state {
		case "succeeded":
			writeJSON(w, 200, map[string]bool{"installed": true})
			return
		case "failed", "cancelled", "interrupted":
			writeJSON(w, 502, map[string]string{"code": code, "error": computer.ErrorSummary(code), "operation_id": id})
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
