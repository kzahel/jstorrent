import { createContext, type ReactNode } from "react";

export type OpenExternalUrl = (url: string) => Promise<void>;

// Browser clients leave anchors to the browser. Only desktop injects an opener.
export const ExternalUrlContext = createContext<OpenExternalUrl | undefined>(undefined);

export function ExternalUrlProvider({ openUrl, children }: {
  readonly openUrl?: OpenExternalUrl | undefined;
  readonly children: ReactNode;
}) {
  return <ExternalUrlContext.Provider value={openUrl}>{children}</ExternalUrlContext.Provider>;
}
