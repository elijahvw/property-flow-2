export function NavigationIcon({ path }: { path: string }) {
  const people = (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" />
    </>
  );
  const content = path.startsWith("/help") ? <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/></> : path.includes("overview") ? (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ) : path.includes("properties") || path.includes("availability") || path === "/resident" ? (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
    </>
  ) : /users|residents|members|impersonation|applications/.test(path) ? (
    people
  ) : /finances|rent|deposits|subscription|plans/.test(path) ? (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ) : path.includes("work-calendar") ? (
    <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m3 0h2m3 0h1M7 18h2m3 0h2"/></>
  ) : path.includes("settings") ? (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ) : path.includes("audit") ? (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ) : /maintenance|work-orders|preventive|vendors/.test(path) ? (
    <>
      <path d="m14 5 5 5M3 21l9-9m-2-7 3-3 8 8-3 3-4-1-3-3z" />
    </>
  ) : path.includes("notifications") ? (<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>) : path.includes("account") ? (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22v-2a8 8 0 0 1 16 0v2" />
    </>
  ) : path.includes("companies") ? (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6" />
    </>
  ) : (
    <>
      <path d="M5 3h10l4 4v14H5zM14 3v5h5M9 12h6m-6 4h6" />
    </>
  );
  return (
    <svg
      className="nav-icon"
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {content}
    </svg>
  );
}
