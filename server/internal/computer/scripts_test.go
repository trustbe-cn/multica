package computer

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runWriter(t *testing.T, home string, f CredentialFiles, profile ...string) error {
	t.Helper()
	script := strings.Replace(writeFilesScript, "home=pwd.getpwuid(os.getuid()).pw_dir", `home=os.environ["COMPUTER_TEST_HOME"]`, 1)
	cmd := exec.Command("python3", append([]string{"-c", script}, profile...)...)
	cmd.Env = append(os.Environ(), "COMPUTER_TEST_HOME="+home)
	cmd.Stdin = strings.NewReader(f.Gitconfig + "\x00" + f.GitLabToken + "\x00" + f.ModelEnv + "\x00" + f.MulticaConfig + "\x00" + f.GitSSHKey + "\x00" + f.GitKnownHosts)
	return cmd.Run()
}
func TestCredentialWriterPreservesConfigAndRefusesSymlinks(t *testing.T) {
	home := t.TempDir()
	other := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".multica"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".multica/config.json"), []byte(`{"device_name":"keep me","token":"old"}`), 0600); err != nil {
		t.Fatal(err)
	}
	old := "[credential]\n helper = keep-existing\n"
	if err := os.WriteFile(filepath.Join(home, ".gitconfig"), []byte(old), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := RenderFiles("https://multica.example", "A \"B\" #C", "a@company.example", "https://gitlab.example", "fake-token", "OPENAI_API_KEY=fake model key", "mul_fake")
	if err != nil {
		t.Fatal(err)
	}
	if err := runWriter(t, home, f); err != nil {
		t.Fatal(err)
	}
	if err := runWriter(t, home, f); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(home, ".gitconfig"))
	if !strings.HasPrefix(string(b), old) || strings.Count(string(b), "[include]") != 1 {
		t.Fatal("config not preserved or include duplicated")
	}
	b, _ = os.ReadFile(filepath.Join(home, ".multica/config.json"))
	var m map[string]any
	if json.Unmarshal(b, &m) != nil || m["device_name"] != "keep me" || m["token"] != "mul_fake" {
		t.Fatal("config merge failed")
	}
	info, _ := os.Stat(filepath.Join(home, ".config/multica-provision/gitlab.token"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("secret permissions")
	}
	cmd := exec.Command("git", "config", "--file", filepath.Join(home, ".config/multica-provision/gitconfig"), "user.name")
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) != "A \"B\" #C" {
		t.Fatal("Git identity did not round trip")
	}
	if err := runWriter(t, home, f, "computer-test"); err != nil {
		t.Fatal(err)
	}
	profileConfig, _ := os.ReadFile(filepath.Join(home, ".multica/profiles/computer-test/config.json"))
	if !strings.Contains(string(profileConfig), "workspaces_root") {
		t.Fatal("managed profile missing private workspace root")
	}
	defaultConfig, _ := os.ReadFile(filepath.Join(home, ".multica/config.json"))
	if string(defaultConfig) != string(b) {
		t.Fatal("managed profile modified default config")
	}
	blocked := t.TempDir()
	if err := os.Symlink(other, filepath.Join(blocked, ".config")); err != nil {
		t.Fatal(err)
	}
	if err := runWriter(t, blocked, f); err == nil {
		t.Fatal("followed directory symlink")
	}
	entries, _ := os.ReadDir(other)
	if len(entries) != 0 {
		t.Fatal("wrote outside home")
	}
}
func TestPasswordTransportDistinguishesMismatchFromInfrastructure(t *testing.T) {
	remote := SSHRemote{Host: "example.com", Port: 22, User: "operator", KeyPath: "/fake/key"}
	for _, code := range []string{"1", "42", "43"} {
		cmd := exec.Command("sh", "-c", "exit "+code)
		err := cmd.Run()
		remote.RunCmd = &recordRunner{err: err}
		ok, got := remote.PasswordMatches("alice", "fake-password")
		if ok {
			t.Fatal("unexpected match")
		}
		if (got == nil) != (code == "42") {
			t.Fatalf("exit %s mismatch classification: %v", code, got)
		}
	}
}
func TestExecTimeout(t *testing.T) {
	start := time.Now()
	_, err := (execRunner{timeout: 30 * time.Millisecond}).Run([]string{"sleep", "2"}, "")
	if err == nil || time.Since(start) > time.Second {
		t.Fatal("command was not bounded")
	}
}
func TestRedactionOverlappingSecrets(t *testing.T) {
	got := redactText("abc ab redacted", "ab", "abc", "redacted")
	if got != "[redacted] [redacted] [redacted]" {
		t.Fatalf("bad redaction: %s", got)
	}
}

func TestCreateUserCompensatesPasswordFailure(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "created")
	for name, script := range map[string]string{
		"useradd":  "#!/bin/sh\n: > \"$COMPUTER_TEST_MARKER\"\n",
		"chpasswd": "#!/bin/sh\ncat >/dev/null\nexit 1\n",
		"userdel":  "#!/bin/sh\nrm -- \"$COMPUTER_TEST_MARKER\"\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	rec := &recordRunner{}
	r := SSHRemote{Host: "test", Port: 22, User: "operator", KeyPath: "/fake/key", RunCmd: rec}
	if err := r.CreateUser("alice", "fake-password"); err != nil {
		t.Fatal(err)
	}
	command := strings.TrimPrefix(rec.argv[len(rec.argv)-1], "sudo -n ")
	cmd := exec.Command("sh", "-c", command)
	cmd.Env = append(os.Environ(), "PATH="+dir+":/usr/bin:/bin", "COMPUTER_TEST_MARKER="+marker)
	cmd.Stdin = strings.NewReader(rec.stdin)
	if err := cmd.Run(); err == nil {
		t.Fatal("failed password setup reported success")
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("new account was not compensated")
	}
}

func TestDeniedAttemptsDoNotExtendLockout(t *testing.T) {
	dir := privateTempDir(t)
	store := &FileStore{Dir: dir}
	if err := store.WithKey("machine", "alice", func(a Attempt) error { _, _, err := a.Reserve(1); return err }); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "machine/alice.attempts")
	old := time.Now().Add(-14 * time.Minute)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	if err := store.WithKey("machine", "alice", func(a Attempt) error {
		_, allowed, err := a.Reserve(1)
		if allowed {
			t.Fatal("limit ignored")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(file)
	if time.Since(info.ModTime()) < 13*time.Minute {
		t.Fatal("denial extended lockout")
	}
	old = time.Now().Add(-16 * time.Minute)
	_ = os.Chtimes(file, old, old)
	if err := store.WithKey("machine", "alice", func(a Attempt) error {
		n, allowed, err := a.Reserve(1)
		if !allowed || n != 1 {
			t.Fatal("lockout did not expire")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRemotePythonScriptsParse(t *testing.T) {
	rec := &scriptRunner{}
	binary := filepath.Join(t.TempDir(), "fake-cli")
	if err := os.WriteFile(binary, []byte("not executed"), 0600); err != nil {
		t.Fatal(err)
	}
	remote := SSHRemote{Host: "fake", Port: 22, User: "operator", KeyPath: "/fake/key", RunCmd: rec, DaemonID: "test-daemon", BinaryPath: binary}
	_, _ = remote.PasswordMatches("alice", "fake-password")
	for _, err := range []error{remote.CreateUser("alice", "fake-password"), remote.Prepare(), remote.InstallDaemon("alice"), remote.RemoveDaemon("alice")} {
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, call := range rec.calls {
		command := call.argv[len(call.argv)-1]
		if !strings.Contains(command, "python3 -c") {
			continue
		}
		cmd := exec.Command("python3", "-c", `import ast,shlex,sys; a=shlex.split(sys.stdin.read()); ast.parse(a[a.index("-c")+1])`)
		cmd.Stdin = strings.NewReader(command)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("embedded Python does not parse: %s", out)
		}
	}
}
