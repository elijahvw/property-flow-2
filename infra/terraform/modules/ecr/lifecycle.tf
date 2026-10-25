# Only abandoned, untagged image manifests are eligible. Every SHA-tagged
# release and rollback image is retained, regardless of age or image count.
# Preview against the live repository before applying (see the AWS audit).
resource "aws_ecr_lifecycle_policy" "untagged" {
  repository = aws_ecr_repository.app.name
  policy     = file("${path.module}/image-lifecycle-policy.json")
}
