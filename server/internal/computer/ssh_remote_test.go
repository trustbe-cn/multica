package computer

import (
	"strings"
	"testing"
)

type recordRunner struct {
	argv  []string
	stdin string
	out   string
	err   error
}

func (r *recordRunner) Run(argv []string, stdin string) (string, error) {
	r.argv = append([]string{}, argv...)
	r.stdin = stdin
	return r.out, r.err
}

func TestSSHArgsDoNotCarrySecrets(t *testing.T) {
	rec := &recordRunner{}
	remote := SSHRemote{Host: "gpu-pc", Port: 22, User: "bastion", KeyPath: "/home/tiger/.ssh/id_ed25519", RunCmd: rec, DaemonID: "test-daemon"}
	ok, err := remote.PasswordMatches("zhang", "s3cret-password")
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	joined := strings.Join(rec.argv, " ")
	if strings.Contains(joined, "s3cret-password") {
		t.Fatalf("password leaked onto argv: %s", joined)
	}
	if !strings.Contains(rec.stdin, "s3cret-password") {
		t.Fatal("password was not passed on stdin")
	}
	if !strings.Contains(joined, "BatchMode=yes") || !strings.Contains(joined, "bastion@gpu-pc") {
		t.Fatalf("argv: %s", joined)
	}
}

type scriptRunner struct {
	calls []recordRunner
	err   error
}

func (s *scriptRunner) Run(argv []string, stdin string) (string, error) {
	s.calls = append(s.calls, recordRunner{argv: append([]string{}, argv...), stdin: stdin})
	if s.err != nil && strings.Contains(stdin, "s3cret-password") {
		return "leaked " + stdin, s.err
	}
	return "", nil
}

func TestSSHCommandsHideSecrets(t *testing.T) {
	const password = "s3cret-password"
	const token = "glpat-real"
	rec := &scriptRunner{}
	remote := SSHRemote{Host: "gpu-pc", Port: 22, User: "bastion", KeyPath: "/home/tiger/.ssh/id_ed25519", RunCmd: rec, DaemonID: "test-daemon"}
	if err := remote.CreateUser("zhang", password); err != nil {
		t.Fatal(err)
	}
	files, err := RenderFiles("http://10.10.0.31:3000", "Zhang", "zhang@company.example", "http://10.12.0.79", token, "ANTHROPIC_API_KEY=sk-model", "mul_pat")
	if err != nil {
		t.Fatal(err)
	}
	if err := remote.WriteFiles("zhang", files); err != nil {
		t.Fatal(err)
	}
	if err := remote.InstallDaemon("zhang"); err != nil {
		t.Fatal(err)
	}
	if len(rec.calls) < 4 {
		t.Fatalf("calls=%d", len(rec.calls))
	}
	for _, call := range rec.calls {
		joined := strings.Join(call.argv, " ")
		for _, secret := range []string{password, token, "mul_pat", "sk-model"} {
			if strings.Contains(joined, secret) {
				t.Fatalf("secret %q in argv: %s", secret, joined)
			}
		}
	}
	leaky := &scriptRunner{err: errString("exit status 1")}
	remote.RunCmd = leaky
	err = remote.CreateUser("zhang", password)
	if err == nil || strings.Contains(err.Error(), password) {
		t.Fatalf("error echoed stdin: %v", err)
	}
}

func TestSSHRejectsDotHost(t *testing.T) {
	remote := SSHRemote{Host: "..", Port: 22, User: "bastion", KeyPath: "/tmp/key"}
	if _, err := remote.UserExists("zhang"); err == nil {
		t.Fatal("accepted .. host")
	}
}
