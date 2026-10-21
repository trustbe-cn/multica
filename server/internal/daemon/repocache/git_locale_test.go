package repocache

import (
	"fmt"
	"strings"
	"testing"
)

// A daemon on a host whose system language is not English inherits a
// localized git; the branch-collision retry must still recognise git's
// error. Not parallel: t.Setenv changes the process environment.
func TestBranchCollisionRecognisedUnderLocalizedGit(t *testing.T) {
	t.Setenv("LANG", "zh_CN.UTF-8")
	t.Setenv("LC_ALL", "zh_CN.UTF-8")
	t.Setenv("LANGUAGE", "zh_CN")

	repo := createTestRepo(t)
	if err := runGit("-C", repo, "branch", "taken"); err != nil {
		t.Fatalf("create branch: %v", err)
	}
	out, err := runGitCombinedOutput("-C", repo, "branch", "taken")
	if err == nil {
		t.Fatal("creating an existing branch succeeded")
	}
	wrapped := fmt.Errorf("git branch: %s: %w", strings.TrimSpace(string(out)), err)
	if !isBranchCollisionError(wrapped) {
		t.Fatalf("branch collision not recognised from git output %q", out)
	}
}
