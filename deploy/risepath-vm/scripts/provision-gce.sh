#!/usr/bin/env bash
# Create risepath-vm on GCP. It runs 24 h a day: the public API (Cloudflare Tunnel) needs it up.
# NIGHT_STOP=1 opts in to the old dev schedule (start 09:00 / stop 23:00 Asia/Tokyo).
# Prereqs: gcloud auth, billing enabled, project set
#
# Usage:
#   export GCP_PROJECT=your-project
#   export GCP_ZONE=asia-northeast1-b
#   ./provision-gce.sh
#   MACHINE_TYPE=e2-standard-2 ./provision-gce.sh   # with the Memanto overlay (8 GB)
#   NIGHT_STOP=1 ./provision-gce.sh   # dev only: stop the VM at night
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT}"
GCP_ZONE="${GCP_ZONE:-asia-northeast1-b}"
GCP_REGION="${GCP_REGION:-asia-northeast1}"
VM_NAME="${VM_NAME:-risepath-vm}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-medium}"
DISK_SIZE="${DISK_SIZE:-50GB}"
SCHEDULE_NAME="${SCHEDULE_NAME:-risepath-dev-schedule}"
NIGHT_STOP="${NIGHT_STOP:-0}"

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

if [[ "${NIGHT_STOP}" == "1" ]]; then
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

  echo "==> Attaching schedule to ${VM_NAME} (NIGHT_STOP=1: the public API is down 23:00–09:00 JST)"
  gcloud compute instances add-resource-policies "${VM_NAME}" \
    --zone="${GCP_ZONE}" \
    --resource-policies="https://www.googleapis.com/compute/v1/projects/${GCP_PROJECT}/regions/${GCP_REGION}/resourcePolicies/${SCHEDULE_NAME}"
else
  echo "==> No night stop (NIGHT_STOP=1 opts in). If an earlier run attached ${SCHEDULE_NAME}, detach it:"
  echo "    gcloud compute instances remove-resource-policies ${VM_NAME} --resource-policies=${SCHEDULE_NAME} --zone=${GCP_ZONE}"
fi

cat <<EOF

VM provisioned. Next steps:

1. SSH:  gcloud compute ssh ${VM_NAME} --zone=${GCP_ZONE}
2. Tailscale: first remove the old risepath-vm in the admin console (Machines), or the new
   machine becomes risepath-vm-1. Then, on the VM:
     curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --hostname=risepath-vm
     tailscale status   # this machine must be listed as risepath-vm
3. On the VM: clone into /opt/risepath and run bootstrap (run 1 installs Docker and swap, then
   stops at stack.env):
     sudo install -d -o "\$(id -un)" -g "\$(id -gn)" /opt/risepath
     git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git /opt/risepath
     cd /opt/risepath/deploy/risepath-vm/scripts && ./bootstrap-vm.sh
   Then exit, SSH in again (docker group), fill stack.env and run ./bootstrap-vm.sh again.
4. Mac: ssh-keygen -R risepath-vm; tailscale ping risepath-vm

Firewall: no inbound rule is needed. Mac access goes over Tailscale, and the public API leaves
through Cloudflare Tunnel (egress TCP/UDP 7844 must stay allowed). Do NOT open
5432/3006/3100/8642/8880 to 0.0.0.0/0.

Cost: ${MACHINE_TYPE} running 24 h a day plus the ${DISK_SIZE} pd-balanced disk (more than the old
14 h/day schedule); check the GCP pricing calculator. NIGHT_STOP=1 brings back the night stop.
EOF