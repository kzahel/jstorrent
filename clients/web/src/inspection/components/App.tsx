import { RemotePlaybackProvider } from "./RemoteVideoPlayer";
import jstorrentIcon from "../../assets/jstorrent.png";
import { message as localizedMessage } from "../../localization/runtime";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  applyAppearancePreferences,
  DEFAULT_COLOR_THEME,
  DEFAULT_DATA_UNITS,
  DEFAULT_INTERFACE_SIZE,
} from "../appearance";
import { useInspectionCommand, useInspectionController, useInspectionStore } from "../context";
import type { InspectionController } from "../controller";
import {
  APPLICATION_TITLE,
  DocumentTitleThrottle,
  documentTitleForSession,
} from "../document-title";
import { formatRate } from "../format";
import {
  loadCredentialFreeNoticeDismissed,
  saveCredentialFreeNoticeDismissed,
} from "../lan-none-notice";
import { layoutForWidth } from "../layout";
import { MAX_DETAIL_PANE_PERCENT, MIN_DETAIL_PANE_PERCENT } from "../state";
import type { AboutFacts } from "../support/about";
import type { DesktopUpdater, UpdaterState } from "../updater/types";
import { useDesktopUpdater } from "../updater/useDesktopUpdater";
import {
  ConnectionOverlay,
  connectionInterrupted,
  useConnectionClock,
} from "./ConnectionOverlay";
import { DetailPane } from "./DetailPane";
import { Icon } from "./Icon";
import { LibraryView } from "./LibraryView";
import { ScenarioBar } from "./ScenarioBar";
import { SettingsDialog, type SettingsCategory } from "./SettingsDialog";
import { navigationTitle, Sidebar } from "./Sidebar";
import { TorrentActions } from "./TorrentActions";
import { TorrentActionProvider } from "./TorrentActionContext";
import { ToastProvider } from "./Toast";
import { TorrentTable } from "./TorrentTable";
import { TransfersView } from "./TransfersView";
import { TableToolbarSlot } from "./VirtualTable";
import styles from "./App.module.css";
import type { WebAuthClient } from "../../web-auth-client";
import type { DesktopExternalIntake } from "../../desktop-external-intake";
import { DesktopExternalIntakeProvider } from "../desktop-external-intake-context";
import type { DesktopNotifications } from "../desktop-notifications/types";
import type { DesktopPower } from "../desktop-power/types";
import type { DesktopRemoteAccess } from "../remote-access/types";
import type {
  HostedAccessMode,
  HostedProduct,
} from "../../headless-updater";
import type { ProductPrivacyController } from "../product-privacy/types";
import { ProductDisclosure } from "./ProductPrivacy";

function waitForTorrentRemoval(
  controller: InspectionController,
  torrentId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const row = controller.store.getState().torrents[torrentId];
      if (row === undefined) return "complete";
      if (row.removalState === "failed") return "failed";
      return "pending";
    };
    const initial = inspect();
    if (initial === "complete") return resolve();
    if (initial === "failed") return reject(new Error("Torrent removal failed."));
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Torrent removal is still pending. Check the torrent and retry."));
    }, 300_000);
    const check = () => {
      const state = inspect();
      if (state === "pending") return;
      window.clearTimeout(timeout);
      unsubscribe();
      if (state === "complete") resolve();
      else reject(new Error("Torrent removal failed. Check the torrent and retry."));
    };
    unsubscribe = controller.store.subscribe(check);
    check();
  });
}

export interface AppProps {
  readonly oneCurrentRoot?: boolean | undefined;
  readonly webAuth?: WebAuthClient | undefined;
  readonly updater?: DesktopUpdater | undefined;
  readonly externalIntake?: DesktopExternalIntake | undefined;
  readonly notifications?: DesktopNotifications | undefined;
  readonly power?: DesktopPower | undefined;
  readonly remoteAccess?: DesktopRemoteAccess | undefined;
  readonly accessMode?: HostedAccessMode | undefined;
  readonly hostedProduct?: HostedProduct | undefined;
  readonly productPrivacy?: ProductPrivacyController | undefined;
  readonly about?: AboutFacts | undefined;
}

export function App({
  oneCurrentRoot,
  webAuth,
  updater,
  externalIntake,
  notifications,
  power,
  remoteAccess,
  accessMode,
  hostedProduct,
  productPrivacy,
  about,
}: AppProps) {
  const connection = useInspectionStore((state) => state.session.connection);
  const controller = useInspectionController();
  const connectionNowMs = useConnectionClock(connection.type === "reconnecting");
  const interrupted = connectionInterrupted(connection, connectionNowMs);
  return (
    <ToastProvider>
      <DesktopExternalIntakeProvider intake={externalIntake}>
        <RemotePlaybackProvider remoteAccess={remoteAccess}>
          <TorrentActionProvider>
            <AppContent
              interrupted={interrupted}
              webAuth={webAuth}
              updater={updater}
              notifications={notifications}
              power={power}
              remoteAccess={remoteAccess}
              accessMode={accessMode}
              hostedProduct={hostedProduct}
              productPrivacy={productPrivacy}
              about={about}
              oneCurrentRoot={oneCurrentRoot}
            />
            {interrupted ? (
              <ConnectionOverlay
                connection={connection}
                nowMs={connectionNowMs}
                onRetry={() => controller.reconnectNow()}
                onReload={() => window.location.reload()}
              />
            ) : null}
          </TorrentActionProvider>
        </RemotePlaybackProvider>
      </DesktopExternalIntakeProvider>
    </ToastProvider>
  );
}

function AppContent({
  interrupted,
  oneCurrentRoot,
  webAuth,
  updater,
  notifications,
  power,
  remoteAccess,
  accessMode,
  hostedProduct,
  productPrivacy,
  about,
}: AppProps & { readonly interrupted: boolean }) {
  const session = useInspectionStore((state) => state.session);
  const demo = useInspectionStore((state) => state.demo);
  const storage = useInspectionStore((state) => state.storage);
  const clientSettings = useInspectionStore((state) => state.clientSettings);
  const execute = useInspectionCommand();
  const controller = useInspectionController();
  const destination = useInspectionStore(
    (state) => state.presentation.destination,
  );
  const detailOpen = useInspectionStore(
    (state) => state.presentation.detailOpen,
  );
  const libraryDetailOpen = useInspectionStore(
    (state) => state.presentation.libraryDetailOpen,
  );
  const sidebarOpen = useInspectionStore(
    (state) => state.presentation.sidebarOpen,
  );
  const layout = useInspectionStore((state) => state.presentation.layout);
  const detailPanePercent = useInspectionStore(
    (state) => state.presentation.detailPanePercent,
  );
  const interfaceSize = useInspectionStore(
    (state) => state.presentation.interfaceSize,
  );
  const colorTheme = useInspectionStore(
    (state) => state.presentation.colorTheme,
  );
  const dataUnits = useInspectionStore((state) => state.presentation.dataUnits);
  const title = useInspectionStore((state) =>
    navigationTitle(state.presentation),
  );
  const toggleSidebar = useInspectionStore((state) => state.toggleSidebar);
  const closeSidebar = useInspectionStore((state) => state.closeSidebar);
  const setLayout = useInspectionStore((state) => state.setLayout);
  const setDetailPanePercent = useInspectionStore(
    (state) => state.setDetailPanePercent,
  );
  const setInterfaceSize = useInspectionStore(
    (state) => state.setInterfaceSize,
  );
  const setColorTheme = useInspectionStore((state) => state.setColorTheme);
  const setDataUnits = useInspectionStore((state) => state.setDataUnits);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const waitingForUnmeteredNetwork =
    clientSettings.application_network.requested_prerequisite ===
      "waiting_for_unmetered_network" &&
    clientSettings.application_network.state !== "allowed";
  const credentialFreeAccessMode =
    accessMode === "lan_none" || accessMode === "network_none"
      ? accessMode
      : null;
  const [credentialFreeNoticeDismissed, setCredentialFreeNoticeDismissed] =
    useState(() =>
      credentialFreeAccessMode === null
        ? false
        : loadCredentialFreeNoticeDismissed(credentialFreeAccessMode),
    );
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("appearance");
  const updaterSnapshot = useDesktopUpdater(updater);
  const [resizingDetail, setResizingDetail] = useState(false);
  const [collectionToolbar, setCollectionToolbar] =
    useState<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const activeSplitterPointer = useRef<number | null>(null);
  const titleThrottleRef = useRef<DocumentTitleThrottle | null>(null);

  useLayoutEffect(() => {
    applyAppearancePreferences({ colorTheme, interfaceSize });
  }, [colorTheme, interfaceSize]);

  useEffect(() => {
    if (
      updaterSnapshot !== undefined &&
      presentsManualUpdateResult(updaterSnapshot.state)
    ) {
      setSettingsCategory("about");
      setSettingsOpen(true);
    }
  }, [updaterSnapshot]);

  const desiredDocumentTitle = documentTitleForSession(session, dataUnits);
  const showRates =
    session.downloadRate > 0 || (session.uploadRate ?? 0) > 0;

  useEffect(() => {
    const throttle =
      titleThrottleRef.current ??
      new DocumentTitleThrottle((title) => {
        document.title = title;
      }, document.title);
    titleThrottleRef.current = throttle;
    throttle.update(desiredDocumentTitle);
  }, [desiredDocumentTitle]);

  useEffect(() => {
    return () => {
      titleThrottleRef.current?.dispose(APPLICATION_TITLE);
      titleThrottleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const update = () => setLayout(layoutForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [setLayout]);

  const resizeDetailFromPointer = (clientY: number) => {
    const mainBounds = mainRef.current?.getBoundingClientRect();
    const splitterBounds = splitterRef.current?.getBoundingClientRect();
    if (mainBounds === undefined || splitterBounds === undefined) return;
    const availableHeight = mainBounds.height - splitterBounds.height;
    if (availableHeight <= 0) return;
    const detailHeight =
      mainBounds.bottom - clientY - splitterBounds.height / 2;
    setDetailPanePercent((detailHeight / availableHeight) * 100);
  };

  const startDetailResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activeSplitterPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizingDetail(true);
    resizeDetailFromPointer(event.clientY);
  };

  const continueDetailResize = (event: PointerEvent<HTMLDivElement>) => {
    if (activeSplitterPointer.current !== event.pointerId) return;
    resizeDetailFromPointer(event.clientY);
  };

  const stopDetailResize = (event: PointerEvent<HTMLDivElement>) => {
    if (activeSplitterPointer.current !== event.pointerId) return;
    activeSplitterPointer.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingDetail(false);
  };

  const resizeDetailWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextPercent: number | undefined;
    switch (event.key) {
      case "ArrowUp":
        nextPercent = detailPanePercent + 5;
        break;
      case "ArrowDown":
        nextPercent = detailPanePercent - 5;
        break;
      case "Home":
        nextPercent = MIN_DETAIL_PANE_PERCENT;
        break;
      case "End":
        nextPercent = MAX_DETAIL_PANE_PERCENT;
        break;
    }
    if (nextPercent === undefined) return;
    event.preventDefault();
    setDetailPanePercent(nextPercent);
  };

  const paneGridStyle = {
    "--collection-pane-share": `${100 - detailPanePercent}fr`,
    "--detail-pane-share": `${detailPanePercent}fr`,
  } as CSSProperties;

  return (
    <div
      className={styles.app}
      inert={interrupted}
      data-connection={session.connection.type}
      data-destination={destination}
      data-detail-open={detailOpen}
      data-library-detail-open={libraryDetailOpen}
      data-interface-size={interfaceSize}
      data-sidebar-open={sidebarOpen}
    >
      <header className={styles.header}>
        <button
          className={styles.menuButton}
          type="button"
          aria-label={localizedMessage("inspection.components.app.toggle.navigation")}
          aria-expanded={sidebarOpen}
          onClick={toggleSidebar}
        >
          <Icon name="menu" />
        </button>
        <div className={styles.brand}>
          <img src={jstorrentIcon} width="32" height="32" alt="" />
          <strong>{localizedMessage("inspection.components.app.rstorrent")}</strong>
        </div>
        <strong className={styles.locationTitle}>{title}</strong>
        {showRates ? (
          <div
            className={styles.sessionStats}
            aria-label={localizedMessage("inspection.components.app.session.transfer.rates")}
          >
            <span>
              <b aria-hidden="true">↓</b>{" "}
              {formatRate(session.downloadRate, dataUnits)}
            </span>
            <span>
              <b aria-hidden="true">↑</b>{" "}
              {formatRate(session.uploadRate, dataUnits)}
            </span>
          </div>
        ) : null}
        {credentialFreeAccessMode !== null ? (
          <span
            className={styles.lanAccessStatus}
            aria-label={localizedMessage("inspection.components.app.network.access.has.no.authentication")}
            title={localizedMessage("inspection.components.app.authentication.is.off.every.device.that.can")}
          >{localizedMessage("inspection.components.app.no.auth")}</span>
        ) : null}
        <button
          ref={settingsButtonRef}
          className={styles.settingsButton}
          type="button"
          aria-label={localizedMessage("inspection.components.app.settings")}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title={localizedMessage("inspection.components.app.settings")}
          onClick={() => {
            setSettingsCategory("appearance");
            setSettingsOpen(true);
          }}
        >
          <Icon name="settings" />
        </button>
      </header>
      {waitingForUnmeteredNetwork ||
      (credentialFreeAccessMode !== null &&
        !credentialFreeNoticeDismissed) ? (
        <div className={styles.topNotices}>
          {waitingForUnmeteredNetwork ? (
            <aside
              className={styles.networkWaiting}
              role="status"
              aria-label={localizedMessage("inspection.components.app.network.prerequisite.status")}
            >
              <strong>{localizedMessage("inspection.components.app.waiting.for.wifi")}</strong>
              <span>{localizedMessage("inspection.components.app.transfers.will.resume.automatically.when.one.is")}</span>
            </aside>
          ) : null}
          {credentialFreeAccessMode !== null &&
          !credentialFreeNoticeDismissed ? (
            <aside
              className={styles.lanWarning}
              aria-label={localizedMessage("inspection.components.app.network.security.notice")}
            >
              <span className={styles.lanWarningMessage}>
                <strong>{localizedMessage("inspection.components.app.authentication.is.off")}</strong>
                <span>
                  {credentialFreeAccessMode === "network_none"
                    ? localizedMessage("inspection.components.app.every.device.that.can.reach.this.service")
                    : localizedMessage("inspection.components.app.every.device.on.this.lan.has.full")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setCredentialFreeNoticeDismissed(true);
                  saveCredentialFreeNoticeDismissed(credentialFreeAccessMode);
                }}
              >{localizedMessage("inspection.components.app.got.it")}</button>
            </aside>
          ) : null}
          <ScenarioBar />
        </div>
      ) : (
        <ScenarioBar />
      )}
      <div className={styles.workspace}>
        <div className={styles.sidebarWrap}>
          <Sidebar />
        </div>
        <button
          className={styles.scrim}
          type="button"
          aria-label={localizedMessage("inspection.components.app.close.navigation")}
          onClick={closeSidebar}
        />
        <main
          ref={mainRef}
          className={styles.main}
          data-destination={destination}
          data-resizing={resizingDetail}
          style={paneGridStyle}
        >
          {destination === "library" ? (
            <LibraryView />
          ) : destination === "transfers" ? (
            <TransfersView
              showCrostiniStorageHelp={hostedProduct === "crostini"}
              oneCurrentRoot={oneCurrentRoot === true}
            />
          ) : (
            <>
              <section
                className={styles.collection}
                aria-label={localizedMessage("inspection.components.app.workbench.torrent.collection")}
              >
                <TorrentActions
                  showCrostiniStorageHelp={hostedProduct === "crostini"}
                  oneCurrentRoot={oneCurrentRoot === true}
                  tableToolbarRef={setCollectionToolbar}
                />
                <div className={styles.tableWrap}>
                  <TableToolbarSlot.Provider
                    value={layout === "phone" ? null : collectionToolbar}
                  >
                    <TorrentTable />
                  </TableToolbarSlot.Provider>
                </div>
              </section>
              <div
                ref={splitterRef}
                className={styles.splitter}
                role="separator"
                aria-label={localizedMessage("inspection.components.app.resize.torrent.details")}
                aria-orientation="horizontal"
                aria-valuemin={MIN_DETAIL_PANE_PERCENT}
                aria-valuemax={MAX_DETAIL_PANE_PERCENT}
                aria-valuenow={detailPanePercent}
                aria-valuetext={`${detailPanePercent}% height for torrent details`}
                data-resizing={resizingDetail}
                tabIndex={0}
                title={localizedMessage("inspection.components.app.drag.to.resize.use.up.and.down")}
                onPointerDown={startDetailResize}
                onPointerMove={continueDetailResize}
                onPointerUp={stopDetailResize}
                onPointerCancel={stopDetailResize}
                onLostPointerCapture={(event) => {
                  if (activeSplitterPointer.current === event.pointerId) {
                    activeSplitterPointer.current = null;
                    setResizingDetail(false);
                  }
                }}
                onKeyDown={resizeDetailWithKeyboard}
              >
                <span aria-hidden="true" />
              </div>
              <DetailPane remoteAccess={remoteAccess} />
            </>
          )}
        </main>
      </div>
      {updater !== undefined && updaterSnapshot?.state.phase === "available" ? (
        <aside className={styles.updateNotice} role="status">
          <div>
            <strong>{localizedMessage("inspection.components.app.rstorrent")}{" "}{updaterSnapshot.state.version}{" "}{localizedMessage("inspection.components.app.is.available")}</strong>
            <span>{localizedMessage("inspection.components.app.review.the.update.when.you.are.ready")}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSettingsCategory("about");
              setSettingsOpen(true);
            }}
          >{localizedMessage("inspection.components.app.review.update")}</button>
          <button
            type="button"
            aria-label={localizedMessage("inspection.components.app.dismiss.available.update")}
            onClick={() => updater.dismiss()}
          >{localizedMessage("inspection.components.app.later")}</button>
        </aside>
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          colorTheme={colorTheme}
          interfaceSize={interfaceSize}
          dataUnits={dataUnits}
          storage={storage}
          clientSettings={clientSettings}
          downloadsManageable={demo === null}
          showCrostiniStorageHelp={hostedProduct === "crostini"}
          oneCurrentRoot={oneCurrentRoot === true}
          clientSettingsManageable
          notifications={notifications}
          power={power}
          remoteAccess={remoteAccess}
          webAuth={webAuth}
          updater={updater}
          updaterSnapshot={updaterSnapshot}
          about={about ?? (demo === null ? undefined : { connection: "demo" })}
          productPrivacy={productPrivacy}
          initialCategory={settingsCategory}
          returnFocus={settingsButtonRef}
          onColorThemeChange={setColorTheme}
          onInterfaceSizeChange={setInterfaceSize}
          onDataUnitsChange={setDataUnits}
          onChooseFolder={async (repairRoot) => {
            const result = await execute({
              type: "choose_download_root",
              ...(repairRoot === undefined ? {} : { repairRoot }),
            });
            return result.storageRoot ?? null;
          }}
          onDefaultRootChange={async (rootId) => {
            await execute({ type: "set_default_download_root", rootId });
          }}
          onShowAddOptionsChange={async (show) => {
            await execute({ type: "set_show_add_options", show });
          }}
          onShowFileSelectionChange={async (show) => {
            await execute({ type: "set_show_file_selection", show });
          }}
          onRemoveRoot={async (rootId) => {
            await execute({ type: "remove_download_root", rootId });
          }}
          onClientSettingsSave={(patch) =>
            execute({ type: "update_client_settings", patch })
          }
          onExportTorrentList={
            remoteAccess?.scope === "remote"
              ? undefined
              : controller.application.exportTorrentList
          }
          onImportTorrentBundle={
            remoteAccess?.scope === "remote"
              ? undefined
              : controller.application.importTorrentBundle
          }
          deleteDataSupported={Object.values(controller.store.getState().torrents).every(
            (torrent) => torrent.deleteDataSupported,
          )}
          onRestoreDefaults={async () => {
            if (remoteAccess?.scope === "remote") {
              throw new Error("Preferences can be restored only on this device.");
            }
            if (updater?.selectChannel !== undefined) {
              await updater.selectChannel("stable");
              if (updater.getSnapshot().channel !== "stable") {
                throw new Error("The default update channel could not be restored.");
              }
            }
            await execute({ type: "reset_client_settings" });
            await execute({ type: "set_show_add_options", show: true });
            await execute({ type: "set_show_file_selection", show: true });
            await power?.resetAllShellSettings?.();
            if (notifications !== undefined) {
              await notifications.save({
                notify_download_complete: true,
                notify_needs_attention: true,
                notify_while_focused: true,
              });
            }
            if (power !== undefined) {
              await power.save({ prevent_sleep_during_active_downloads: true });
            }
            setColorTheme(DEFAULT_COLOR_THEME);
            setInterfaceSize(DEFAULT_INTERFACE_SIZE);
            setDataUnits(DEFAULT_DATA_UNITS);
          }}
          onClearAppData={async (deleteData) => {
            if (remoteAccess?.scope === "remote") {
              throw new Error("Clear app data is available only on this device.");
            }
            if (productPrivacy !== undefined && productPrivacy.clearAppData === undefined) {
              throw new Error("This client cannot clear product privacy choices.");
            }
            if (updater?.selectChannel !== undefined) {
              await updater.selectChannel("stable");
              if (updater.getSnapshot().channel !== "stable") {
                throw new Error("The default update channel could not be restored.");
              }
            }
            if (webAuth !== undefined) {
              if (!["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname)) {
                throw new Error("Clear app data is available only from this computer.");
              }
              const access = await webAuth.status();
              if (access.policy_fixed !== false) {
                throw new Error("This server fixes its web access policy; clear it from the server owner.");
              }
            }
            if (remoteAccess !== undefined) {
              const current = await remoteAccess.state();
              if (current.security?.enabled) await remoteAccess.disable();
              await remoteAccess.clearHistory();
            }
            const targets = Object.values(controller.store.getState().torrents);
            for (const target of targets) {
              await execute({ type: "remove", torrentId: target.id, deleteData });
              await waitForTorrentRemoval(controller, target.id);
            }
            await execute({ type: "clear_app_data" });
            await power?.resetAllShellSettings?.();
            if (productPrivacy !== undefined) {
              await productPrivacy.clearAppData!();
            }
            if (webAuth !== undefined) {
              await webAuth.clearAccess();
            }
            if (notifications !== undefined) {
              await notifications.save({
                notify_download_complete: true,
                notify_needs_attention: true,
                notify_while_focused: true,
              });
            }
            if (power !== undefined) {
              await power.save({ prevent_sleep_during_active_downloads: true });
            }
            for (const key of Object.keys(window.localStorage)) {
              if (key.startsWith("rstorrent.")) window.localStorage.removeItem(key);
            }
            setColorTheme(DEFAULT_COLOR_THEME);
            setInterfaceSize(DEFAULT_INTERFACE_SIZE);
            setDataUnits(DEFAULT_DATA_UNITS);
            if (power?.restartApplication !== undefined) {
              await power.restartApplication();
            } else {
              window.location.reload();
            }
          }}
          onWebAuthSignedOut={() => window.location.reload()}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {productPrivacy === undefined ? null : (
        <ProductDisclosure productPrivacy={productPrivacy} />
      )}
    </div>
  );
}

function presentsManualUpdateResult(state: UpdaterState): boolean {
  switch (state.phase) {
    case "checking":
    case "up-to-date":
    case "available":
      return state.reason === "manual";
    case "manual-install":
      return true;
    case "error":
      return state.operation === "check";
    case "idle":
    case "waiting-for-stable":
    case "downloading":
    case "installing":
      return false;
  }
}
