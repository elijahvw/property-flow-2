const keys=["tenantId","tenantQ","tenantAccess","leaseListProperty","leaseListStatus","leaseListAttention","leaseListNested","leaseListApprovals"];
export function leaseContext(params:URLSearchParams){return Object.fromEntries(keys.filter(key=>params.get(key)).map(key=>[key,params.get(key)!]));}
export function leasePath(id:string,context:Record<string,string>={}){const search=new URLSearchParams(context).toString();return `/company/leases/${encodeURIComponent(id)}`+(search?`?${search}`:"");}
export function leaseDirectoryPath(params:URLSearchParams){
  const property=params.get("leaseListProperty"),nested=params.get("leaseListNested")==="true"&&property;
  const query=new URLSearchParams();
  if(property&&!nested)query.set("propertyId",property);
  const attention=params.get("leaseListAttention"),status=params.get("leaseListStatus");
  if(params.get("leaseListApprovals")==="pending")query.set("approvals","pending");
  else if(attention&&["in_effect","ending_soon","past_end"].includes(attention))query.set("attention",attention);
  else if(status&&["draft","active","ended"].includes(status))query.set("status",status);
  return (nested?`/company/properties/${encodeURIComponent(property!)}/leases`:"/company/leases")+(query.size?`?${query}`:"");
}
