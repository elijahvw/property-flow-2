import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useResource } from "../useResource";
import { NavigationIcon } from "./NavigationIcon";
import { inboxReturn } from "../notification-context";
import "../pages/Notifications.css";
export function NotificationBell() {
  const { data, error, reload } = useResource<{ unread: number }>(
    "/api/account/notifications/summary",
    true,
    true,
  );
  useEffect(() => {
    window.addEventListener("notifications-changed", reload);
    return () => window.removeEventListener("notifications-changed", reload);
  }, [reload]);
  return (
    <Link
      className="notification-bell"
      to="/account/notifications"
      aria-label={
        error
          ? "Notifications (count unavailable)"
          : data
            ? `Notifications, ${data.unread} unread`
            : "Notifications"
      }
    >
      <NavigationIcon path="/account/notifications" />
      <span className="notification-bell-label">Notifications</span>
      {!error && data && data.unread > 0 && (
        <span className="badge" aria-hidden="true">
          {data.unread > 99 ? "99+" : data.unread}
        </span>
      )}
    </Link>
  );
}
export function NotificationReturnLink() {
  const location = useLocation(),
    href = inboxReturn(new URLSearchParams(location.search));
  return href && location.pathname !== "/account/notifications" ? (
    <p className="notification-return">
      <Link to={href}>← Back to notifications</Link>
    </p>
  ) : null;
}
