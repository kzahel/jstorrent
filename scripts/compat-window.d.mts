// Types for compat-window.mjs, imported by the web compatibility tests.
export function compareVersions(left: string, right: string): number;
export function retirementDate(
  ledger: { readonly windowDays: number; readonly deliveries: readonly unknown[] },
  delivery: { readonly surface: string; readonly version: string },
): string | null;
export function supportedDeliveries<
  Delivery extends { readonly surface: string; readonly version: string; readonly status: string },
>(ledger: { readonly windowDays: number; readonly deliveries: readonly Delivery[] }, today: string): Delivery[];
export function compatToday(environment?: Readonly<Record<string, string | undefined>>): string;
