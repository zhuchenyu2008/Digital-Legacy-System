const paths: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z",
  contacts: "M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 13a5 5 0 0 0-5 5v3h10v-3a5 5 0 0 0-5-5m8 0c-.7 0-1.4.1-2 .4A7 7 0 0 1 15 18v3h6v-3a5 5 0 0 0-5-5",
  file: "M6 2h8l4 4v16H6zm7 1v5h5M9 13h6M9 17h6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8.9 4a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a9 9 0 0 0-1.7-1L16.4 3h-4l-.4 2.7a8 8 0 0 0-1.8 1L7.8 5.6 5.8 9l2.1 1.5a8 8 0 0 0 0 2.9L5.8 15l2 3.4 2.4-1.1a8 8 0 0 0 1.8 1l.4 2.7h4l.4-2.7a8 8 0 0 0 1.7-1l2.4 1.1 2-3.4-2.1-1.6q.1-.7.1-1.4",
  user: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m-9 9a9 9 0 0 1 18 0",
  shield: "M12 2 20 5v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z",
  alert: "M12 3 2 21h20zm0 6v5m0 3v1",
  audit: "M4 4v16h16V8l-4-4zm4 6h8m-8 4h8m-8 4h5",
  download: "M12 3v12m-5-5 5 5 5-5M4 21h16",
};

export function Icon({ label, name, size = 24 }: Readonly<{ label?: string; name: string; size?: number }>) {
  const path = paths[name] ?? paths.shield ?? "";
  return (
    <span aria-label={label} className="dls-icon" role={label ? "img" : undefined}>
      <span aria-hidden="true" className="material-symbols-outlined">{name}</span>
      <svg aria-hidden="true" className="dls-icon__fallback" fill="none" height={size} viewBox="0 0 24 24" width={size}>
        <path d={path} fill={name === "alert" ? "none" : "currentColor"} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    </span>
  );
}
