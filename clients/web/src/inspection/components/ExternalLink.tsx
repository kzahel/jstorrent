import { useContext, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { message } from "../../localization/runtime";
import { ExternalUrlContext } from "../external-links";

export function ExternalLink({ href, children }: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  const openUrl = useContext(ExternalUrlContext);
  const pending = useRef(false);
  const [failed, setFailed] = useState(false);

  async function activate(event: MouseEvent<HTMLAnchorElement>) {
    if (openUrl === undefined || event.defaultPrevented || event.button > 1) return;
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setFailed(false);
    try {
      await openUrl(href);
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
    }
  }

  return <>
    <a href={href} target="_blank" rel="noopener noreferrer"
      onClick={(event) => void activate(event)}
      onAuxClick={(event) => { if (event.button === 1) void activate(event); }}>
      {children}
    </a>
    {failed ? <span role="alert">{message("external-link.open-failed")}</span> : null}
  </>;
}
