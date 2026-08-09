const paths: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z",
  contacts:
    "M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 13a5 5 0 0 0-5 5v3h10v-3a5 5 0 0 0-5-5m8 0c-.7 0-1.4.1-2 .4A7 7 0 0 1 15 18v3h6v-3a5 5 0 0 0-5-5",
  cloud_upload: "M12 16V8m-4 4 4-4 4 4M5 18a4 4 0 0 1-.2-8A6 6 0 0 1 16 7a5 5 0 0 1 1 9.9",
  file: "M6 2h8l4 4v16H6zm7 1v5h5M9 13h6M9 17h6",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8.9 4a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a9 9 0 0 0-1.7-1L16.4 3h-4l-.4 2.7a8 8 0 0 0-1.8 1L7.8 5.6 5.8 9l2.1 1.5a8 8 0 0 0 0 2.9L5.8 15l2 3.4 2.4-1.1a8 8 0 0 0 1.8 1l.4 2.7h4l.4-2.7a8 8 0 0 0 1.7-1l2.4 1.1 2-3.4-2.1-1.6q.1-.7.1-1.4",
  user: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m-9 9a9 9 0 0 1 18 0",
  shield: "M12 2 20 5v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z",
  alert: "M12 3 2 21h20zm0 6v5m0 3v1",
  audit: "M4 4v16h16V8l-4-4zm4 6h8m-8 4h8m-8 4h5",
  download: "M12 3v12m-5-5 5 5 5-5M4 21h16",
  mail: "M3 5h18v14H3zm0 1 9 7 9-7",
  delete: "M5 7h14M9 7V4h6v3m-8 0 1 14h8l1-14M10 11v6m4-6v6",
  send: "M3 11.5 21 3l-7.5 18-2-7.5zM11.5 13.5 21 3",
  notification: "M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3zm4 11h4",
  alternate_email: "M12 4a8 8 0 1 0 5.7 13.6M16 8v5a3 3 0 0 1-6 0v-1a3 3 0 0 1 6 0",
  timer: "M9 2h6M12 6a8 8 0 1 0 8 8 8 8 0 0 0-8-8m0 4v4l3 2",
  visibility: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12m10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  public:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 0c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21m0-18C9.7 5.5 8.5 8.5 8.5 12s1.2 6.5 3.5 9M3.5 9h17m-17 6h17",
  person_add:
    "M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 21v-2a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v2M5 8v6M2 11h6",
  dns: "M4 5h16v6H4zm0 8h16v6H4M7 8h.01M7 16h.01m3-8h7m-7 8h7",
  server: "M5 4h14v16H5zm0 6h14M8 7h.01M8 14h.01m3-7h5m-5 7h5",
  lock: "M7 10V7a5 5 0 0 1 10 0v3m-11 0h12v11H6zm6 4v3",
  key: "M14 8a5 5 0 1 0-4 8l2-2h3l2-2h3l2-2-3-3z",
  chevron_right: "m9 5 7 7-7 7",
  check_circle: "M21 11a9 9 0 1 1-4-7m4 1-9 9-3-3",
  security: "M12 2 20 5v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5zm-3 10 2 2 4-5",
  fingerprint:
    "M12 11a2 2 0 0 1 2 2c0 4-1.2 6.6-2.2 8M8.3 20c1.1-2.1 1.7-4.2 1.7-7a2 2 0 0 1 4 0c0 2.1-.3 4.2-1 6.1M5.5 18c.7-1.7 1-3.4 1-5a5.5 5.5 0 0 1 11 0c0 2.8-.4 5.4-1.5 7.8M3 15c-.1-.6-.2-1.3-.2-2a9.2 9.2 0 0 1 18.4 0c0 1.5-.1 2.8-.4 4.2M4.4 8.4A8.7 8.7 0 0 1 12 4a8.7 8.7 0 0 1 7.6 4.4",
  folder: "M3 6h7l2 2h9v11H3z",
  privacy: "M12 2 20 5v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5zm0 6v5m0 3h.01",
  gavel: "m14 5 5 5m-8-8 6 6m-9 1 7 7m-10-4 6 6m-8 3 6 6m7-7 8 8M3 21h8",
  history: "M4 12a8 8 0 1 0 3-6M4 4v5h5m3-2v5l3 2",
  info: "M12 8h.01M11 12h1v5h1",
  description: "M6 2h8l4 4v16H6zm7 1v5h5M9 12h6M9 16h6",
  content_copy: "M8 8h11v13H8zM5 3h11v3M5 3v13h1",
  folder_zip: "M3 6h7l2 2h9v11H3zm10 4h2m-2 3h2m-2 3h2",
  policy: "M12 2 20 5v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5zm0 5v5m0 4h.01",
  verified:
    "M12 2l2 2.2 3-.3.8 2.9 2.7 1.3-1.3 2.7 1.3 2.7-2.7 1.3-.8 2.9-3-.3L12 22l-2-2.2-3 .3-.8-2.9-2.7-1.3 1.3-2.7L3.5 10.5l2.7-1.3L7 6.3l3 .3zm-3 10 2 2 4-5",
  done_all: "m2 12 4 4L14 8m-5 4 4 4 9-9",
  lock_clock:
    "M7 10V7a5 5 0 0 1 10 0v3m-11 0h8m-8 0v11h6m5-7a5 5 0 1 0 0 10 5 5 0 0 0 0-10m0 2.5V19l1.8 1",
};

const materialNames: Record<string, string> = {
  alert: "warning",
  audit: "history",
  file: "description",
  notification: "notifications",
  privacy: "privacy_tip",
  server: "dns",
  user: "account_circle",
};

export function Icon({
  filled = false,
  label,
  name,
  size = 24,
}: Readonly<{ filled?: boolean; label?: string; name: string; size?: number }>) {
  const path = paths[name] ?? paths.shield ?? "";
  const materialName = materialNames[name] ?? name;
  const accessibility = label
    ? ({ "aria-label": label, role: "img" } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <span
      {...accessibility}
      className={`dls-icon${filled ? " dls-icon--filled" : ""}`}
      style={{ "--dls-icon-size": `${size}px` } as CSSProperties}
    >
      <span aria-hidden="true" className="material-symbols-outlined">
        {materialName}
      </span>
      <svg
        aria-hidden="true"
        className="dls-icon__fallback"
        fill="none"
        height="100%"
        viewBox="0 0 24 24"
        width="100%"
      >
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </span>
  );
}

import type { CSSProperties } from "react";
