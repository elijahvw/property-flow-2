# Development custom domain

The development application uses `https://propertyflow.saasapps.cloud` on the existing CloudFront distribution `E3S4MA6ULWWKE6` (`drfbeumseaytt.cloudfront.net`). This is the requested configuration; DNS validation, CloudFront activation and live acceptance must be verified separately. The user performs GoDaddy, AWS and Auth0 setup manually for this feature.

## Configuration retained by deployments

`infra/terraform/envs/dev/custom-domain.auto.tfvars.json` commits the hostname and the existing us-east-1 ACM certificate ARN. Terraform loads it automatically, including during ingestion bootstrap and normal deployment. No GitHub `FRONTEND_CUSTOM_DOMAIN` variable is required. The certificate remains managed in ACM; Terraform references it and does not request or replace it. Rotate certificates by updating the committed ARN after the replacement is issued.

The same configuration sets the existing distribution's alternate hostname and SNI/TLS 1.2 certificate, the backend `APP_ORIGIN`, and the `public_app_url` output used by deployment checks. Existing distribution and bucket identities remain unchanged; cache invalidations still target the distribution ID. There is no database migration or change to identity, company permissions, financial records or application data.

Manual deployment runs verify that the configured hostname serves its own HTTPS homepage before infrastructure apply, ingestion bootstrap or ECS changes. This checks DNS, TLS trust/hostname verification and frontend availability without requiring the development database to be running. A pending certificate, unresolved DNS, foreign redirect or unavailable homepage stops deployment. Push/plan-only runs still produce a reviewable Terraform plan without applying it. Local direct Terraform applies require the same manual readiness checks.

## Manual activation order

1. In GoDaddy DNS for `saasapps.cloud`, add the ACM validation CNAME. Name: `_8cda9b7f29fcc56b288e57bcdffbe34c.propertyflow`. Value: `_50047488ea12782db03d590962d0ab0d.wzccmgtwzk.acm-validations.aws`. Keep it for renewal. GoDaddy appends the zone name to the relative Name field; do not append `saasapps.cloud` twice. The public nameservers are GoDaddy's, so creating this record only in Route 53 will not validate it.
2. In ACM **us-east-1**, wait for certificate `46d66083-8615-4074-98d6-5195742e6e73` to show **Issued**. Pending validation means AWS has not confirmed the DNS proof; saving a record is not evidence of issuance.
3. On the existing CloudFront distribution, add `propertyflow.saasapps.cloud` and select that certificate. Wait for the distribution update to finish.
4. Add the GoDaddy routing CNAME: `propertyflow` → `drfbeumseaytt.cloudfront.net`.
5. In the existing Auth0 Regular Web Application, add `https://propertyflow.saasapps.cloud/api/auth/callback` to Allowed Callback URLs and `https://propertyflow.saasapps.cloud` to Allowed Logout URLs. Keep the old entries during transition. Do not change client secrets, issuer/subject identities or the Auth0 tenant hostname.
6. Verify the new HTTPS homepage. Then merge the reviewed Terraform PR and use the normal reviewed deployment to align the backend origin. If the backend was already changed manually, its `APP_ORIGIN` must match the same new HTTPS origin. Verify actual sign-in, protected navigation, CSRF-protected saves and sign-out afterward. Existing host-only cookies do not transfer to the new hostname; users may need to sign in again.

Do not deploy the old Terraform revision after making console changes: it does not retain the alias/certificate or new app origin. Merging is separate from deployment; this PR performs no live apply or DNS/Auth0 mutation.

## Validation and rollback

Run `terraform fmt -check` on the changed Terraform files, `terraform init -backend=false` and `terraform validate` in the dev root, the mocked plans in `infra/terraform/modules/s3_frontend/tests/`, and `python3 -m unittest discover -s tests/operations -p 'test_*.py'`. Mocked plans never contact AWS resource APIs or apply resources.

For a reviewed rollback, set `frontend_custom_domain` explicitly to `null` in the committed auto-tfvars file. This restores the original configured app origin and default CloudFront certificate and disables the custom-domain readiness gate. Review the plan and coordinate DNS/Auth0 before applying: removing an active alias/certificate interrupts the custom hostname. Do not delete the ACM validation CNAME or certificate as an automatic cleanup step.
