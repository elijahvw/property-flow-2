export function notificationContext(
  params: URLSearchParams,
): Record<string, string> {
  if (params.get("noticeReturn") !== "inbox") return {};
  return {
    noticeReturn: "inbox",
    noticeStatus: ["unread", "read"].includes(params.get("noticeStatus") ?? "")
      ? params.get("noticeStatus")!
      : "all",
    noticeType: ["maintenance", "work", "inspections", "agreements"].includes(
      params.get("noticeType") ?? "",
    )
      ? params.get("noticeType")!
      : "all",
    noticePage: /^[1-9][0-9]{0,4}$/.test(params.get("noticePage") ?? "")
      ? params.get("noticePage")!
      : "1",
  };
}
export function inboxReturn(params: URLSearchParams) {
  const c = notificationContext(params);
  return c.noticeReturn
    ? `/account/notifications?${new URLSearchParams({ status: c.noticeStatus, type: c.noticeType, page: c.noticePage })}`
    : null;
}
