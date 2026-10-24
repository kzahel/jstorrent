import { message as localizedMessage } from "../../localization/runtime";
import { useEffect, useRef, useState } from "react";

import {
  WEBTORRENT_TEST_TORRENTS,
  type TestTorrentShortcut,
} from "../testTorrents";
import type { TorrentActionId } from "../torrent-actions";
import { useNarrowViewport } from "../layout";
import { Icon } from "./Icon";
import type { ResolvedTorrentAction } from "./TorrentActionContext";
import { TorrentActionMenuItems } from "./TorrentActionMenuItems";
import {
  ActionMenuPopover,
  ActionMenuSeparator,
  ActionMenuTrigger,
  ActionMenuItem,
  ActionSubmenu,
  OverlayButton,
} from "./overlays/AnchoredOverlay";
import styles from "./MoreActionsMenu.module.css";

export interface MoreActionsMenuProps {
  readonly disabled: boolean;
  readonly actions: readonly ResolvedTorrentAction[];
  readonly showTestTorrents: boolean;
  readonly addTestDisabled: boolean;
  readonly onAction: (actionId: TorrentActionId, trigger: HTMLElement | null) => void;
  readonly onAddTestTorrent: (torrent: TestTorrentShortcut) => Promise<void>;
  readonly onAddAllTestTorrents: () => Promise<void>;
}

export function MoreActionsMenu({
  disabled,
  actions,
  showTestTorrents,
  addTestDisabled,
  onAction,
  onAddTestTorrent,
  onAddAllTestTorrents,
}: MoreActionsMenuProps) {
  const [open, setOpen] = useState(false);
  // Narrow toolbars show the overflow icon alone.
  const narrow = useNarrowViewport();
  const label = localizedMessage("inspection.components.more.actions.menu.more");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <ActionMenuTrigger
      isDisabled={disabled}
      isOpen={open}
      onOpenChange={setOpen}
    >
      <OverlayButton
        ref={triggerRef}
        className={styles.trigger!}
        isDisabled={disabled}
        {...(narrow ? { "aria-label": label } : {})}
      >
        {narrow ? null : <>{label}{" "}</>}
        <Icon name={narrow ? "moreVertical" : "chevronDown"} />
      </OverlayButton>
      <ActionMenuPopover>
        <TorrentActionMenuItems actions={actions} onAction={(actionId) => onAction(actionId, triggerRef.current)} />
        {showTestTorrents ? (
          <>
            {actions.length === 0 ? null : <ActionMenuSeparator />}
            <ActionSubmenu
              isDisabled={addTestDisabled}
              trigger={
                <>
                  <Icon name="plus" />
                  <span>{localizedMessage("inspection.components.more.actions.menu.add.test.torrent")}</span>
                </>
              }
            >
              <ActionMenuItem onAction={() => void onAddAllTestTorrents()}>
                {localizedMessage("inspection.components.more.actions.menu.add.all.sample.torrents")}
              </ActionMenuItem>
              <ActionMenuSeparator />
              {WEBTORRENT_TEST_TORRENTS.map((torrent) => (
                <ActionMenuItem
                  key={torrent.id}
                  onAction={() => void onAddTestTorrent(torrent)}
                >
                  {torrent.menuLabel}
                </ActionMenuItem>
              ))}
            </ActionSubmenu>
          </>
        ) : null}
      </ActionMenuPopover>
    </ActionMenuTrigger>
  );
}
