package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/sub2api"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
)

const modelKeySourceID = 1

const modelKeyMaxRetryAfter = 15 * time.Minute

func (h *Handler) modelKeyHTTPClient() *http.Client {
	if h.modelKeyClient != nil {
		return h.modelKeyClient
	}
	return &http.Client{Timeout: 20 * time.Second}
}
func modelKeyBox() (*secretbox.Box, error) {
	key, e := secretbox.LoadKey("MULTICA_COMPUTER_SECRET_KEY")
	if e != nil {
		return nil, errors.New("source_encryption_unavailable")
	}
	return secretbox.New(key)
}
func modelKeyErrorCode(err error) string {
	if err == nil {
		return "model_key_operation_failed"
	}
	// Only errors from the upstream client have a stable sub2api code. An
	// arbitrary database or transaction error must not be misreported as a
	// user-fixable upstream failure.
	var upstream *sub2api.Error
	if errors.As(err, &upstream) {
		return upstream.Code
	}
	for _, known := range []string{"source_not_configured", "source_changed", "source_encryption_unavailable", "model_key_unavailable", "model_key_unassigned", "model_key_runtime_forbidden", "model_key_metadata_missing"} {
		if err.Error() == known {
			return known
		}
	}
	return "model_key_operation_failed"
}
func modelKeyFailure(w http.ResponseWriter, err error) {
	code := modelKeyErrorCode(err)
	status := 422
	if code == "model_key_operation_failed" {
		status = 500
	}
	writeJSON(w, status, map[string]string{"code": code, "error": "Model key operation failed (" + code + ")"})
}

func modelKeyRetryAt(err error, now time.Time) time.Time {
	retryAt := now.Add(60 * time.Second)
	var upstreamError *sub2api.Error
	if errors.As(err, &upstreamError) && upstreamError.RetryAfter.After(retryAt) {
		retryAt = upstreamError.RetryAfter
	}
	maxRetry := now.Add(modelKeyMaxRetryAfter)
	if retryAt.After(maxRetry) {
		retryAt = maxRetry
	}
	return retryAt
}

type modelKeySourceResponse struct {
	Configured     bool       `json:"configured"`
	BaseURL        string     `json:"base_url"`
	Status         string     `json:"status"`
	Revision       int64      `json:"revision"`
	LastCheckedAt  *time.Time `json:"last_checked_at"`
	LastErrorCode  string     `json:"last_error_code"`
	DirectoryCount int        `json:"directory_count"`
}

func (h *Handler) AdminModelKeySource(w http.ResponseWriter, r *http.Request) {
	uid, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		out := modelKeySourceResponse{Status: "unconfigured"}
		err := h.DB.QueryRow(r.Context(), `SELECT base_url,status,revision,last_checked_at,last_error_code,(SELECT count(*) FROM model_key_directory_entry d WHERE d.source_id=s.id AND d.source_revision=s.revision) FROM model_key_source s WHERE id=1`).Scan(&out.BaseURL, &out.Status, &out.Revision, &out.LastCheckedAt, &out.LastErrorCode, &out.DirectoryCount)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, 500, "Cannot read model key source")
			return
		}
		out.Configured = err == nil
		writeJSON(w, 200, out)
		return
	}
	var in struct {
		BaseURL  string `json:"base_url"`
		Token    string `json:"directory_token"`
		Revision int64  `json:"revision"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 32768)).Decode(&in) != nil || sub2api.ValidateBaseURL(in.BaseURL) != nil || strings.TrimSpace(in.Token) == "" || strings.ContainsAny(in.Token, "\r\n\t ") || len(in.Token) > 16384 {
		writeError(w, 400, "A valid HTTPS address and directory credential are required")
		return
	}
	// The client appends the API paths itself; a pasted endpoint URL would
	// otherwise 404 upstream and surface as a misleading missing-key error.
	if strings.Contains(strings.TrimRight(in.BaseURL, "/")+"/", "/api/v1/") {
		writeErrorCode(w, 400, "source_base_url_has_api_path", "Enter the sub2api root address without the /api/v1 path")
		return
	}
	box, err := modelKeyBox()
	if err != nil {
		modelKeyFailure(w, err)
		return
	}
	// Binding the encrypted value to its use prevents substituting unrelated secret rows.
	plain, _ := json.Marshal(map[string]string{"purpose": "sub2api-directory", "base_url": in.BaseURL, "token": in.Token})
	encrypted, err := box.Seal(plain)
	if err != nil {
		writeError(w, 500, "Cannot encrypt directory credential")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "Cannot save source")
		return
	}
	defer tx.Rollback(r.Context())
	// Serializes initial creation too, before the singleton row exists.
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(1726549181)`); err != nil {
		writeError(w, 500, "Cannot lock source")
		return
	}
	var revision int64
	var previousURL string
	err = tx.QueryRow(r.Context(), `SELECT revision,base_url FROM model_key_source WHERE id=1 FOR UPDATE`).Scan(&revision, &previousURL)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 500, "Cannot read source")
		return
	}
	if revision != in.Revision {
		writeError(w, 409, "Source changed; reload before saving")
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO model_key_source(id,base_url,directory_token_ciphertext,updated_by) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET base_url=EXCLUDED.base_url,directory_token_ciphertext=EXCLUDED.directory_token_ciphertext,revision=model_key_source.revision+1,status='unverified',last_checked_at=NULL,retry_after=NULL,last_error_code='',updated_at=now(),updated_by=EXCLUDED.updated_by`, in.BaseURL, encrypted, parseUUID(uid))
	if err == nil && previousURL != "" && previousURL != in.BaseURL {
		_, err = tx.Exec(r.Context(), `DELETE FROM model_key_directory_entry WHERE source_id=1`)
		if err == nil {
			_, err = tx.Exec(r.Context(), `DELETE FROM user_model_key_grant WHERE source_id=1`)
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE computer_runtime_model_config SET source_id=NULL,upstream_id=NULL,status='authorization_invalid' WHERE source_id=1`)
		}
	} else if err == nil {
		// Rotating only the directory token keeps the key identities and grants;
		// move the complete metadata snapshot to the new source revision.
		_, err = tx.Exec(r.Context(), `UPDATE model_key_directory_entry SET source_revision=(SELECT revision FROM model_key_source WHERE id=1) WHERE source_id=1`)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,action,outcome) VALUES($1,'model_key_source_save','success')`, parseUUID(uid))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "Cannot save source")
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}
func (h *Handler) modelSourceCredential(ctx context.Context) (string, string, int64, error) {
	var base string
	var cipher []byte
	var revision int64
	if err := h.DB.QueryRow(ctx, `SELECT base_url,directory_token_ciphertext,revision FROM model_key_source WHERE id=1`).Scan(&base, &cipher, &revision); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", "", 0, errors.New("model_key_operation_failed")
		}
		return "", "", 0, errors.New("source_not_configured")
	}
	box, err := modelKeyBox()
	if err != nil {
		return "", "", 0, err
	}
	plain, err := box.Open(cipher)
	if err != nil {
		return "", "", 0, errors.New("source_encryption_unavailable")
	}
	var value struct {
		Purpose string `json:"purpose"`
		BaseURL string `json:"base_url"`
		Token   string `json:"token"`
	}
	if json.Unmarshal(plain, &value) != nil || value.Purpose != "sub2api-directory" || value.BaseURL != base || value.Token == "" {
		return "", "", 0, errors.New("source_encryption_unavailable")
	}
	return base, value.Token, revision, nil
}

// Only directory metadata is persisted. A complete refresh replaces the snapshot,
// fenced by the source revision; no partial page can erase a grant's identity.
func (h *Handler) refreshModelKeyDirectory(ctx context.Context, force bool) error {
	// Waiters share one refresh but can stop waiting when their request is cancelled.
	key := "directory"
	if force {
		key = "directory-force"
	}
	result := h.modelKeyRefreshGroup.DoChan(key, func() (any, error) {
		refreshCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 90*time.Second)
		defer cancel()
		return nil, h.refreshModelKeySnapshot(refreshCtx, force)
	})
	select {
	case <-ctx.Done():
		return ctx.Err()
	case out := <-result:
		return out.Err
	}
}

func (h *Handler) refreshModelKeySnapshot(ctx context.Context, force bool) error {
	var status, code string
	var fresh, cooling bool
	if h.DB.QueryRow(ctx, `SELECT status,last_error_code,COALESCE(last_checked_at>now()-interval '60 seconds',false),COALESCE(retry_after>now(),false) FROM model_key_source WHERE id=1`).Scan(&status, &code, &fresh, &cooling) == nil {
		if !force && status == "error" && cooling {
			return &sub2api.Error{Code: code}
		}
		if !force && status == "ready" && fresh {
			return nil
		}
	}
	base, token, revision, err := h.modelSourceCredential(ctx)
	if err != nil {
		return err
	}
	items, err := (&sub2api.Client{HTTP: h.modelKeyHTTPClient()}).ListAll(ctx, base, token)
	if err != nil {
		retryAt := modelKeyRetryAt(err, time.Now())
		_, _ = h.DB.Exec(ctx, `UPDATE model_key_source SET status='error',last_checked_at=now(),last_error_code=$1,retry_after=$3 WHERE id=1 AND revision=$2`, sub2api.Code(err), revision, retryAt)
		return err
	}
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var current int64
	if err = tx.QueryRow(ctx, `SELECT revision FROM model_key_source WHERE id=1 FOR UPDATE`).Scan(&current); err != nil {
		return err
	}
	if current != revision {
		return errors.New("source_changed")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM model_key_directory_entry WHERE source_id=1`); err != nil {
		return err
	}
	for _, item := range items {
		raw, _ := json.Marshal(item.AllowedRuntimes)
		if _, err = tx.Exec(ctx, `INSERT INTO model_key_directory_entry(source_id,upstream_id,api_key_name,status,platform,allowed_runtimes,source_revision) VALUES(1,$1,$2,$3,$4,$5,$6)`, item.ID, item.APIKeyName, item.Status, item.Platform, raw, revision); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE model_key_source SET status='ready',last_checked_at=now(),last_error_code='',retry_after=NULL WHERE id=1 AND revision=$1`, revision); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (h *Handler) AdminModelKeyDirectoryRefresh(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	if err := h.refreshModelKeyDirectory(r.Context(), true); err != nil {
		modelKeyFailure(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

type modelKeyGrant struct {
	sub2api.Key
	Position int `json:"position"`
}

func scanModelKeyRows(rows pgx.Rows) ([]modelKeyGrant, error) {
	out := []modelKeyGrant{}
	for rows.Next() {
		var item modelKeyGrant
		var raw []byte
		if err := rows.Scan(&item.ID, &item.APIKeyName, &item.Status, &item.Platform, &raw, &item.Position); err != nil {
			return nil, err
		}
		if json.Unmarshal(raw, &item.AllowedRuntimes) != nil {
			return nil, errors.New("invalid directory metadata")
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

type modelKeyOwner struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}
type modelKeyDirectoryItem struct {
	sub2api.Key
	Owner *modelKeyOwner `json:"owner"`
}

// AdminModelKeyDirectory lists the current snapshot with its single owner.
// owner is "" (all), "none" (unassigned) or a user UUID; disabled and unknown
// keys are hidden unless status is "all" or names them.
func (h *Handler) AdminModelKeyDirectory(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	if err := h.refreshModelKeyDirectory(r.Context(), false); err != nil {
		modelKeyFailure(w, err)
		return
	}
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 1000 {
		writeError(w, 400, "Invalid page")
		return
	}
	owner := q.Get("owner")
	if owner != "" && owner != "none" {
		if _, ok := parseUUIDOrBadRequest(w, owner, "owner"); !ok {
			return
		}
	}
	status := q.Get("status")
	switch status {
	case "":
		status = "enabled"
	case "all", "enabled", "disabled", "unknown":
	default:
		writeError(w, 400, "Invalid status")
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT d.upstream_id,d.api_key_name,d.status,d.platform,d.allowed_runtimes,u.id::text,u.name,u.email
FROM model_key_directory_entry d
JOIN model_key_source s ON s.id=d.source_id AND s.revision=d.source_revision
LEFT JOIN user_model_key_grant g ON g.source_id=d.source_id AND g.upstream_id=d.upstream_id
LEFT JOIN "user" u ON u.id=g.user_id
WHERE ($1='' OR strpos(lower(d.api_key_name),lower($1))>0 OR d.upstream_id=$1)
  AND ($2='' OR d.allowed_runtimes ? $2)
  AND ($3='all' OR d.status=$3)
  AND ($4='' OR d.platform=$4)
  AND ($5='' OR ($5='none' AND g.user_id IS NULL) OR g.user_id::text=$5)
ORDER BY lower(d.api_key_name),d.upstream_id LIMIT 101 OFFSET $6`, strings.TrimSpace(q.Get("q")), q.Get("runtime"), status, q.Get("platform"), owner, (page-1)*100)
	if err != nil {
		writeError(w, 500, "Cannot list directory")
		return
	}
	defer rows.Close()
	items := []modelKeyDirectoryItem{}
	for rows.Next() {
		var item modelKeyDirectoryItem
		var raw []byte
		var ownerID, ownerName, ownerEmail *string
		if rows.Scan(&item.ID, &item.APIKeyName, &item.Status, &item.Platform, &raw, &ownerID, &ownerName, &ownerEmail) != nil || json.Unmarshal(raw, &item.AllowedRuntimes) != nil {
			writeError(w, 500, "Cannot read directory")
			return
		}
		if ownerID != nil {
			item.Owner = &modelKeyOwner{ID: *ownerID, Name: *ownerName, Email: *ownerEmail}
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Cannot read directory")
		return
	}
	more := len(items) > 100
	if more {
		items = items[:100]
	}
	platforms := []string{}
	prow, err := h.DB.Query(r.Context(), `SELECT DISTINCT d.platform FROM model_key_directory_entry d JOIN model_key_source s ON s.id=d.source_id AND s.revision=d.source_revision WHERE d.platform<>'' ORDER BY 1`)
	if err != nil {
		writeError(w, 500, "Cannot list directory")
		return
	}
	defer prow.Close()
	for prow.Next() {
		var p string
		if prow.Scan(&p) != nil {
			writeError(w, 500, "Cannot read directory")
			return
		}
		platforms = append(platforms, p)
	}
	writeJSON(w, 200, map[string]any{"items": items, "page": page, "has_more": more, "platforms": platforms})
}
func (h *Handler) AdminModelKeyUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireInstanceAdmin(w, r); !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT id::text,name,email FROM "user" WHERE $1='' OR strpos(lower(name||' '||email),lower($1))>0 ORDER BY name,id LIMIT 100`, strings.TrimSpace(r.URL.Query().Get("q")))
	if err != nil {
		writeError(w, 500, "Cannot list users")
		return
	}
	defer rows.Close()
	type user struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	out := []user{}
	for rows.Next() {
		var u user
		if rows.Scan(&u.ID, &u.Name, &u.Email) != nil {
			writeError(w, 500, "Cannot read users")
			return
		}
		out = append(out, u)
	}
	if rows.Err() != nil {
		writeError(w, 500, "Cannot read users")
		return
	}
	writeJSON(w, 200, map[string]any{"items": out})
}

type modelKeyAssignError struct {
	status int
	code   string
	msg    string
}

func (e *modelKeyAssignError) Error() string { return e.msg }

// setModelKeyOwners changes key ownership inside tx. Every assignment locks the
// single source row FOR UPDATE first: an unassigned key has no grant row to
// lock, so per-key row locks alone would let two admins both read "unassigned"
// and the later upsert silently take the key. Serializing on the source row
// makes every writer see the previous committed owner. Assignment is manual
// admin work, so the lost concurrency is irrelevant.
//
// owner nil revokes ids. Otherwise ids are assigned to owner, appended after
// the owner's existing grants; a key owned by someone else needs transfer.
func (h *Handler) setModelKeyOwners(ctx context.Context, tx pgx.Tx, ids []string, owner *pgtype.UUID, transfer bool) error {
	if _, err := tx.Exec(ctx, `SELECT id FROM model_key_source WHERE id=1 FOR UPDATE`); err != nil {
		return err
	}
	if owner != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "user" WHERE id=$1)`, *owner).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return &modelKeyAssignError{404, "", "User not found"}
		}
	}
	for _, id := range ids {
		var current *pgtype.UUID
		var row pgtype.UUID
		err := tx.QueryRow(ctx, `SELECT user_id FROM user_model_key_grant WHERE source_id=1 AND upstream_id=$1`, id).Scan(&row)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil {
			current = &row
		}
		if owner == nil {
			if _, err = tx.Exec(ctx, `DELETE FROM user_model_key_grant WHERE source_id=1 AND upstream_id=$1`, id); err != nil {
				return err
			}
			continue
		}
		if current != nil && current.Bytes == owner.Bytes {
			continue
		}
		if current != nil && !transfer {
			return &modelKeyAssignError{409, "model_key_assigned_elsewhere", "Key belongs to another user; confirm the transfer"}
		}
		var name string
		var allowed []byte
		err = tx.QueryRow(ctx, `SELECT d.api_key_name,d.allowed_runtimes FROM model_key_directory_entry d JOIN model_key_source s ON s.id=d.source_id AND s.revision=d.source_revision WHERE d.upstream_id=$1 AND d.status='enabled' AND s.status='ready'`, id).Scan(&name, &allowed)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var kinds []string
		_ = json.Unmarshal(allowed, &kinds)
		usable := false
		for _, k := range kinds {
			usable = usable || sub2api.KnownRuntime(k)
		}
		if err != nil || !usable {
			return &modelKeyAssignError{422, "", "Key is unavailable or has no supported runtime"}
		}
		// New grants rank after the owner's existing ones; the first compatible
		// grant is each runtime's default and users can switch per runtime.
		if _, err = tx.Exec(ctx, `INSERT INTO user_model_key_grant(user_id,source_id,upstream_id,api_key_name,position)
VALUES($1,1,$2,$3,(SELECT COALESCE(max(position)+1,0) FROM user_model_key_grant WHERE user_id=$1))
ON CONFLICT (source_id,upstream_id) DO UPDATE SET user_id=EXCLUDED.user_id,api_key_name=EXCLUDED.api_key_name,position=EXCLUDED.position,created_at=now()`, *owner, id, name); err != nil {
			return err
		}
	}
	return nil
}

func writeModelKeyAssignError(w http.ResponseWriter, err error) {
	var e *modelKeyAssignError
	switch {
	case errors.As(err, &e) && e.code != "":
		writeErrorCode(w, e.status, e.code, e.msg)
	case errors.As(err, &e):
		writeError(w, e.status, e.msg)
	default:
		modelKeyFailure(w, err)
	}
}

func uniqueModelKeyIDs(w http.ResponseWriter, ids []string) bool {
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			writeError(w, 400, "Duplicate key ID")
			return false
		}
		seen[id] = true
	}
	return true
}

// AdminModelKeyAssign sets the single owner of each key: a user ID assigns,
// null revokes. Moving a key that already belongs to another user requires
// allow_transfer so a stale page cannot silently take it from that user.
func (h *Handler) AdminModelKeyAssign(w http.ResponseWriter, r *http.Request) {
	actor, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	var in struct {
		IDs           []string `json:"ids"`
		UserID        *string  `json:"user_id"`
		AllowTransfer bool     `json:"allow_transfer"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&in) != nil || len(in.IDs) == 0 || len(in.IDs) > 1000 {
		writeError(w, 400, "Invalid assignment")
		return
	}
	if !uniqueModelKeyIDs(w, in.IDs) {
		return
	}
	var owner *pgtype.UUID
	if in.UserID != nil {
		target, ok := parseUUIDOrBadRequest(w, *in.UserID, "user_id")
		if !ok {
			return
		}
		owner = &target
		if err := h.refreshModelKeyDirectory(r.Context(), false); err != nil {
			modelKeyFailure(w, err)
			return
		}
	}
	ids := append([]string(nil), in.IDs...)
	sort.Strings(ids)
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "Cannot save assignment")
		return
	}
	defer tx.Rollback(r.Context())
	if err = h.setModelKeyOwners(r.Context(), tx, ids, owner, in.AllowTransfer); err != nil {
		writeModelKeyAssignError(w, err)
		return
	}
	action := "model_keys_revoke"
	if in.UserID != nil {
		action = "model_keys_assign:" + *in.UserID
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,action,outcome) VALUES($1,$2,'success')`, parseUUID(actor), action+":"+strings.Join(ids, ",")); err != nil {
		writeError(w, 500, "Cannot record key assignment")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "Cannot save assignment")
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

// AdminUserModelKeyGrants keeps the per-user API of earlier clients: installed
// Desktop builds may still call it against this backend. GET lists the user's
// keys; PUT makes the user's keys exactly ids. It never takes a key from
// another user (409), because those clients cannot confirm a transfer.
func (h *Handler) AdminUserModelKeyGrants(w http.ResponseWriter, r *http.Request) {
	actor, ok := requireInstanceAdmin(w, r)
	if !ok {
		return
	}
	uid, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "user_id")
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		var exists bool
		if h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM "user" WHERE id=$1)`, uid).Scan(&exists) != nil {
			writeError(w, 500, "Cannot read user")
			return
		}
		if !exists {
			writeError(w, 404, "User not found")
			return
		}
		rows, err := h.DB.Query(r.Context(), `SELECT g.upstream_id,COALESCE(d.api_key_name,g.api_key_name),COALESCE(d.status,'missing'),COALESCE(d.platform,''),COALESCE(d.allowed_runtimes,'[]'::jsonb),g.position FROM user_model_key_grant g LEFT JOIN model_key_directory_entry d ON d.source_id=g.source_id AND d.upstream_id=g.upstream_id WHERE g.user_id=$1 ORDER BY g.position,g.upstream_id`, uid)
		if err != nil {
			writeError(w, 500, "Cannot read grants")
			return
		}
		defer rows.Close()
		items, err := scanModelKeyRows(rows)
		if err != nil {
			writeError(w, 500, "Cannot read grants")
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
		return
	}
	var in struct {
		IDs []string `json:"ids"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&in) != nil || in.IDs == nil || len(in.IDs) > 1000 {
		writeError(w, 400, "Invalid grant list")
		return
	}
	if !uniqueModelKeyIDs(w, in.IDs) {
		return
	}
	if len(in.IDs) > 0 {
		if err := h.refreshModelKeyDirectory(r.Context(), false); err != nil {
			modelKeyFailure(w, err)
			return
		}
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "Cannot save grants")
		return
	}
	defer tx.Rollback(r.Context())
	// Revoke what the list drops, then assign the rest in the client's order.
	var dropped []string
	rows, err := tx.Query(r.Context(), `SELECT upstream_id FROM user_model_key_grant WHERE user_id=$1 AND source_id=1 AND NOT (upstream_id = ANY($2)) ORDER BY upstream_id`, uid, in.IDs)
	if err == nil {
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				break
			}
			dropped = append(dropped, id)
		}
		rows.Close()
		if err == nil {
			err = rows.Err()
		}
	}
	if err != nil {
		writeError(w, 500, "Cannot save grants")
		return
	}
	if len(dropped) > 0 {
		err = h.setModelKeyOwners(r.Context(), tx, dropped, nil, false)
	}
	if err == nil && len(in.IDs) > 0 {
		err = h.setModelKeyOwners(r.Context(), tx, in.IDs, &uid, false)
	}
	if err != nil {
		writeModelKeyAssignError(w, err)
		return
	}
	// Keep the client's explicit order for this user's keys.
	for i, id := range in.IDs {
		if _, err = tx.Exec(r.Context(), `UPDATE user_model_key_grant SET position=$3 WHERE user_id=$1 AND source_id=1 AND upstream_id=$2`, uid, id, i); err != nil {
			writeError(w, 500, "Cannot save grants")
			return
		}
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO computer_audit(user_id,action,outcome) VALUES($1,$2,'success')`, parseUUID(actor), "model_keys_assign:"+chi.URLParam(r, "id")); err != nil {
		writeError(w, 500, "Cannot record key assignment")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "Cannot save grants")
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}
func (h *Handler) grantedModelKey(ctx context.Context, uid, id, kind string) (sub2api.Key, error) {
	var item sub2api.Key
	var raw []byte
	err := h.DB.QueryRow(ctx, `SELECT d.upstream_id,d.api_key_name,d.status,d.allowed_runtimes FROM user_model_key_grant g JOIN model_key_directory_entry d ON d.source_id=g.source_id AND d.upstream_id=g.upstream_id JOIN model_key_source s ON s.id=d.source_id AND s.revision=d.source_revision WHERE g.user_id=$1 AND g.upstream_id=$2`, uid, id).Scan(&item.ID, &item.APIKeyName, &item.Status, &raw)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return item, err
		}
		return item, errors.New("model_key_unassigned")
	}
	if json.Unmarshal(raw, &item.AllowedRuntimes) != nil || !item.Allows(kind) {
		return item, errors.New("model_key_runtime_forbidden")
	}
	return item, nil
}
func (h *Handler) resolveGrantedModelKey(ctx context.Context, uid, id, kind string) (sub2api.Resolved, error) {
	var out sub2api.Resolved
	// Reject unassigned IDs before any upstream call.
	item, err := h.grantedModelKey(ctx, uid, id, kind)
	if err != nil {
		return out, err
	}
	base, token, revision, err := h.modelSourceCredential(ctx)
	if err != nil {
		return out, err
	}
	out, err = (&sub2api.Client{HTTP: h.modelKeyHTTPClient()}).Resolve(ctx, base, token, id, item.APIKeyName)
	if err != nil {
		return sub2api.Resolved{}, err
	}
	if !out.Allows(kind) {
		return sub2api.Resolved{}, errors.New("model_key_runtime_forbidden")
	}
	// Probe with the model credential only after checking runtime compatibility.
	out.Models, err = (&sub2api.Client{HTTP: h.modelKeyHTTPClient()}).DiscoverModels(ctx, out)
	if err != nil {
		return sub2api.Resolved{}, err
	}
	if _, err = h.grantedModelKey(ctx, uid, id, kind); err != nil {
		return sub2api.Resolved{}, err
	}
	var current int64
	if h.DB.QueryRow(ctx, `SELECT revision FROM model_key_source WHERE id=1`).Scan(&current) != nil || current != revision {
		return sub2api.Resolved{}, errors.New("source_changed")
	}
	return out, nil
}
func (h *Handler) MeModelKeyOptions(w http.ResponseWriter, r *http.Request) {
	uid, _, ok := h.bindingAccess(w, r, false)
	if !ok {
		return
	}
	kind := chi.URLParam(r, "kind")
	if !sub2api.KnownRuntime(kind) {
		writeError(w, 400, "Unknown runtime")
		return
	}
	if err := h.refreshModelKeyDirectory(r.Context(), false); err != nil {
		modelKeyFailure(w, err)
		return
	}
	rows, err := h.DB.Query(r.Context(), `SELECT d.upstream_id,d.api_key_name,d.status,d.platform,d.allowed_runtimes,g.position FROM user_model_key_grant g JOIN model_key_directory_entry d ON d.source_id=g.source_id AND d.upstream_id=g.upstream_id JOIN model_key_source s ON s.id=d.source_id AND s.revision=d.source_revision WHERE g.user_id=$1 AND d.status='enabled' AND d.allowed_runtimes ? $2 ORDER BY g.position,g.upstream_id`, uid, kind)
	if err != nil {
		writeError(w, 500, "Cannot read key options")
		return
	}
	defer rows.Close()
	items, err := scanModelKeyRows(rows)
	if err != nil {
		writeError(w, 500, "Cannot read key options")
		return
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
