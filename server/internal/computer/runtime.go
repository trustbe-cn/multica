package computer

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"regexp"
	"strings"
)

const RuntimePath = "$HOME/.local/bin:$HOME/.kimi-code/bin:$HOME/.grok/bin:/usr/local/bin:/usr/bin:/bin"

var runtimeCommandRE = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.+-]*$`)

type RuntimeProbe struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	State   string `json:"state"`
	Code    string `json:"code"`
}

// ProbeRuntime distinguishes a missing executable from a failed version command.
// Only parsed metadata is returned; stderr may contain credentials and is discarded.
func (s SSHRemote) ProbeRuntime(ctx context.Context, username, command string) (RuntimeProbe, error) {
	if err := validateUsername(username); err != nil {
		return RuntimeProbe{}, err
	}
	if !runtimeCommandRE.MatchString(command) {
		return RuntimeProbe{}, errors.New("invalid runtime command name")
	}
	script := `import json,shutil,subprocess,sys
p=shutil.which(sys.argv[1])
r={"path":p or "","version":"","state":"missing","code":"cli_missing"}
if p:
    r.update(state="version_failed",code="version_check_failed")
    try:
        c=subprocess.run([p,"--version"],capture_output=True,text=True,timeout=15)
        if c.returncode==0 and c.stdout.strip():
            r.update(state="installed",code="",version=c.stdout.strip()[:512])
    except (OSError,subprocess.TimeoutExpired): pass
print(json.dumps(r))`
	cmd := "sudo -n runuser -u " + ShellQuote(username) + " -- sh -c " + ShellQuote("export PATH=\""+RuntimePath+"\"; exec python3 -c "+ShellQuote(script)+" "+ShellQuote(command))
	out, err := s.RunCommandContext(ctx, cmd)
	if err != nil {
		return RuntimeProbe{}, err
	}
	var p RuntimeProbe
	err = json.Unmarshal([]byte(out), &p)
	if err == nil && p.State != "missing" && p.State != "version_failed" && p.State != "installed" {
		err = errors.New("invalid probe response")
	}
	return p, err
}

// ErrorCode maps transport and known prerequisite failures to safe public codes.
// Callers store a fixed summary rather than arbitrary SSH output.
func ErrorCode(err error, fallback string) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "ssh_timeout"
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 255 {
		return "ssh_unreachable"
	}
	s := strings.ToLower(err.Error())
	for _, pair := range [][2]string{
		{"context deadline exceeded", "ssh_timeout"}, {"context canceled", "cancelled"}, {"exit status 255", "ssh_unreachable"}, {"exit status 43", "account_unavailable"}, {"package_manager_failed", "package_manager_failed"}, {"sudo:", "sudo_failed"}, {"unknown user", "account_missing"}, {"does not exist", "account_missing"},
		{"authentication failure", "account_unavailable"}, {"password mismatch", "password_mismatch"},
		{"locked", "password_locked"}, {"node.js and npm", "node_npm_missing"}, {"bun: not found", "bun_missing"},
		{"apt-get", "package_manager_failed"}, {"dpkg", "package_manager_failed"},
		{"timed out", "ssh_timeout"}, {"connection refused", "ssh_unreachable"}, {"host key verification failed", "ssh_unreachable"},
	} {
		if strings.Contains(s, pair[0]) {
			return pair[1]
		}
	}
	return fallback
}

func ErrorSummary(code string) string {
	switch code {
	case "account_missing":
		return "Linux account does not exist; provision it again."
	case "account_unavailable":
		return "Linux account is unavailable; ask an administrator to check expiry and login policy."
	case "password_mismatch":
		return "Password did not match; enter the Linux password again."
	case "password_locked":
		return "Too many password attempts; wait 15 minutes before retrying."
	case "ssh_unreachable", "ssh_timeout":
		return "Check the Computer connection with an administrator, then retry."
	case "sudo_failed":
		return "An administrator must restore passwordless sudo for the SSH operator."
	case "package_manager_failed":
		return "An administrator must repair the package manager before retrying provisioning."
	case "node_npm_missing":
		return "Install Node.js and npm in /usr/local/bin or /usr/bin, then retry."
	case "bun_missing":
		return "Install the supported standalone runtime or make Bun available in the managed PATH."
	case "cli_missing":
		return "CLI executable is missing; install the runtime."
	case "version_check_failed":
		return "CLI exists but its version command failed; repair its dependencies or reinstall."
	case "daemon_offline":
		return "Daemon has not registered; check connectivity, then sync or upgrade."
	case "interrupted":
		return "Operation ended without a confirmed result; check the account and installed assets before retrying."
	case "cancelled":
		return "Operation was cancelled before execution; submit it again to retry."
	case "account_delete_failed":
		return "Account deletion failed; check running processes and permissions before retrying."
	default:
		return "Remote step failed; check prerequisites and retry the displayed operation."
	}
}
