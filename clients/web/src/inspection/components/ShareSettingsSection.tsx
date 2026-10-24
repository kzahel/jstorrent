import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import {
  loadPeerHintPreference,
  savePeerHintPreference,
  type PeerHintPreference,
} from "../share-preferences";
import { SegmentedSetting, type SegmentedOption } from "./SegmentedSetting";
import styles from "./SettingsDialog.module.css";

const PEER_HINT_OPTIONS: readonly SegmentedOption<PeerHintPreference>[] = [
  {
    value: "ask",
    label: localizedMessage("inspection.components.share.settings.section.ask"),
    description: localizedMessage("inspection.components.share.settings.section.ask.description"),
  },
  {
    value: "include",
    label: localizedMessage("inspection.components.share.settings.section.include"),
    description: localizedMessage("inspection.components.share.settings.section.include.description"),
  },
  {
    value: "omit",
    label: localizedMessage("inspection.components.share.settings.section.omit"),
    description: localizedMessage("inspection.components.share.settings.section.omit.description"),
  },
];

/**
 * Whether share links carry this device's address (Tactical 357). A
 * browser-local choice that applies at once, outside the engine settings
 * form and its Save button.
 */
export function ShareSettingsSection() {
  const [preference, setPreference] = useState(loadPeerHintPreference);
  return (
    <fieldset className={styles.section}>
      <legend>{localizedMessage("inspection.components.share.settings.section.sharing")}</legend>
      <div className={styles.rows}>
        <SegmentedSetting
          name="share-peer-hint"
          title={localizedMessage("inspection.components.share.settings.section.address.title")}
          options={PEER_HINT_OPTIONS}
          value={preference}
          onChange={(value) => {
            savePeerHintPreference(value);
            setPreference(value);
          }}
        />
      </div>
    </fieldset>
  );
}
