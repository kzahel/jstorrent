import { useRef } from "react";

import { useNarrowViewport } from "../layout";
import { Icon } from "./Icon";
import { MoreActionsMenu } from "./MoreActionsMenu";
import { useTorrentActions } from "./TorrentActionContext";
import { AddTorrentForm, useTorrentAdd } from "./TorrentAdd";
import styles from "./TorrentActions.module.css";

interface TorrentActionsProps {
  /** Shows the add field here; wide layouts put it in the header. */
  readonly showAddForm?: boolean;
  /** Receives the end of the bar, where the torrent table puts its controls. */
  readonly tableToolbarRef?: (element: HTMLDivElement | null) => void;
}

export function TorrentActions({
  showAddForm = false,
  tableToolbarRef,
}: TorrentActionsProps) {
  const { pendingAction, selectedTargetIds, actionsFor, runAction } =
    useTorrentActions();
  const { demo, busy, addTestDisabled, addTestTorrent, addAllTestTorrents } =
    useTorrentAdd();
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  const resolvedActions = actionsFor();
  // Narrow bars keep one row: actions show their icons alone.
  const narrow = useNarrowViewport();
  const directActions = resolvedActions.filter(
    (action) => action.placement === "direct",
  );
  const overflowActions = resolvedActions.filter(
    (action) => action.placement === "overflow",
  );

  return (
    <div className={styles.toolbar}>
      {showAddForm ? (
        <>
          <AddTorrentForm />
          {demo ? <span className={styles.divider} aria-hidden="true" /> : null}
        </>
      ) : null}
      {directActions
        .filter((action) => action.id !== "remove")
        .map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={busy || action.disabled}
            title={action.disabledReason ?? action.resolvedLabel}
            aria-label={narrow ? action.resolvedLabel : undefined}
            onClick={() => void runAction(action.id)}
          >
            <Icon name={action.icon} />
            {narrow ? null : <> {action.resolvedLabel}</>}
          </button>
        ))}
      {!demo || selectedTargetIds.length > 0 ? (
        <MoreActionsMenu
          disabled={busy}
          actions={overflowActions}
          showTestTorrents={!demo}
          addTestDisabled={addTestDisabled || pendingAction !== null}
          onAction={(actionId, trigger) => void runAction(actionId, undefined, {
            type: "toolbar",
            element: trigger,
          })}
          onAddTestTorrent={addTestTorrent}
          onAddAllTestTorrents={addAllTestTorrents}
        />
      ) : null}
      {directActions
        .filter((action) => action.id === "remove")
        .map((action) => (
          <button
            key={action.id}
            ref={removeButtonRef}
            type="button"
            disabled={busy || action.disabled}
            title={action.disabledReason ?? action.resolvedLabel}
            aria-label={narrow ? action.resolvedLabel : undefined}
            onClick={() =>
              void runAction(action.id, undefined, {
                type: "toolbar",
                element: removeButtonRef.current,
              })
            }
          >
            <Icon name={action.icon} />
            {narrow ? null : <> {action.resolvedLabel}</>}
          </button>
        ))}
      {tableToolbarRef === undefined ? null : (
        <div ref={tableToolbarRef} className={styles.tableToolbar} />
      )}
    </div>
  );
}
