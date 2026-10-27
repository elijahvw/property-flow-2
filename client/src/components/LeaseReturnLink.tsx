import { Link, useSearchParams } from "react-router-dom";
import { leasePath,leaseContext } from "../lease-links";
import { documentLibraryContext } from "../document-context";
import { agreementContext } from "../agreement-context";
import { notificationContext } from "../notification-context";
export function LeaseReturnLink(){const [params]=useSearchParams(),id=params.get("leaseReturn");return id?<Link className="button secondary" to={leasePath(id,{...leaseContext(params),...documentLibraryContext(params),...agreementContext(params),...notificationContext(params)})}>← Back to lease workspace</Link>:null;}
