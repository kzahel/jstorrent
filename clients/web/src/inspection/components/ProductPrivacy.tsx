import { useState, useSyncExternalStore } from "react";

import { message as localizedMessage } from "../../localization/runtime";
import type {
  ProductFeedbackPreview,
  ProductPrivacyController,
} from "../product-privacy/types";
import { CURRENT_PRODUCT_DISCLOSURE_VERSION } from "../product-privacy/types";
import styles from "./ProductPrivacy.module.css";

export function ProductDisclosure({
  productPrivacy,
}: {
  readonly productPrivacy: ProductPrivacyController;
}) {
  const snapshot = useSyncExternalStore(
    productPrivacy.subscribe,
    productPrivacy.getSnapshot,
  );
  const [enabled, setEnabled] = useState(true);
  if (
    snapshot.summary.disclosureVersion >= CURRENT_PRODUCT_DISCLOSURE_VERSION
  ) {
    return null;
  }
  return (
    <div className={styles.backdrop}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-disclosure-title"
      >
        <h2 id="product-disclosure-title">
          {localizedMessage("product.privacy.disclosure.title")}
        </h2>
        <p>{localizedMessage("product.privacy.disclosure.summary")}</p>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={snapshot.busy}
            onChange={(event) => setEnabled(event.currentTarget.checked)}
          />
          <span>{localizedMessage("product.privacy.disclosure.include")}</span>
        </label>
        {snapshot.error === undefined ? null : (
          <p role="alert" className={styles.error}>{snapshot.error}</p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={() => void productPrivacy.openPrivacy()}>
            {localizedMessage("product.privacy.view.policy")}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={snapshot.busy}
            onClick={() => void productPrivacy.acknowledgeDisclosure(enabled)}
          >
            {localizedMessage("product.privacy.continue")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ProductPrivacySettingsSection({
  productPrivacy,
}: {
  readonly productPrivacy: ProductPrivacyController;
}) {
  const snapshot = useSyncExternalStore(
    productPrivacy.subscribe,
    productPrivacy.getSnapshot,
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [preview, setPreview] = useState<ProductFeedbackPreview>();
  const [includeStatistics, setIncludeStatistics] = useState(
    snapshot.summary.statisticsEnabled,
  );
  const [feedbackError, setFeedbackError] = useState<string>();
  const [openingFeedback, setOpeningFeedback] = useState(false);

  const loadPreview = async (include: boolean) => {
    try {
      setFeedbackError(undefined);
      setPreview(await productPrivacy.feedbackPreview(include));
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={styles.settings}>
      <fieldset>
        <legend>{localizedMessage("product.privacy.statistics.title")}</legend>
        <p>{localizedMessage("product.privacy.statistics.description")}</p>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={snapshot.summary.statisticsEnabled}
            disabled={snapshot.busy}
            onChange={(event) =>
              void productPrivacy.setStatisticsEnabled(event.currentTarget.checked)
            }
          />
          <span>{localizedMessage("product.privacy.include.statistics")}</span>
        </label>
        <dl className={styles.summary}>
          <div><dt>{localizedMessage("product.privacy.days")}</dt><dd>{snapshot.summary.daysSinceFirstUse}</dd></div>
          <div><dt>{localizedMessage("product.privacy.added")}</dt><dd>{snapshot.summary.torrentsAdded}</dd></div>
          <div><dt>{localizedMessage("product.privacy.completed")}</dt><dd>{snapshot.summary.downloadsCompleted}</dd></div>
          <div><dt>{localizedMessage("product.privacy.sessions")}</dt><dd>{snapshot.summary.foregroundSessions}</dd></div>
        </dl>
        <div className={styles.actions}>
          <button type="button" onClick={() => void productPrivacy.openPrivacy()}>
            {localizedMessage("product.privacy.view.policy")}
          </button>
          <button type="button" onClick={() => setConfirmReset(true)}>
            {localizedMessage("product.privacy.reset.action")}
          </button>
        </div>
        {confirmReset ? (
          <div className={styles.confirm} role="alertdialog" aria-labelledby="reset-statistics-title">
            <strong id="reset-statistics-title">{localizedMessage("product.privacy.reset.title")}</strong>
            <p>{localizedMessage("product.privacy.reset.description")}</p>
            <div className={styles.actions}>
              <button type="button" onClick={() => setConfirmReset(false)}>{localizedMessage("product.privacy.cancel")}</button>
              <button type="button" className={styles.danger} disabled={snapshot.busy} onClick={() => { setConfirmReset(false); void productPrivacy.resetStatistics(); }}>{localizedMessage("product.privacy.reset.confirm")}</button>
            </div>
          </div>
        ) : null}
        {snapshot.error === undefined ? null : <p role="alert" className={styles.error}>{snapshot.error}</p>}
      </fieldset>
      <fieldset>
        <legend>{localizedMessage("product.feedback.title")}</legend>
        <p>{localizedMessage("product.feedback.description")}</p>
        <button type="button" onClick={() => { const include = snapshot.summary.statisticsEnabled; setIncludeStatistics(include); void loadPreview(include); }}>
          {localizedMessage("product.feedback.review.action")}
        </button>
      </fieldset>
      {preview === undefined ? null : (
        <div className={styles.backdrop}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="feedback-preview-title">
            <h2 id="feedback-preview-title">{localizedMessage("product.feedback.preview.title")}</h2>
            <p>{localizedMessage("product.feedback.preview.destination")}: <strong>{preview.destination}</strong></p>
            <p className={styles.detail}>{localizedMessage("product.privacy.recipients.warning")}</p>
            <dl className={styles.previewFields}>
              {preview.fields.map((field) => <div key={field.name}><dt>{field.name}</dt><dd>{field.value}</dd></div>)}
            </dl>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={includeStatistics && preview.statisticsAvailable} disabled={!preview.statisticsAvailable} onChange={(event) => { const include = event.currentTarget.checked; setIncludeStatistics(include); void loadPreview(include); }} />
              <span>{localizedMessage("product.feedback.include.for.report")}</span>
            </label>
            {preview.hostedContextReady ? null : <p className={styles.detail}>{localizedMessage("product.feedback.hosted.context.pending")}</p>}
            {feedbackError === undefined ? null : <p role="alert" className={styles.error}>{feedbackError}</p>}
            <div className={styles.actions}>
              <button type="button" onClick={() => setPreview(undefined)}>{localizedMessage("product.privacy.cancel")}</button>
              <button type="button" onClick={() => void productPrivacy.openPrivacy()}>{localizedMessage("product.privacy.view.policy")}</button>
              <button type="button" className={styles.primary} disabled={openingFeedback} onClick={async () => { setOpeningFeedback(true); try { await productPrivacy.openFeedback(includeStatistics, preview.url); setPreview(undefined); } catch (error) { const message = error instanceof Error ? error.message : String(error); await loadPreview(includeStatistics); setFeedbackError(message); } finally { setOpeningFeedback(false); } }}>{localizedMessage("product.feedback.open.action")}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
