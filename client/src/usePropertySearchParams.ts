import {
  createSearchParams,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  type SetURLSearchParams,
} from "react-router-dom";
// Property context belongs to the route. Expose it to existing filter builders,
// then remove the redundant query field when writing the current workspace URL.
export function usePropertySearchParams(): [
  URLSearchParams,
  SetURLSearchParams,
  string,
] {
  const { propertyId = "" } = useParams(),
    [search, setSearch] = useSearchParams(),
    navigate = useNavigate(),
    location = useLocation();
  const params = new URLSearchParams(search);
  if (propertyId) params.set("propertyId", propertyId);
  const change: SetURLSearchParams = (next, options) => {
    const q = createSearchParams(
      typeof next === "function" ? next(params) : next,
    );
    const requested = q.get("propertyId"),
      explicit = q.has("propertyId");
    if (propertyId) {
      const module = location.pathname.split("/")[4];
      q.delete("propertyId");
      for (const [k, v] of [...q]) if (!v) q.delete(k);
      if (explicit && requested !== propertyId) {
        const path = requested
          ? `/company/properties/${encodeURIComponent(requested)}/${module}`
          : `/company/${module}`;
        navigate(path + (q.size ? "?" + q : ""), options);
        return;
      }
    }
    setSearch(q, options);
  };
  return [params, change, propertyId];
}
