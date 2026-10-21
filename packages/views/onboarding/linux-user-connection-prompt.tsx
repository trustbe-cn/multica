"use client";

import { useAuthStore } from "@multica/core/auth";
import { useLinuxUserConnectionStore } from "@multica/core/onboarding";
import { paths, useCurrentWorkspace } from "@multica/core/paths";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";

/**
 * One-shot offer, after onboarding creates a workspace, to connect a Linux
 * User to it. Settings keeps the same action available afterwards.
 */
export function LinuxUserConnectionPrompt() {
  const { t } = useT("settings");
  const navigation = useNavigation();
  const userId = useAuthStore((state) => state.user?.id);
  const currentWorkspace = useCurrentWorkspace();
  const offer = useLinuxUserConnectionStore((state) => state.offer);
  const dismiss = useLinuxUserConnectionStore((state) => state.dismiss);

  if (
    !offer ||
    !currentWorkspace ||
    offer.userId !== userId ||
    offer.workspaceId !== currentWorkspace.id
  ) {
    return null;
  }

  return (
    <Dialog
      open
      modal
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $.workspace_linux_users.prompt_title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.workspace_linux_users.prompt_description)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            {t(($) => $.workspace_linux_users.prompt_later)}
          </Button>
          <Button
            onClick={() => {
              dismiss();
              navigation.push(
                `${paths.workspace(currentWorkspace.slug).settings()}?tab=linux-users`,
              );
            }}
          >
            {t(($) => $.workspace_linux_users.prompt_connect)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
