import { message as localizedMessage } from "../../localization/runtime";
import { useState } from "react";

import {
  useInspectionController,
  useInspectionDispatch,
  useInspectionStore,
} from "../context";
import { formatClock } from "../format";
import type { DemoScenarioId } from "../model";
import styles from "./ScenarioBar.module.css";

export function ScenarioBar() {
  const demo = useInspectionStore((state) => state.demo);
  const dispatch = useInspectionDispatch();
  const controller = useInspectionController();
  const [message, setMessage] = useState("");
  if (demo === null) return null;

  const send = async (command: Parameters<typeof dispatch>[0]) => {
    try {
      setMessage((await dispatch(command)) ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className={styles.bar} aria-label={localizedMessage("inspection.components.scenario.bar.demo.scenario.controls")}>
      <span className={styles.badge}>{localizedMessage("inspection.components.scenario.bar.demo.data")}</span>
      <label>
        <span>{localizedMessage("inspection.components.scenario.bar.scenario")}</span>
        <select
          aria-label={localizedMessage("inspection.components.scenario.bar.demo.scenario")}
          value={demo.scenarioId}
          onChange={(event) =>
            void send({
              type: "set_demo_scenario",
              scenarioId: event.currentTarget.value as DemoScenarioId,
            })
          }
        >
          {controller.application.scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.title}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.clock} aria-label={`Demo clock ${formatClock(demo.elapsedMs)}`}>
        <span>{formatClock(demo.elapsedMs)}</span>
        <span aria-hidden="true">/</span>
        <span>{formatClock(demo.durationMs)}</span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() =>
            void send({ type: "set_demo_running", running: !demo.running })
          }
        >
          <span aria-hidden="true">{demo.running ? "Ⅱ" : "▶"}</span>
          {demo.running ? localizedMessage("inspection.components.scenario.bar.pause") : localizedMessage("inspection.components.scenario.bar.play")}
        </button>
        <button
          type="button"
          onClick={() =>
            void send({ type: "advance_demo_clock", milliseconds: 10_000 })
          }
        >{localizedMessage("inspection.components.scenario.bar.10s")}</button>
        <button type="button" onClick={() => void send({ type: "reset_demo" })}>{localizedMessage("inspection.components.scenario.bar.reset")}</button>
      </div>
      <output className={styles.message} aria-live="polite">
        {message}
      </output>
    </section>
  );
}
