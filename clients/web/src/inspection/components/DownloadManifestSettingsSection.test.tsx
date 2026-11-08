// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DownloadManifestSettingsSection } from "./DownloadManifestSettingsSection";

const host = vi.hoisted(() => ({ capabilities: ["download_manifests"] as string[] | null }));
vi.mock("../context", () => ({
  useInspectionStore: (selector: (state: object) => unknown) =>
    selector({ session: { hostCapabilities: host.capabilities } }),
}));
beforeEach(() => {
  host.capabilities = ["download_manifests"];
});
afterEach(cleanup);

const label = "Write PlaysVideo manifest files";

it("saves the PlaysVideo manifest setting as a one-key patch", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue({ accepted: true });
  render(<DownloadManifestSettingsSection enabled manageable onSave={onSave} />);
  const checkbox = screen.getByRole("checkbox", { name: new RegExp(label) });
  expect(checkbox).toBeChecked();
  expect(
    screen.getByText(
      "Saves a small hidden .jstorrent.json file beside each download so PlaysVideo can resume it on your other devices.",
    ),
  ).toBeInTheDocument();
  await user.click(checkbox);
  expect(onSave).toHaveBeenCalledWith({ write_download_manifests: false });
  await waitFor(() => expect(checkbox).toBeEnabled());
});

it("shows a save failure", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockRejectedValue(new Error("host refused"));
  render(<DownloadManifestSettingsSection enabled={false} manageable onSave={onSave} />);
  await user.click(screen.getByRole("checkbox", { name: new RegExp(label) }));
  expect(onSave).toHaveBeenCalledWith({ write_download_manifests: true });
  expect(await screen.findByRole("alert")).toHaveTextContent("host refused");
});

it("is hidden for hosts released before the capability", () => {
  host.capabilities = ["file_safety"];
  render(<DownloadManifestSettingsSection enabled manageable onSave={vi.fn()} />);
  expect(screen.queryByRole("checkbox", { name: new RegExp(label) })).toBeNull();
});
