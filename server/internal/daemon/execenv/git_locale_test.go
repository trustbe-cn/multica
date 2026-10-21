package execenv

import (
	"testing"
)

// A daemon on a host whose system language is not English inherits a
// localized git; checks that match git's own error text must still work.
// Not parallel: t.Setenv changes the process environment.
func TestGitErrorTextRecognisedUnderLocalizedGit(t *testing.T) {
	t.Setenv("LANG", "zh_CN.UTF-8")
	t.Setenv("LC_ALL", "zh_CN.UTF-8")
	t.Setenv("LANGUAGE", "zh_CN")

	repo := newTestRepo(t)
	if _, err := runGit(repo, "branch", "taken"); err != nil {
		t.Fatalf("create branch: %v", err)
	}

	t.Run("branch collision", func(t *testing.T) {
		out, err := runGit(repo, "branch", "taken")
		if err == nil {
			t.Fatal("creating an existing branch succeeded")
		}
		if !branchUnavailable(out) {
			t.Fatalf("branch collision not recognised from git output %q", out)
		}
	})

	t.Run("worktree add retries a taken branch name", func(t *testing.T) {
		worktree := t.TempDir()
		if err := setupGitWorktree(repo, worktree, "taken", "HEAD"); err != nil {
			t.Fatalf("setupGitWorktree with a taken branch name: %v", err)
		}
	})
}
