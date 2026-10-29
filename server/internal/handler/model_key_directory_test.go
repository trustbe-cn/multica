package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/computer"
	"github.com/multica-ai/multica/server/internal/sub2api"
	"github.com/multica-ai/multica/server/internal/testutil"
)

func modelSourceFixture(t *testing.T) (*httptest.Server, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", testUserID)
	t.Setenv("MULTICA_COMPUTER_SECRET_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	mode, calls := &atomic.Int32{}, &atomic.Int32{}
	var upstream *httptest.Server
	upstream = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path == "/v1/models" {
			want := "Bearer fixture-model-secret"
			if mode.Load() == 3 {
				want = "Bearer fixture-rotated-model-secret"
			}
			if r.Header.Get("Authorization") != want {
				t.Error("wrong model credential")
			}
			fmt.Fprint(w, `{"data":[{"id":"model-a","display_name":"A"}]}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer fixture-directory-secret" {
			t.Error("directory credential missing")
		}
		if mode.Load() == 1 {
			w.WriteHeader(401)
			fmt.Fprint(w, "fixture-secret-upstream-error")
			return
		}
		if strings.HasSuffix(r.URL.Path, "/resolve") {
			var in struct {
				ID   json.Number `json:"id"`
				Name string      `json:"api_key_name"`
			}
			if json.NewDecoder(r.Body).Decode(&in) != nil || in.ID.String() != "9007199254740993" {
				t.Error("resolve used wrong identity")
			}
			token := "fixture-model-secret"
			if mode.Load() == 3 {
				token = "fixture-rotated-model-secret"
			}
			platform, protocol := "openai", "openai_responses"
			if mode.Load() == 2 {
				platform, protocol = "anthropic", "anthropic_messages"
			}
			fmt.Fprintf(w, `{"data":{"id":9007199254740993,"api_key_name":"shared","status":"active","platform":%q,"api_key_token":%q,"base_url":%q,"protocols":[%q],"model_names":null}}`, platform, token, upstream.URL, protocol)
			return
		}
		fmt.Fprint(w, `{"data":{"items":[{"id":9007199254740993,"api_key_name":"shared","status":"active","platform":"openai","protocols":["openai_responses"]},{"id":2,"api_key_name":"shared","status":"active","platform":"anthropic","protocols":["anthropic_messages"]},{"id":3,"api_key_name":"empty","status":"active","platform":"","protocols":null}],"page":1,"page_size":100,"total":3}}`)
	}))
	t.Cleanup(upstream.Close)
	testHandler.modelKeyClient = upstream.Client()
	t.Cleanup(func() {
		testHandler.modelKeyClient = nil
		_, _ = testPool.Exec(context.Background(), `DELETE FROM user_model_key_grant WHERE user_id=$1 AND source_id=1`, testUserID)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM model_key_directory_entry WHERE source_id=1`)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM model_key_source WHERE id=1`)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM computer_audit WHERE user_id=$1 AND action LIKE 'model_%'`, testUserID)
	})
	testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("PUT", "/", map[string]any{"base_url": upstream.URL, "directory_token": "fixture-directory-secret", "revision": 0})).Want(200)
	return upstream, mode, calls
}
func TestModelSourceRejectsEndpointPathAsBaseURL(t *testing.T) {
	upstream, _, _ := modelSourceFixture(t)
	for _, base := range []string{upstream.URL + "/api/v1/key-directory/resolve", upstream.URL + "/api/v1"} {
		var body map[string]string
		testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("PUT", "/", map[string]any{"base_url": base, "directory_token": "replacement", "revision": 1})).Want(400).JSON(&body)
		if body["code"] != "source_base_url_has_api_path" {
			t.Fatalf("%s: code = %q", base, body["code"])
		}
	}
	var source modelKeySourceResponse
	testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("GET", "/", nil)).Want(200).JSON(&source)
	if source.BaseURL != upstream.URL || source.Revision != 1 {
		t.Fatalf("rejected address replaced the source: %+v", source)
	}
}

// assignModelKeys sets the owner of ids (nil revokes) through the admin endpoint.
func assignModelKeys(t *testing.T, ids []string, user *string, transfer bool) *testutil.Response {
	t.Helper()
	return testutil.Call(t, testHandler.AdminModelKeyAssign, computerTestRequest("POST", "/", map[string]any{"ids": ids, "user_id": user, "allow_transfer": transfer}))
}
func TestModelKeyAssignmentHasSingleOwner(t *testing.T) {
	modelSourceFixture(t)
	var other string
	if err := testPool.QueryRow(t.Context(), `INSERT INTO "user"(name,email) VALUES('Key Owner B','model-key-owner-b@multica.test') RETURNING id::text`).Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM user_model_key_grant WHERE user_id=$1`, other)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id=$1`, other)
	})
	list := func(query string) []modelKeyDirectoryItem {
		t.Helper()
		var out struct {
			Items     []modelKeyDirectoryItem `json:"items"`
			Platforms []string                `json:"platforms"`
		}
		testutil.Call(t, testHandler.AdminModelKeyDirectory, computerTestRequest("GET", "/?"+query, nil)).Want(200).JSON(&out)
		if len(out.Platforms) != 2 || out.Platforms[0] != "anthropic" || out.Platforms[1] != "openai" {
			t.Fatalf("platforms = %v", out.Platforms)
		}
		return out.Items
	}
	if items := list("owner=none"); len(items) != 3 {
		t.Fatalf("unassigned = %d", len(items))
	}
	assignModelKeys(t, []string{"2"}, ptr(testUserID), false).Want(200)
	// Taking a key from its current owner needs an explicit transfer.
	var conflict map[string]string
	assignModelKeys(t, []string{"2"}, ptr(other), false).Want(409).JSON(&conflict)
	if conflict["code"] != "model_key_assigned_elsewhere" {
		t.Fatalf("conflict = %v", conflict)
	}
	if items := list("owner=" + testUserID); len(items) != 1 || items[0].ID != "2" {
		t.Fatal("rejected transfer changed the owner")
	}
	assignModelKeys(t, []string{"2", "9007199254740993"}, ptr(other), true).Want(200)
	if items := list("owner=" + testUserID); len(items) != 0 {
		t.Fatal("transferred key still belongs to the previous owner")
	}
	items := list("owner=" + other)
	if len(items) != 2 || items[0].Owner == nil || items[0].Owner.Email != "model-key-owner-b@multica.test" {
		t.Fatalf("new owner listing = %+v", items)
	}
	if items := list("owner=" + other + "&platform=anthropic"); len(items) != 1 || items[0].ID != "2" || items[0].Platform != "anthropic" {
		t.Fatalf("platform filter = %+v", items)
	}
	var rows int
	if err := testPool.QueryRow(t.Context(), `SELECT count(*) FROM user_model_key_grant WHERE upstream_id='2'`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("key 2 has %d grants", rows)
	}
	// Revoking returns the key to the unassigned pool.
	assignModelKeys(t, []string{"2"}, nil, false).Want(200)
	if items := list("owner=none&q=2"); len(items) != 1 || items[0].Owner != nil {
		t.Fatalf("revoked key = %+v", items)
	}
	assignModelKeys(t, []string{"2", "2"}, ptr(other), false).Want(400)
	testutil.Call(t, testHandler.AdminModelKeyDirectory, computerTestRequest("GET", "/?status=bogus", nil)).Want(400)
	testutil.Call(t, testHandler.AdminModelKeyDirectory, computerTestRequest("GET", "/?owner=not-a-uuid", nil)).Want(400)
}

// Two admins assigning the same unassigned key must not both win: the later
// request has to see the first owner and fail without allow_transfer.
func TestModelKeyConcurrentAssignmentDoesNotStealKey(t *testing.T) {
	modelSourceFixture(t)
	var other string
	if err := testPool.QueryRow(t.Context(), `INSERT INTO "user"(name,email) VALUES('Key Racer','model-key-racer@multica.test') RETURNING id::text`).Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM user_model_key_grant WHERE user_id=$1`, other)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id=$1`, other)
	})
	// Load the directory snapshot before either transaction starts.
	testutil.Call(t, testHandler.AdminModelKeyDirectory, computerTestRequest("GET", "/", nil)).Want(200)
	first, second := parseUUID(testUserID), parseUUID(other)
	tx1, err := testHandler.TxStarter.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx1.Rollback(context.Background())
	if err = testHandler.setModelKeyOwners(t.Context(), tx1, []string{"2"}, &first, false); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		tx2, err := testHandler.TxStarter.Begin(context.Background())
		if err != nil {
			done <- err
			return
		}
		defer tx2.Rollback(context.Background())
		if err = testHandler.setModelKeyOwners(context.Background(), tx2, []string{"2"}, &second, false); err != nil {
			done <- err
			return
		}
		done <- tx2.Commit(context.Background())
	}()
	select {
	case err := <-done:
		t.Fatalf("second assignment did not wait for the first: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err = tx1.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	var assignErr *modelKeyAssignError
	if err := <-done; !errors.As(err, &assignErr) || assignErr.code != "model_key_assigned_elsewhere" {
		t.Fatalf("second assignment = %v, want model_key_assigned_elsewhere", err)
	}
	var owner string
	if err := testPool.QueryRow(t.Context(), `SELECT user_id::text FROM user_model_key_grant WHERE source_id=1 AND upstream_id='2'`).Scan(&owner); err != nil || owner != testUserID {
		t.Fatalf("owner = %q (%v), want first assigner", owner, err)
	}
}

// Installed clients keep the per-user API; it must not take another user's key.
func TestModelKeyLegacyPerUserGrantsRespectSingleOwner(t *testing.T) {
	modelSourceFixture(t)
	var other string
	if err := testPool.QueryRow(t.Context(), `INSERT INTO "user"(name,email) VALUES('Legacy Owner','model-key-legacy@multica.test') RETURNING id::text`).Scan(&other); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM user_model_key_grant WHERE user_id=$1`, other)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id=$1`, other)
	})
	put := func(user string, ids []string) *testutil.Response {
		return testutil.Call(t, testHandler.AdminUserModelKeyGrants, withURLParam(computerTestRequest("PUT", "/", map[string]any{"ids": ids}), "id", user))
	}
	put(testUserID, []string{"9007199254740993", "2"}).Want(200)
	var grants struct {
		Items []modelKeyGrant `json:"items"`
	}
	testutil.Call(t, testHandler.AdminUserModelKeyGrants, withURLParam(computerTestRequest("GET", "/", nil), "id", testUserID)).Want(200).JSON(&grants)
	if len(grants.Items) != 2 || grants.Items[0].ID != "9007199254740993" || grants.Items[1].ID != "2" {
		t.Fatalf("legacy order lost: %+v", grants.Items)
	}
	var conflict map[string]string
	put(other, []string{"2"}).Want(409).JSON(&conflict)
	if conflict["code"] != "model_key_assigned_elsewhere" {
		t.Fatalf("legacy client took another user's key: %v", conflict)
	}
	// Dropping a key from the list returns it to the pool for others.
	put(testUserID, []string{"9007199254740993"}).Want(200)
	put(other, []string{"2"}).Want(200)
	put(testUserID, []string{"3"}).Want(422)
}

func TestModelSourceEncryptionCacheAndFailureBoundary(t *testing.T) {
	upstream, mode, calls := modelSourceFixture(t)
	var source modelKeySourceResponse
	testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("GET", "/", nil)).Want(200).JSON(&source)
	if !source.Configured || source.Revision != 1 {
		t.Fatal("source metadata missing")
	}
	var cipher []byte
	if err := testPool.QueryRow(t.Context(), `SELECT directory_token_ciphertext FROM model_key_source WHERE id=1`).Scan(&cipher); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(cipher), "fixture-directory-secret") {
		t.Fatal("plaintext credential stored")
	}
	base, token, revision, err := testHandler.modelSourceCredential(t.Context())
	if err != nil || base != upstream.URL || token != "fixture-directory-secret" || revision != 1 {
		t.Fatal("credential cannot be decrypted")
	}
	for i := 0; i < 2; i++ {
		testutil.Call(t, testHandler.AdminModelKeyDirectory, computerTestRequest("GET", "/?q=shared", nil)).Want(200)
	}
	if calls.Load() != 1 {
		t.Fatal("metadata was not cached")
	}
	mode.Store(1)
	var failure map[string]string
	testutil.Call(t, testHandler.AdminModelKeyDirectoryRefresh, computerTestRequest("POST", "/", nil)).Want(422).JSON(&failure)
	if strings.Contains(fmt.Sprint(failure), "fixture-secret") {
		t.Fatal("upstream error leaked")
	}
	var count int
	if err := testPool.QueryRow(t.Context(), `SELECT count(*) FROM model_key_directory_entry`).Scan(&count); err != nil || count != 3 {
		t.Fatal("failed refresh erased snapshot")
	}
	testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("PUT", "/", map[string]any{"base_url": upstream.URL, "directory_token": "replacement", "revision": 0})).Want(409)
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", "")
	for _, fn := range []http.HandlerFunc{testHandler.AdminModelKeySource, testHandler.AdminModelKeyDirectory, testHandler.AdminModelKeyUsers, testHandler.AdminRuntimeConfigTemplateList, testHandler.AdminModelKeyAssign} {
		testutil.Call(t, fn, computerTestRequest("GET", "/", nil)).Want(403)
	}
}

func TestModelKeyFailureKeepsDatabaseErrorsInternal(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{name: "upstream", err: &sub2api.Error{Code: "source_rate_limited"}, status: 422, code: "source_rate_limited"},
		{name: "business", err: errors.New("model_key_runtime_forbidden"), status: 422, code: "model_key_runtime_forbidden"},
		{name: "database", err: errors.New("duplicate key value violates unique constraint"), status: 500, code: "model_key_operation_failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			modelKeyFailure(rec, tc.err)
			if rec.Code != tc.status {
				t.Fatalf("status=%d, want %d", rec.Code, tc.status)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["code"] != tc.code {
				t.Fatalf("body=%s, want code %q", rec.Body.String(), tc.code)
			}
		})
	}
}

func TestModelKeyRetryAfterIsBounded(t *testing.T) {
	now := time.Now()
	retryAt := modelKeyRetryAt(&sub2api.Error{Code: "source_rate_limited", RetryAfter: now.Add(24 * time.Hour)}, now)
	if retryAt.After(now.Add(modelKeyMaxRetryAfter)) {
		t.Fatalf("retry deadline exceeded cap: %s", retryAt)
	}
	short := modelKeyRetryAt(&sub2api.Error{Code: "source_rate_limited", RetryAfter: now.Add(10 * time.Second)}, now)
	if short.Before(now.Add(59 * time.Second)) {
		t.Fatalf("short retry deadline was shortened: %s", short)
	}
}
func TestModelKeyGrantsScopeOrderAndOwnerBoundary(t *testing.T) {
	_, mode, calls := modelSourceFixture(t)
	_, binding := operationBinding(t)
	assignModelKeys(t, []string{"2", "9007199254740993"}, ptr(testUserID), false).Want(200)
	assignModelKeys(t, []string{"3"}, ptr(testUserID), false).Want(422)
	var grants struct {
		Items []modelKeyDirectoryItem `json:"items"`
	}
	testutil.Call(t, testHandler.AdminModelKeyDirectory, computerTestRequest("GET", "/?owner="+testUserID, nil)).Want(200).JSON(&grants)
	if len(grants.Items) != 2 || grants.Items[0].Owner == nil || grants.Items[0].Owner.ID != testUserID {
		t.Fatal("grants lost or invalid write was not rolled back")
	}
	req := modelConfigRequest("GET", binding, "codex", "", nil)
	var options struct {
		Items []modelKeyGrant `json:"items"`
	}
	testutil.Call(t, testHandler.MeModelKeyOptions, req).Want(200).JSON(&options)
	if len(options.Items) != 1 || options.Items[0].ID != "9007199254740993" {
		t.Fatal("incompatible keys visible")
	}
	before := calls.Load()
	if _, err := testHandler.resolveGrantedModelKey(t.Context(), testUserID, "2", "codex"); err == nil || calls.Load() != before {
		t.Fatal("forbidden key reached upstream")
	}
	resolved, err := testHandler.resolveGrantedModelKey(t.Context(), testUserID, "9007199254740993", "codex")
	if err != nil || resolved.APIKeyToken != "fixture-model-secret" {
		t.Fatalf("assigned key rejected: %v", err)
	}
	mode.Store(2)
	if _, err = testHandler.resolveGrantedModelKey(t.Context(), testUserID, "9007199254740993", "codex"); err == nil {
		t.Fatal("changed upstream scope accepted")
	}
	req.Header.Set("X-User-ID", "10000000-0000-0000-0000-000000000099")
	testutil.Call(t, testHandler.MeModelKeyOptions, req).Want(404)
	for _, action := range []string{"read", "check", "preview", "save", "test"} {
		req = modelConfigRequest("POST", binding, "codex", action, map[string]string{})
		req.Header.Set("X-User-ID", "10000000-0000-0000-0000-000000000099")
		testutil.Call(t, testHandler.RuntimeModelConfig, req).Want(404)
	}
}
func TestModelTemplateChangesDoNotRetemplateSavedConfigurations(t *testing.T) {
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", testUserID)
	_, binding := operationBinding(t)
	original, err := computer.BuiltinModelTemplate("codex")
	if err != nil {
		t.Fatal(err)
	}
	dbfx.Exec(t, `INSERT INTO computer_runtime_model_config(binding_id,runtime_kind,template_revision,file_manifest,file_revision) VALUES($1,'codex',0,$2,'fixture-revision')`, binding, configManifest(original))
	changed := original
	changed.DefaultModel = "new-default"
	changed.SupportedAPITypes = []string{"openai-chat-completions"}
	changed.Files = append([]computer.ModelConfigFile{}, original.Files...)
	changed.Files[0].Path = ".codex/custom.toml"
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM runtime_config_template WHERE runtime_kind='codex'`)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM computer_audit WHERE action='model_template_save:codex'`)
	})
	request := func() *http.Request { return withURLParam(computerTestRequest("PUT", "/", changed), "kind", "codex") }
	testutil.Call(t, testHandler.AdminRuntimeConfigTemplates, request()).Want(200)
	testutil.Call(t, testHandler.AdminRuntimeConfigTemplates, request()).Want(409)
	pinned, err := testHandler.configTemplateFor(t.Context(), binding, "codex")
	if err != nil || pinned.DefaultModel != "" || pinned.SupportedAPITypes[0] != "openai-responses" || pinned.Files[0].Path != ".codex/config.toml" || pinned.Files[0].Content != original.Files[0].Content {
		t.Fatal("new template affected existing file definitions")
	}
}

func modelConfigRequest(method, binding, kind, action string, body any) *http.Request {
	req := computerTestRequest(method, "/", body)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", binding)
	rc.URLParams.Add("kind", kind)
	rc.URLParams.Add("action", action)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

func TestModelSourceFailureCooldownAndSourceIdentity(t *testing.T) {
	upstream, mode, calls := modelSourceFixture(t)
	_, binding := operationBinding(t)
	if err := testHandler.refreshModelKeyDirectory(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	mode.Store(1)
	if err := testHandler.refreshModelKeyDirectory(t.Context(), true); err == nil {
		t.Fatal("upstream failure ignored")
	}
	before := calls.Load()
	for i := 0; i < 8; i++ {
		if err := testHandler.refreshModelKeyDirectory(t.Context(), false); err == nil {
			t.Fatal("stale snapshot authorized after upstream failure")
		}
	}
	if calls.Load() != before {
		t.Fatal("failed upstream was retried during cooldown")
	}
	if _, err := testPool.Exec(t.Context(), `INSERT INTO computer_runtime_model_config(binding_id,runtime_kind,source_id,upstream_id,status) VALUES($1,'codex',1,'9007199254740993','saved')`, binding); err != nil {
		t.Fatal(err)
	}
	testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("PUT", "/", map[string]any{"base_url": upstream.URL + "/replacement", "directory_token": "replacement", "revision": 1})).Want(200)
	var sourceID *int16
	var keyID *string
	var status string
	if err := testPool.QueryRow(t.Context(), `SELECT source_id,upstream_id,status FROM computer_runtime_model_config WHERE binding_id=$1`, binding).Scan(&sourceID, &keyID, &status); err != nil || sourceID != nil || keyID != nil || status != "authorization_invalid" {
		t.Fatal("source replacement reuses stale key identity")
	}
}

func TestModelSourceTokenRotationKeepsDirectoryAndForceBypassesCache(t *testing.T) {
	upstream, mode, calls := modelSourceFixture(t)
	assignModelKeys(t, []string{"9007199254740993"}, ptr(testUserID), false).Want(200)
	before := calls.Load()
	testutil.Call(t, testHandler.AdminModelKeyDirectoryRefresh, computerTestRequest("POST", "/", nil)).Want(200)
	if calls.Load() != before+1 {
		t.Fatal("forced refresh reused fresh cache")
	}
	mode.Store(1)
	testutil.Call(t, testHandler.AdminModelKeyDirectoryRefresh, computerTestRequest("POST", "/", nil)).Want(422)
	before = calls.Load()
	mode.Store(0)
	testutil.Call(t, testHandler.AdminModelKeyDirectoryRefresh, computerTestRequest("POST", "/", nil)).Want(200)
	if calls.Load() != before+1 {
		t.Fatal("forced refresh did not bypass cooldown")
	}
	testutil.Call(t, testHandler.AdminModelKeySource, computerTestRequest("PUT", "/", map[string]any{"base_url": upstream.URL, "directory_token": "rotated-fixture", "revision": 1})).Want(200)
	key, err := testHandler.grantedModelKey(t.Context(), testUserID, "9007199254740993", "codex")
	if err != nil || key.APIKeyName != "shared" {
		t.Fatalf("token rotation lost grant identity: %v", err)
	}
	var count int
	if err := testPool.QueryRow(t.Context(), `SELECT count(*) FROM model_key_directory_entry WHERE source_id=1 AND source_revision=2`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("token rotation lost directory: count=%d err=%v", count, err)
	}
}
