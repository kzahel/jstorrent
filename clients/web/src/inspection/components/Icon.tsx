import type { SVGProps } from "react";

export type IconName =
  | "archive"
  | "arrowBack"
  | "chevronDown"
  | "close"
  | "copy"
  | "library"
  | "link"
  | "magnet"
  | "menu"
  | "moreVertical"
  | "pause"
  | "play"
  | "plus"
  | "remove"
  | "recheck"
  | "restore"
  | "settings"
  | "transfers"
  | "workbench";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  readonly name: IconName;
}

export function Icon({ name, ...properties }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
      {...properties}
    >
      <IconPaths name={name} />
    </svg>
  );
}

function IconPaths({ name }: { readonly name: IconName }) {
  switch (name) {
    case "archive":
      return (
        <>
          <path d="M3.25 6.5h13.5v9.75H3.25z" />
          <path d="M2.5 3.75h15v2.75h-15zM7.5 10h5" />
        </>
      );
    case "arrowBack":
      return <path d="M16 10H4.5M9.25 4.75 4 10l5.25 5.25" />;
    case "chevronDown":
      return <path d="m5.5 7.75 4.5 4.5 4.5-4.5" />;
    case "close":
      return <path d="m5 5 10 10M15 5 5 15" />;
    case "copy":
      return (
        <>
          <rect x="6.25" y="6.25" width="9.5" height="9.5" rx="1.25" />
          <path d="M13.75 6.25v-1.5a.5.5 0 0 0-.5-.5h-8.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 .5.5h1.5" />
        </>
      );
    case "library":
      return (
        <>
          <path d="M3.5 4.25h4v11.5h-4zM8.5 4.25h3.25v11.5H8.5z" />
          <path d="m13 5 3.5-.75 1.75 10.75-3.5.75z" />
        </>
      );
    case "link":
      return (
        <>
          <path d="m8.25 11.75 3.5-3.5" />
          <path d="m9.25 6.25 1.5-1.5a3 3 0 0 1 4.25 4.25l-1.5 1.5" />
          <path d="m10.75 13.75-1.5 1.5a3 3 0 0 1-4.25-4.25l1.5-1.5" />
        </>
      );
    case "magnet":
      return (
        <>
          <path d="M4 3.5h3.5V10a2.5 2.5 0 0 0 5 0V3.5H16V10a6 6 0 0 1-12 0z" />
          <path d="M4 6.75h3.5M12.5 6.75H16" />
        </>
      );
    case "menu":
      return <path d="M3.5 5.25h13M3.5 10h13M3.5 14.75h13" />;
    case "moreVertical":
      return (
        <>
          <circle cx="10" cy="4.75" r="0.6" />
          <circle cx="10" cy="10" r="0.6" />
          <circle cx="10" cy="15.25" r="0.6" />
        </>
      );
    case "pause":
      return <path d="M7 5v10M13 5v10" />;
    case "play":
      return <path d="m7 4.75 7 5.25-7 5.25z" />;
    case "plus":
      return <path d="M10 4v12M4 10h12" />;
    case "remove":
      return (
        <>
          <path d="M4.75 6.25h10.5M8 3.75h4M6 6.25l.75 10h6.5l.75-10" />
          <path d="M8.25 9v4.5M11.75 9v4.5" />
        </>
      );
    case "recheck":
      return (
        <>
          <path d="M4.25 9.25a5.75 5.75 0 0 1 10.45-2.7" />
          <path d="M14.75 3.75v3.5h-3.5M15.75 10.75A5.75 5.75 0 0 1 5.3 13.45" />
          <path d="M5.25 16.25v-3.5h3.5" />
        </>
      );
    case "restore":
      return (
        <>
          <path d="M4.1 9a6 6 0 1 1 1.7 4.9" />
          <path d="M4 4.75V9h4.25" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="10" cy="10" r="2.25" />
          <path d="M8.7 2.61A7.5 7.5 0 0 1 11.3 2.61L11.42 4.69A5.5 5.5 0 0 1 13.89 6.11L15.75 5.18A7.5 7.5 0 0 1 17.05 7.43L15.31 8.58A5.5 5.5 0 0 1 15.31 11.42L17.05 12.57A7.5 7.5 0 0 1 15.75 14.82L13.89 13.89A5.5 5.5 0 0 1 11.42 15.31L11.3 17.39A7.5 7.5 0 0 1 8.7 17.39L8.58 15.31A5.5 5.5 0 0 1 6.11 13.89L4.25 14.82A7.5 7.5 0 0 1 2.95 12.57L4.69 11.42A5.5 5.5 0 0 1 4.69 8.58L2.95 7.43A7.5 7.5 0 0 1 4.25 5.18L6.11 6.11A5.5 5.5 0 0 1 8.58 4.69Z" />
        </>
      );
    case "transfers":
      return (
        <>
          <path d="M6.25 3.5v12.25M3.5 13l2.75 2.75L9 13" />
          <path d="M13.75 16.5V4.25M11 7l2.75-2.75L16.5 7" />
        </>
      );
    case "workbench":
      return (
        <>
          <path d="M3.25 3.5h13.5v13H3.25zM3.25 8h13.5M9 8v8.5" />
        </>
      );
  }
}
