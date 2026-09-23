package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestInstanceAdminBootstrapPrecedence(t *testing.T) {
	old, exists := os.LookupEnv("MULTICA_INSTANCE_ADMIN_IDS")
	t.Cleanup(func() {
		if exists {
			os.Setenv("MULTICA_INSTANCE_ADMIN_IDS", old)
		} else {
			os.Unsetenv("MULTICA_INSTANCE_ADMIN_IDS")
		}
	})
	os.Unsetenv("MULTICA_INSTANCE_ADMIN_IDS")
	t.Setenv("MULTICA_COMPUTER_OPERATOR_IDS", testUserID)
	if !isInstanceAdmin(testUserID) {
		t.Fatal("legacy bootstrap lost")
	}
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", "")
	if isInstanceAdmin(testUserID) || isInstanceAdmin("") {
		t.Fatal("explicit empty must revoke")
	}
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", "10000000-0000-0000-0000-000000000099")
	if isInstanceAdmin(testUserID) {
		t.Fatal("legacy fallback must not extend explicit list")
	}
}
func TestInstanceAdminBoundaryAndAudit(t *testing.T) {
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", "")
	// testUserID is a workspace owner, but still cannot administer the instance.
	for _, fn := range []http.HandlerFunc{testHandler.AdminComputers, testHandler.AdminComputerBindings, testHandler.AdminComputerAudit, testHandler.UpdateAdminComputer} {
		testutil.Call(t, fn, computerTestRequest("GET", "/", nil)).Want(403)
	}
	testutil.Call(t, testHandler.Computers, computerTestRequest("POST", "/api/computers", map[string]any{"name": "test"})).Want(403)
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", testUserID)
	var created struct {
		ID string `json:"id"`
	}
	testutil.Call(t, testHandler.AdminComputers, computerTestRequest("POST", "/api/admin/computers", map[string]any{"name": "admin-test", "host": "fake.invalid", "port": 22, "ssh_user": "operator"})).Want(201).JSON(&created)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM computer_audit WHERE computer_id=$1`, created.ID)
		testPool.Exec(context.Background(), `DELETE FROM computer WHERE id=$1`, created.ID)
	})
	patch := func(body any) *http.Request {
		return withURLParam(computerTestRequest("PATCH", "/", body), "id", created.ID)
	}
	testutil.Call(t, testHandler.UpdateAdminComputer, patch(map[string]any{"host": "new.invalid"})).Want(200)
	binding := dbfx.Insert(t, "computer_binding", testutil.Cols{"computer_id": created.ID, "user_id": testUserID, "workspace_id": testWorkspaceID, "username": "alice"})
	_ = binding
	testutil.Call(t, testHandler.UpdateAdminComputer, patch(map[string]any{"host": "wrong.invalid"})).Want(409)
	testutil.Call(t, testHandler.UpdateAdminComputer, patch(map[string]any{"enabled": false})).Want(200)
	var machines []adminComputer
	testutil.Call(t, testHandler.AdminComputers, computerTestRequest("GET", "/", nil)).Want(200).JSON(&machines)
	found := false
	for _, m := range machines {
		if m.ID == created.ID {
			found = true
			if m.Enabled || m.Host != "new.invalid" {
				t.Fatal("bad update")
			}
		}
	}
	if !found {
		t.Fatal("disabled machine missing from admin")
	}
	var audit []map[string]any
	testutil.Call(t, testHandler.AdminComputerAudit, computerTestRequest("GET", "/", nil)).Want(200).JSON(&audit)
	found = false
	for _, a := range audit {
		if a["computer_id"] == created.ID && a["action"] == "disable" {
			found = true
		}
	}
	if !found {
		t.Fatal("admin mutation missing audit")
	}
	testutil.Call(t, testHandler.AdminComputerBindings, computerTestRequest("GET", "/", nil)).Want(200)
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", "")
	testutil.Call(t, testHandler.UpdateAdminComputer, patch(map[string]any{"enabled": true})).Want(403)
	rec := testutil.Call(t, testHandler.Computers, computerTestRequest("GET", "/", nil)).Want(200)
	var public []json.RawMessage
	rec.JSON(&public)
	for _, m := range public {
		var v struct{ ID string }
		json.Unmarshal(m, &v)
		if v.ID == created.ID {
			t.Fatal("disabled machine selectable")
		}
	}
}

func TestDisabledComputerVisibleOnlyForOwnerCleanup(t *testing.T) {
	t.Setenv("MULTICA_INSTANCE_ADMIN_IDS", "")
	machine := dbfx.Insert(t, "computer", testutil.Cols{"name": "disabled-owned", "host": "private.invalid", "port": 22, "ssh_user": "operator", "created_by": testUserID, "enabled": false})
	dbfx.Insert(t, "computer_binding", testutil.Cols{"computer_id": machine, "user_id": testUserID, "workspace_id": testWorkspaceID, "username": "alice", "verified": true})
	var list []adminComputer
	testutil.Call(t, testHandler.Computers, computerTestRequest("GET", "/", nil)).Want(200).JSON(&list)
	found := false
	for _, m := range list {
		if m.ID == machine {
			found = true
			if m.Enabled || m.Host != "" || m.Port != 0 || m.SSHUser != "" {
				t.Fatal("disabled cleanup list leaked connection or availability")
			}
		}
	}
	if !found {
		t.Fatal("owner cannot choose disabled machine for removal")
	}
	req := computerTestRequest("GET", "/", nil)
	req.Header.Set("X-User-ID", "10000000-0000-0000-0000-000000000099")
	testutil.Call(t, testHandler.Computers, req).Want(200).JSON(&list)
	for _, m := range list {
		if m.ID == machine {
			t.Fatal("non-owner can see disabled Computer")
		}
	}
}
