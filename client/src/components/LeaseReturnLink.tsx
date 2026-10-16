import { Link, useSearchParams } from "react-router-dom";
import { leasePath,leaseContext } from "../lease-links";
export function LeaseReturnLink(){const [params]=useSearchParams(),id=params.get("leaseReturn");return id?<Link className="button secondary" to={leasePath(id,leaseContext(params))}>← Back to lease workspace</Link>:null;}
