# Local delivery and release guidance

The user disabled Jira tracking on October 17, 2026. Do not read, create, update or synchronize Jira issues for routine development unless explicitly requested. Existing issue keys and historical links may remain as references; they create no tracking obligation.

- Keep progress, changed files, validation evidence and the next action in `docs/current-work.md` (under 500 words). Use feature contracts and `docs/product-roadmap.md` for durable behavior and scope.
- Preserve stable roadmap IDs and completed capabilities. Distinguish local implementation, PR, merge, deployment and user acceptance; a passing test does not establish acceptance.
- Update relevant feature documentation and release notes for shipped behavior, including migrations, activation requirements and outstanding scope.
- PR descriptions should identify the user outcome, role/property boundaries, meaningful validation and material limitations. Preserve unrelated local changes.
- Merge, deployment, Terraform apply and live provider/configuration changes require authorization for that action. Stripe remains last.
- Keep credentials, private records and preview dumps out of handoffs and artifacts.
