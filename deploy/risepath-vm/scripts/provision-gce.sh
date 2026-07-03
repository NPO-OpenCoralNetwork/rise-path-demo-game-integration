#!/usr/bin/env bash
# Create risepath-vm on GCP + dev schedule (09:00–23:00 Asia/Tokyo)
# Prereqs: gcloud auth, billing enabled, project set
#
# Usage:
#   export GCP_PROJECT=your-project
#   export GCP_ZONE=asia-northeast1-b
#   ./provision-gce.sh
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT}"
GCP_ZONE="${GCP_ZONE:-asia-northeast1-b}"
GCP_REGION="${GCP_REGION:-asia-northeast1}"
VM_NAME="${VM_NAME:-risepath-vm}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-medium}"
DISK_SIZE="${DISK_SIZE:-50GB}"
SCHEDULE_NAME="${SCHEDULE_NAME:-risepath-dev-schedule}"

gcloud config set project "${GCP_PROJECT}"

if ! gcloud compute instances describe "${VM_NAME}" --zone="${GCP_ZONE}" >/dev/null 2>&1; then
  echo "==> Creating VM ${VM_NAME} (${MACHINE_TYPE}, ${DISK_SIZE})"
  gcloud compute instances create "${VM_NAME}" \
    --zone="${GCP_ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --boot-disk-size="${DISK_SIZE}" \
    --boot-disk-type=pd-balanced \
    --image-family=ubuntu-2404-lts-amd64 \
    --image-project=ubuntu-os-cloud \
    --tags=risepath-vm \
    --metadata=enable-oslogin=TRUE
else
  echo "==> VM ${VM_NAME} already exists"
fi

if ! gcloud compute resource-policies describe "${SCHEDULE_NAME}" --region="${GCP_REGION}" >/dev/null 2>&1; then
  echo "==> Creating instance schedule ${SCHEDULE_NAME} (start 09:00 / stop 23:00 JST)"
  gcloud compute resource-policies create instance-schedule "${SCHEDULE_NAME}" \
    --region="${GCP_REGION}" \
    --vm-start-schedule="0 9 * * *" \
    --vm-stop-schedule="0 23 * * *" \
    --timezone=Asia/Tokyo
else
  echo "==> Schedule ${SCHEDULE_NAME} already exists"
fi

echo "==> Attaching schedule to ${VM_NAME}"
gcloud compute instances add-resource-policies "${VM_NAME}" \
  --zone="${GCP_ZONE}" \
  --resource-policies="https://www.googleapis.com/compute/v1/projects/${GCP_PROJECT}/regions/${GCP_REGION}/resourcePolicies/${SCHEDULE_NAME}"

cat <<EOF

VM provisioned. Next steps:

1. SSH:  gcloud compute ssh ${VM_NAME} --zone=${GCP_ZONE}
2. On VM: clone repo and run deploy/risepath-vm/scripts/bootstrap-vm.sh
3. Tailscale: curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --hostname=risepath-vm
4. Mac: tailscale ping risepath-vm

Firewall: do NOT open 5432/3006/3100 to 0.0.0.0/0. Use Tailscale only.

Estimated cost (scheduled 14h/day): ~¥3,000–3,800/month incl. 50GB disk
EOF