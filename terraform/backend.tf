# GCS remote backend for Terraform state.
# Initialize with: terraform init -backend-config="bucket=YOUR_BUCKET_NAME"
# Or set TF_CLI_ARGS_init=-backend-config="bucket=YOUR_BUCKET_NAME"
terraform {
  backend "gcs" {
    prefix = "terraform/state"
    # bucket is provided via -backend-config at init time or via TF_CLI_ARGS_init
  }
}
