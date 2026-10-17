BEGIN;
-- Invitations refer to the same existing User/Auth0 identity as every other
-- workflow. They are onboarding records, never a second kind of account.
ALTER TABLE "Invitation" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Invitation_accountId_idx" ON "Invitation"("accountId");

-- An invitation can never be retargeted to another account after review.
CREATE FUNCTION retain_invitation_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."accountId" IS DISTINCT FROM NEW."accountId" THEN
    RAISE EXCEPTION 'Invitation account target is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retain_invitation_account BEFORE UPDATE ON "Invitation" FOR EACH ROW EXECUTE FUNCTION retain_invitation_account();
COMMIT;
