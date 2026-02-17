output "service_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.swarm.uri
}

output "bucket_name" {
  description = "GCS bucket for persistence"
  value       = google_storage_bucket.swarm_data.name
}

output "service_account_email" {
  description = "Service account email"
  value       = google_service_account.swarm.email
}

# GitHub Actions WIF values (for repo secrets)
output "wif_provider" {
  description = "Workload Identity Federation provider (set as WIF_PROVIDER GitHub secret)"
  value       = var.github_repo != "" ? google_iam_workload_identity_pool_provider.github[0].name : ""
}

output "wif_service_account" {
  description = "Service account for GitHub Actions (set as WIF_SERVICE_ACCOUNT GitHub secret)"
  value       = var.github_repo != "" ? google_service_account.swarm.email : ""
}
