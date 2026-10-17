import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import type { IdentityProvider } from "./identity-provider.js";
import { audit, input, mutation, scoped } from "./operational.js";

// Company owners act on the account already referenced by this tenant. The
// caller cannot supply an email/subject, and a reset never provisions a user.
export function registerAccountPasswords(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, provider?: IdentityProvider) {
  server.post<{Params:{contactId:string}}>("/api/company/resident-contacts/:contactId/password-reset", {preValidation:authenticate}, async request=>{
    mutation(request,origin);input(request,[]);
    const contactId=assignmentId(request.params.contactId);
    if(!provider)throw new AccessError(503,"IDENTITY_NOT_CONFIGURED","Password reset is unavailable. Contact your platform administrator.");
    const resolve=()=>scoped(db,request,"members.manage",async(tx,companyId)=>{
      const contact=await tx.residentContact.findFirst({where:{id:contactId,companyId,status:"active"}});
      if(!contact)throw new AccessError(404,"NOT_FOUND","Tenant not found.");
      if(!contact.userId)throw new AccessError(409,"ACCOUNT_REQUIRED","Create this person's account from Property Flow before requesting a password reset.");
      const user=await tx.user.findUniqueOrThrow({where:{id:contact.userId},include:{identities:true}});
      const identity=user.identities.find(i=>i.issuer===provider.issuer);
      if(user.status!=="active"||!identity)throw new AccessError(409,"IDENTITY_CONFLICT","The account is disabled or its sign-in identity needs review in Property Flow Users.");
      return {userId:user.id,subject:identity.subject};
    });
    const account=await resolve();
    const remote=await provider.get(account.subject);
    if(remote.blocked || !remote.identities?.some(i=>i.provider==="auth0"&&i.connection===provider.databaseConnection))throw new AccessError(409,"PASSWORD_RESET_UNAVAILABLE","This account does not use this application's email/password sign-in. Its sign-in provider manages the password.");
    const current=await resolve();
    if(current.userId!==account.userId||current.subject!==account.subject)throw new AccessError(409,"IDENTITY_CONFLICT","The account changed. Refresh and retry.");
    await scoped(db,request,"members.manage",async(tx,companyId)=>{
      const contact=await tx.residentContact.findFirst({where:{id:contactId,companyId,status:"active",userId:account.userId}});
      if(!contact)throw new AccessError(409,"IDENTITY_CONFLICT","The account changed. Refresh and retry.");
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${account.userId} RETURNING id`;
      const user=await tx.user.findUniqueOrThrow({where:{id:account.userId}});
      if(user.status!=="active")throw new AccessError(403,"ACCOUNT_DISABLED","This account is disabled.");
      if(user.passwordSetupSentAt&&Date.now()-user.passwordSetupSentAt.getTime()<60000)throw new AccessError(429,"SETUP_COOLDOWN","Wait a minute before requesting another password reset email.");
      await tx.user.update({where:{id:user.id},data:{passwordSetupSentAt:new Date()}});
      await audit(tx,request,companyId,user.id,"user.password_reset.requested");
    });
    await provider.setup(remote.email);
    return {message:"Password reset email requested for this existing account. The user chooses their own password."};
  });
}
