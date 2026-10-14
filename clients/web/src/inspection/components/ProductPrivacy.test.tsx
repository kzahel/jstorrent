// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ProductFeedbackPreview,
  ProductPrivacyController,
  ProductPrivacySnapshot,
} from "../product-privacy/types";
import {
  ProductDisclosure,
  ProductPrivacySettingsSection,
} from "./ProductPrivacy";

describe("product privacy presentation", () => {
  it("allows the default-on preference to change before disclosure acknowledgement", async () => {
    const user = userEvent.setup();
    const controller = fakeProductPrivacy({ disclosureVersion: 0 });
    render(<ProductDisclosure productPrivacy={controller} />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Include usage statistics",
    });
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("dialog", { name: "Usage statistics" })).toBeVisible();
    expect(screen.getByText(/random, resettable app identifier/)).toBeVisible();
    expect(screen.queryByText(/browser history.*Google Form.*Cloudflare/i)).toBeNull();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(controller.acknowledgeDisclosure).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("previews every exact field and opens only the reviewed URL", async () => {
    const user = userEvent.setup();
    const controller = fakeProductPrivacy({ disclosureVersion: 1 });
    render(<ProductPrivacySettingsSection productPrivacy={controller} />);

    await user.click(
      screen.getByRole("button", { name: "Review and send feedback" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review what will be sent",
    });
    expect(within(dialog).getByText("platform")).toBeVisible();
    expect(within(dialog).getByText("desktop")).toBeVisible();
    expect(within(dialog).getByText("v")).toBeVisible();
    expect(within(dialog).getByText("0.1.3")).toBeVisible();
    expect(
      within(dialog).getByText(/browser history.*Google Form.*Cloudflare/i),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Include pseudonymous usage statistics for this report",
      }),
    ).toBeDisabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Open feedback page" }),
    );
    await waitFor(() => expect(controller.openFeedback).toHaveBeenCalledOnce());
    expect(controller.openFeedback).toHaveBeenCalledWith(
      true,
      "https://jstorrent.com/feedback.html?platform=desktop&v=0.1.3",
    );
  });
});

function fakeProductPrivacy(
  summaryPatch: Partial<ProductPrivacySnapshot["summary"]>,
): ProductPrivacyController & {
  acknowledgeDisclosure: ReturnType<typeof vi.fn>;
  openFeedback: ReturnType<typeof vi.fn>;
} {
  let snapshot: ProductPrivacySnapshot = {
    busy: false,
    summary: {
      installationId: "87e66203-9849-44c5-a557-8e77c29e7587",
      createdAtMillis: "1800000000000",
      firstVersion: "0.1.3",
      currentVersion: "0.1.3",
      disclosureVersion: 1,
      statisticsEnabled: true,
      torrentsAdded: "4",
      downloadsCompleted: "3",
      foregroundSessions: "2",
      resetGeneration: "4b24402a-44df-442f-9ea2-3d3ec170edce",
      lastStartMillis: "1800000000000",
      lastCleanShutdownMillis: null,
      daysSinceFirstUse: 8,
      transmissionAllowed: true,
      ...summaryPatch,
    },
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const preview: ProductFeedbackPreview = {
    destination: "https://jstorrent.com/feedback.html",
    url: "https://jstorrent.com/feedback.html?platform=desktop&v=0.1.3",
    fields: [
      { name: "platform", value: "desktop", pseudonymous: false },
      { name: "v", value: "0.1.3", pseudonymous: false },
    ],
    statisticsAvailable: false,
    statisticsIncluded: false,
    hostedContextReady: false,
  };
  const acknowledgeDisclosure = vi.fn(async (enabled: boolean) => {
    snapshot = {
      busy: false,
      summary: {
        ...snapshot.summary,
        disclosureVersion: 1,
        statisticsEnabled: enabled,
      },
    };
    notify();
  });
  const openFeedback = vi.fn(async () => undefined);
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    acknowledgeDisclosure,
    setStatisticsEnabled: vi.fn(async () => undefined),
    resetStatistics: vi.fn(async () => undefined),
    feedbackPreview: vi.fn(async () => preview),
    openFeedback,
    openPrivacy: vi.fn(async () => undefined),
  };
}
