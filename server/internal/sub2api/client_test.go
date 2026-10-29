package sub2api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDirectoryPaginationAndPreciseID(t *testing.T) {
	calls := 0
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer test-directory" {
			t.Error("missing bearer")
		}
		page := r.URL.Query().Get("page")
		id := "9007199254740993"
		if page == "2" {
			id = "9007199254740994"
		}
		fmt.Fprintf(w, `{"data":{"items":[{"id":%s,"api_key_name":"duplicate","status":"active","platform":"openai","protocols":["openai_responses"]}],"page":%s,"page_size":1,"total":2}}`, id, page)
	}))
	defer s.Close()
	keys, err := (&Client{HTTP: s.Client()}).ListAll(t.Context(), s.URL, "test-directory")
	if err != nil || len(keys) != 2 || keys[0].ID != "9007199254740993" || calls != 2 {
		t.Fatalf("pagination failed: %v / %d", err, calls)
	}
}
func TestDirectoryRejectsIncompleteContract(t *testing.T) {
	for _, body := range []string{
		`{}`,
		`{"items":[]}`,
		`{"data":{"items":[{"id":1,"api_key_name":"a","status":"active"}],"page":1,"page_size":100,"total":1}}`,
		`{"data":{"items":[],"page":1,"page_size":100,"total":1}}`,
		`{"data":{"items":[],"page":1,"page_size":100}}`,
	} {
		t.Run(body, func(t *testing.T) {
			s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
			defer s.Close()
			_, err := (&Client{HTTP: s.Client()}).ListAll(t.Context(), s.URL, "test-directory")
			if Code(err) != "source_invalid_response" {
				t.Fatalf("accepted malformed contract: %v", err)
			}
		})
	}
}
func TestResolveValidatesIdentityAndDoesNotLeak(t *testing.T) {
	for _, mode := range []string{"ok", "mismatch", "disabled", "missing_protocols", "error"} {
		t.Run(mode, func(t *testing.T) {
			s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var in map[string]json.RawMessage
				if json.NewDecoder(r.Body).Decode(&in) != nil || string(in["id"]) != "9007199254740993" {
					t.Error("ID lost precision")
				}
				if mode == "error" {
					w.WriteHeader(401)
					fmt.Fprint(w, "token-should-not-leak")
					return
				}
				id := "9007199254740993"
				status := "active"
				protocols := `["openai_responses"]`
				if mode == "mismatch" {
					id = "2"
				}
				if mode == "disabled" {
					status = "inactive"
				}
				if mode == "missing_protocols" {
					protocols = "[]"
				}
				fmt.Fprintf(w, `{"data":{"id":%s,"api_key_name":"a","status":"%s","platform":"openai","api_key_token":"token-should-not-leak","base_url":"https://model.example","protocols":%s,"model_names":null}}`, id, status, protocols)
			}))
			defer s.Close()
			out, err := (&Client{HTTP: s.Client()}).Resolve(t.Context(), s.URL, "test-directory", "9007199254740993", "a")
			if mode == "ok" {
				if err != nil || out.APIKeyToken == "" {
					t.Fatalf("valid resolve rejected: %v", err)
				}
			} else if err == nil || strings.Contains(err.Error(), "token-should-not-leak") {
				t.Fatal("invalid resolve accepted or leaked secret")
			}
		})
	}
}
func TestRedirectNeverForwardsCredential(t *testing.T) {
	reached := false
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer s.Close()
	_, err := (&Client{HTTP: s.Client()}).ListAll(t.Context(), s.URL, "test-directory")
	if err == nil || reached {
		t.Fatal("followed credential-bearing redirect")
	}
}
func TestRuntimeAvailabilityRequiresEnabledAndCompatible(t *testing.T) {
	for _, k := range []Key{{Status: "enabled"}, {Status: "active", AllowedRuntimes: []string{"codex"}}, {Status: "enabled", AllowedRuntimes: []string{"claude"}}} {
		if k.Allows("codex") {
			t.Fatal("key without explicit enabled Codex scope accepted")
		}
	}
}

func TestRuntimeCompatibilityComesFromPlatformAndProtocols(t *testing.T) {
	for _, tc := range []struct {
		platform  string
		protocols []string
		kind      string
		want      bool
	}{
		{"openai", []string{"openai_responses"}, "codex", true},
		{"openai", []string{"openai_responses"}, "claude", false},
		{"openai", []string{"openai_chat_completions"}, "kimi", true},
		{"openai", []string{"anthropic_messages"}, "claude", false},
		{"anthropic", []string{"anthropic_messages"}, "pi", true},
		{"anthropic", []string{"anthropic_messages"}, "codex", false},
		{"", []string{"openai_responses"}, "codex", false},
		{"openai", nil, "codex", false},
		// Vendor platforms are pinned to the CLIs that serve their models.
		{"grok", []string{"openai_chat_completions"}, "grok", true},
		{"grok", []string{"openai_chat_completions"}, "opencode", false},
		{"grok", []string{"openai_chat_completions"}, "pi", false},
		{"deepseek", []string{"openai_chat_completions"}, "opencode", true},
		{"deepseek", []string{"openai_chat_completions"}, "pi", true},
		{"deepseek", []string{"openai_chat_completions"}, "kimi", false},
		{"gemini", []string{"gemini_generate_content"}, "pi", true},
		{"gemini", []string{"gemini_generate_content"}, "omp", false},
		{"gemini", []string{"openai_chat_completions"}, "pi", false},
		{"zhipu", []string{"openai_chat_completions"}, "opencode", false},
		{"openai", []string{"openai_chat_completions"}, "grok", true},
	} {
		if got := Contains(CompatibleRuntimes(tc.platform, tc.protocols), tc.kind); got != tc.want {
			t.Fatalf("compatibility mismatch for %s / %v / %s", tc.platform, tc.protocols, tc.kind)
		}
	}
}

func TestResolveMapsVendorProtocolsToEndpoints(t *testing.T) {
	for _, tc := range []struct {
		platform, protocol, apiType, path string
	}{
		{"gemini", "gemini_generate_content", "google-generative-ai", "/v1beta"},
		{"grok", "openai_chat_completions", "openai-chat-completions", "/v1"},
		{"deepseek", "openai_chat_completions", "openai-chat-completions", "/v1"},
	} {
		t.Run(tc.platform, func(t *testing.T) {
			s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"data":{"id":7,"api_key_name":"k","status":"active","platform":%q,"api_key_token":"t","base_url":"https://model.example","protocols":[%q]}}`, tc.platform, tc.protocol)
			}))
			defer s.Close()
			out, err := (&Client{HTTP: s.Client()}).Resolve(t.Context(), s.URL, "test-directory", "7", "k")
			if err != nil || out.Platform != tc.platform || len(out.Endpoints) != 1 || out.Endpoints[0].APIType != tc.apiType || out.Endpoints[0].BaseURL != "https://model.example"+tc.path {
				t.Fatalf("resolve = %+v, %v", out, err)
			}
		})
	}
}

func TestDirectoryRequiresProtocolsForSupportedVendorPlatforms(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":{"items":[{"id":1,"api_key_name":"g","status":"active","platform":"gemini","protocols":null}],"page":1,"page_size":100,"total":1}}`)
	}))
	defer s.Close()
	if _, err := (&Client{HTTP: s.Client()}).ListAll(t.Context(), s.URL, "test-directory"); Code(err) != "source_invalid_response" {
		t.Fatalf("gemini key without protocols accepted: %v", err)
	}
}

func TestDirectoryRateLimitPreservesRetryAfter(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "120"); w.WriteHeader(429) }))
	defer s.Close()
	_, err := (&Client{HTTP: s.Client()}).ListAll(t.Context(), s.URL, "fixture")
	failure, ok := err.(*Error)
	if !ok || failure.Code != "source_rate_limited" || failure.RetryAfter.Before(time.Now().Add(119*time.Second)) {
		t.Fatal("Retry-After was lost")
	}
}
