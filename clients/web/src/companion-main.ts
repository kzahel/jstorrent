import "./companion-shell.css";
import { startDesktopCompanion } from "./desktop-companion-main";
import { startAndroidCompanion } from "./android-companion-main";
import { localizeDocumentShell } from "./localization/runtime";

localizeDocumentShell();
if (new URL(window.location.href).searchParams.get("backend") === "desktop") {
  document.getElementById("companion-open-android")!.hidden = true;
  document.getElementById("companion-permission")!.hidden = true;
  document.getElementById("companion-help")!.hidden = true;
  document.getElementById("companion-linux")!.hidden = true;
  document.getElementById("companion-preview")!.hidden = true;
  void startDesktopCompanion();
} else {
  void startAndroidCompanion();
}
