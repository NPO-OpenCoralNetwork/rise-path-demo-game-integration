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
#   BACKUP_SA_EMAIL=risepath-backup@your-project.iam.gserviceaccount.com ./provision-gce.sh
#     the backups' least-privilege service account (doc/guides/first-launch.ja.md 3.8, 4.1; Phase 9, D4): the VM
#     runs as it with scope cloud-platform, and IAM (two roles on the backup bucket only) is what limits it. Unset:
#     the VM gets GCE's default account, whose default scopes allow Cloud Storage read-only (the backups cannot
#     upload); the script prints how to attach the account later. Set for a VM that already exists: the script
#     changes nothing and prints the same commands with that account. For a VM that exists, the commands are printed
#     only when it does not run as that account already (unset: as GCE's default account), as read from the VM.
#     The commands are 手順書 4.1's, where the owner runs this script. Owner-facing lines are Japanese first.
set -euo pipefail

: "${GCP_PROJECT:?Set GCP_PROJECT}"
GCP_ZONE="${GCP_ZONE:-asia-northeast1-b}"
GCP_REGION="${GCP_REGION:-asia-northeast1}"
VM_NAME="${VM_NAME:-risepath-vm}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-medium}"
DISK_SIZE="${DISK_SIZE:-50GB}"
SCHEDULE_NAME="${SCHEDULE_NAME:-risepath-dev-schedule}"
NIGHT_STOP="${NIGHT_STOP:-0}"
BACKUP_SA_EMAIL="${BACKUP_SA_EMAIL:-}"

SA_FLAGS=()
if [[ -n "${BACKUP_SA_EMAIL}" ]]; then
  if [[ ! "${BACKUP_SA_EMAIL}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$ ]]; then
    echo "❌ BACKUP_SA_EMAIL が、サービスアカウントの形（名前@プロジェクト.iam.gserviceaccount.com）ではありません。手順書 3.8 で作った名前を書きます（まだ何も作っていません）。"
    echo "   BACKUP_SA_EMAIL is not a service account address (name@project.iam.gserviceaccount.com)"
    exit 1
  fi
  SA_FLAGS=(--service-account="${BACKUP_SA_EMAIL}" --scopes=cloud-platform)
fi

# sa_commands <service account>: the three commands that attach it to the VM (which must be stopped for it).
sa_commands() {
  echo "      gcloud compute instances stop ${VM_NAME} --zone=${GCP_ZONE}"
  echo "      gcloud compute instances set-service-account ${VM_NAME} --zone=${GCP_ZONE} \\"
  echo "        --service-account=$1 --scopes=cloud-platform"
  echo "      gcloud compute instances start ${VM_NAME} --zone=${GCP_ZONE}"
}

gcloud config set project "${GCP_PROJECT}"

CREATED=0
CURRENT_SA=''
if ! gcloud compute instances describe "${VM_NAME}" --zone="${GCP_ZONE}" >/dev/null 2>&1; then
  CREATED=1
  echo "==> Creating VM ${VM_NAME} (${MACHINE_TYPE}, ${DISK_SIZE})"
  gcloud compute instances create "${VM_NAME}" \
    --zone="${GCP_ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --boot-disk-size="${DISK_SIZE}" \
    --boot-disk-type=pd-balanced \
    --image-family=ubuntu-2404-lts-amd64 \
    --image-project=ubuntu-os-cloud \
    --tags=risepath-vm \
    --metadata=enable-oslogin=TRUE \
    ${SA_FLAGS[@]+"${SA_FLAGS[@]}"}
else
  echo "==> VM ${VM_NAME} already exists (its service account is not changed here)"
  # The account the VM runs as now (an address, not a secret), so the commands are printed only when they are needed:
  # stopping a VM that already runs as the backup account would stop Rise Path for nothing (review round 3, finding 9).
  CURRENT_SA="$(gcloud compute instances describe "${VM_NAME}" --zone="${GCP_ZONE}" --format='value(serviceAccounts[0].email)' 2>/dev/null || true)"
  if [[ -n "${BACKUP_SA_EMAIL}" ]]; then
    if [[ "${CURRENT_SA}" == "${BACKUP_SA_EMAIL}" ]]; then
      echo "ℹ️  VM はもう BACKUP_SA_EMAIL のアカウントで動いています（何も変えていません）。"
      echo "    (The VM already runs as BACKUP_SA_EMAIL; nothing changed.)"
    else
      echo "ℹ️  VM はもうあるので、サービスアカウントはここでは変えていません。BACKUP_SA_EMAIL のアカウントにするときは、"
      echo "    次の 3 つを順に実行します（VM が止まるので、Rise Path も止まります。手順書 4.1）:"
      echo "    (The VM exists; to run it as BACKUP_SA_EMAIL, stop it, set the account, start it:)"
      sa_commands "${BACKUP_SA_EMAIL}"
    fi
  fi
fi

# The backups (deploy/risepath-vm/scripts/backup.sh) upload with the VM's service account.
if [[ -z "${BACKUP_SA_EMAIL}" ]]; then
  if [[ "${CREATED}" == 1 || "${CURRENT_SA}" =~ -compute@developer\.gserviceaccount\.com$ ]]; then
    echo "⚠️  BACKUP_SA_EMAIL がないので、VM は GCE のふつうのサービスアカウントで動きます。これでは控えを送れません。"
    echo "    あとで控えのアカウントを付けます。次の 3 つを順に実行します（VM が止まります。手順書 4.1）:"
    echo "    (BACKUP_SA_EMAIL is unset: the VM runs as GCE's default service account, which cannot upload backups."
    echo "    Attach the backup account later; the VM must be stopped:)"
    sa_commands "risepath-backup@${GCP_PROJECT}.iam.gserviceaccount.com"
  elif [[ -n "${CURRENT_SA}" ]]; then
    echo "ℹ️  VM はもうあり、GCE のふつうのサービスアカウントではないアカウント（${CURRENT_SA}）で動いています。何も変えていません。"
    echo "    (The VM exists and runs as ${CURRENT_SA}, not as GCE's default account; nothing changed.)"
  else
    echo "ℹ️  VM はもうあるので、サービスアカウントは変えていません（VM のアカウントを読めませんでした）。"
    echo "    控えのアカウントが付いていないときだけ、次の 3 つを順に実行します（VM が止まります。手順書 4.1）:"
    echo "    (The VM exists; its account could not be read. Only if it does not run as the backup account:)"
    sa_commands "risepath-backup@${GCP_PROJECT}.iam.gserviceaccount.com"
  fi
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