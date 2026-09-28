package computer

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRuntimeDownloadsDeduplicatePersistAndKeepOriginalBytes(t *testing.T) {
	var calls atomic.Int32
	client := &http.Client{Transport: versionTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return versionResponse(200, `{"dist":{"tarball":"https://registry.npmjs.org/tool/-/tool-1.0.0.tgz"}}`), nil
	})}
	dir := t.TempDir()
	cache := NewRuntimeDownloadCache(dir, client)
	source := "https://registry.npmjs.org/tool/latest"
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			file, entry, err := cache.Open(context.Background(), source)
			if err != nil {
				t.Error(err)
				return
			}
			defer file.Close()
			data, _ := io.ReadAll(file)
			if entry.Size != int64(len(data)) || !strings.Contains(string(data), "https://registry.npmjs.org/") {
				t.Error("cached response was rewritten")
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("%d upstream requests", calls.Load())
	}
	cache = NewRuntimeDownloadCache(dir, client)
	file, entry, err := cache.Open(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if calls.Load() != 1 || entry.SHA256 == "" {
		t.Fatal("cache did not survive restart")
	}
	cache.mu.Lock()
	old := cache.entries[entry.ID]
	old.CachedAt = time.Now().Add(-2 * time.Hour)
	cache.entries[entry.ID] = old
	cache.mu.Unlock()
	file, _, err = cache.Open(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	file.Close()
	if calls.Load() != 2 {
		t.Fatal("expired metadata was not refreshed")
	}
}

type brokenDownload struct{}

func (brokenDownload) Read([]byte) (int, error) { return 0, errors.New("connection lost") }
func (brokenDownload) Close() error             { return nil }
func TestRuntimeDownloadsDoNotPublishPartialOrOversizedFiles(t *testing.T) {
	for _, tc := range []string{"partial", "oversized", "status"} {
		t.Run(tc, func(t *testing.T) {
			client := &http.Client{Transport: versionTransport(func(*http.Request) (*http.Response, error) {
				if tc == "partial" {
					return &http.Response{StatusCode: 200, Header: make(http.Header), Body: brokenDownload{}}, nil
				}
				if tc == "status" {
					return versionResponse(503, "down"), nil
				}
				return versionResponse(200, strings.Repeat("x", 33)), nil
			})}
			cache := NewRuntimeDownloadCache(t.TempDir(), client)
			cache.itemLimit = 32
			file, _, err := cache.Open(context.Background(), "https://registry.npmjs.org/tool/-/tool.tgz")
			if err == nil {
				file.Close()
				t.Fatal("accepted incomplete artifact")
			}
			snapshot, err := cache.Snapshot()
			if err != nil || snapshot.Bytes != 0 || len(snapshot.Entries) != 0 {
				t.Fatalf("published broken cache: %+v %v", snapshot, err)
			}
			files, _ := os.ReadDir(cache.dir)
			if len(files) != 0 {
				t.Fatalf("temporary download remains: %v", files)
			}
		})
	}
}
func TestRuntimeDownloadsEvictAndClearMetadata(t *testing.T) {
	client := &http.Client{Transport: versionTransport(func(*http.Request) (*http.Response, error) { return versionResponse(200, strings.Repeat("x", 24)), nil })}
	cache := NewRuntimeDownloadCache(t.TempDir(), client)
	cache.itemLimit = 32
	cache.limit = 64
	for _, source := range []string{"https://registry.npmjs.org/a/-/a.tgz", "https://registry.npmjs.org/b/-/b.tgz", "https://registry.npmjs.org/b/latest"} {
		file, _, err := cache.Open(context.Background(), source)
		if err != nil {
			t.Fatal(err)
		}
		file.Close()
	}
	snapshot, _ := cache.Snapshot()
	if snapshot.Bytes > 64 || len(snapshot.Entries) != 2 {
		t.Fatalf("capacity not enforced: %+v", snapshot)
	}
	if err := cache.Clear(true); err != nil {
		t.Fatal(err)
	}
	snapshot, _ = cache.Snapshot()
	if len(snapshot.Entries) != 1 || snapshot.Entries[0].Metadata {
		t.Fatalf("cleared binaries with metadata: %+v", snapshot)
	}
	if err := cache.Clear(false); err != nil {
		t.Fatal(err)
	}
	snapshot, _ = cache.Snapshot()
	if snapshot.Bytes != 0 {
		t.Fatal("cache not cleared")
	}
}
func TestRuntimeDownloadsRejectClearDuringFetch(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	cache := NewRuntimeDownloadCache(t.TempDir(), &http.Client{Transport: versionTransport(func(*http.Request) (*http.Response, error) {
		close(started)
		<-finish
		return versionResponse(200, "data"), nil
	})})
	done := make(chan error, 1)
	go func() {
		file, _, err := cache.Open(context.Background(), "https://registry.npmjs.org/a/-/a.tgz")
		if file != nil {
			file.Close()
		}
		done <- err
	}()
	<-started
	if err := cache.Clear(false); !errors.Is(err, ErrRuntimeCacheBusy) {
		t.Errorf("clear accepted while downloading: %v", err)
	}
	close(finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestRuntimeDownloadSourceBoundaries(t *testing.T) {
	for _, source := range []string{"http://registry.npmjs.org/a", "https://evil.invalid/a", "https://github.com/other/repo/releases/latest", "https://registry.npmjs.org:444/a", "https://user:secret@registry.npmjs.org/a", "https://registry.npmjs.org/a?url=http://localhost", "https://code.kimi.com/kimi-code/../private", "https://code.kimi.com/kimi-code/%2e%2e/private", "https://registry.npmjs.org/-/user"} {
		if AllowedRuntimeSource(source) {
			t.Errorf("accepted %s", source)
		}
	}
	for _, source := range []string{"https://registry.npmjs.org/@openai%2Fcodex/latest", "https://github.com/can1357/oh-my-pi/releases/download/v1.0.0/omp-linux-x64", "https://code.kimi.com/kimi-code/binaries/1.0.0/manifest.json"} {
		if !AllowedRuntimeSource(source) {
			t.Errorf("rejected %s", source)
		}
	}
	base := "https://multica.invalid/api/runtime-downloads/operation/expires/signature"
	source := []byte("curl https://code.kimi.com/kimi-code/latest; curl https://api.github.com/repos/can1357/oh-my-pi/releases/latest")
	mirrored := string(MirrorRuntimeURLs(source, base))
	if !strings.Contains(mirrored, base+"/code.kimi.com/") || !strings.Contains(mirrored, base+"/api.github.com/") {
		t.Fatal("did not route upstream URLs through server")
	}
}
