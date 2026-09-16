#!/bin/bash
# Daemon de retry: tenta alocar uma instância Ampere A1 Flex (Always Free) em sa-saopaulo-1
# até a OCI liberar capacidade ("Out of host capacity"). Reusa deploy/provision-oci.py, que já
# é idempotente por display_name — então isso NÃO mexe na VM de produção atual (`lifeos-vps`,
# AMD Micro): cria uma instância separada (`lifeos-vps-a1`) para migrar depois, manualmente,
# quando ela for alocada.
#
# Requer o perfil `~/.oci/config` já configurado (mesmo usado pelo provisionamento original) e
# `uv`/`uvx` no PATH. Roda no host onde as credenciais da API da OCI já estão configuradas —
# hoje essa é a máquina local, não a VM em produção (evita levar a chave privada da OCI pra lá).
#
# Uso:
#   nohup ./scripts/oci-retry-ampere.sh > /dev/null 2>&1 &
#   tail -f scripts/logs/oci-retry-ampere.log
#
# Alternativa (host Linux com systemd): ver scripts/oci-retry-ampere.service.example.
#
# Variáveis de ambiente aceitas (todas opcionais):
#   VM_OCPUS                (default 2  — checar o limite real com list_limit_values antes de
#                             subir: nem toda tenancy tem os "até 4 OCPU/24GB" às vezes anunciados
#                             para Always Free A1 — esta aqui, por exemplo, tem só 2/12GB no total)
#   VM_MEMORY_GB             (default 12)
#   VM_DISPLAY_NAME          (default lifeos-vps-a1)
#   RETRY_INTERVAL_SECONDS   (default 60; um jitter de 0-30s é somado em cada tentativa,
#                             para não bater na API da OCI sempre no mesmo intervalo exato)
set -u
export PATH="$PATH:/c/Users/Administrator/AppData/Local/Python/pythoncore-3.14-64/Scripts"
cd "$(dirname "$0")/.."

LOG_DIR="scripts/logs"
LOG_FILE="$LOG_DIR/oci-retry-ampere.log"
mkdir -p "$LOG_DIR"

export VM_SHAPE="VM.Standard.A1.Flex"
export VM_OCPUS="${VM_OCPUS:-2}"
export VM_MEMORY_GB="${VM_MEMORY_GB:-12}"
export VM_DISPLAY_NAME="${VM_DISPLAY_NAME:-lifeos-vps-a1}"
BASE_INTERVAL="${RETRY_INTERVAL_SECONDS:-60}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "=== Daemon iniciado (shape=$VM_SHAPE ocpus=$VM_OCPUS mem=${VM_MEMORY_GB}GB display_name=$VM_DISPLAY_NAME, PID=$$) ==="

ATTEMPT=0
while true; do
  ATTEMPT=$((ATTEMPT + 1))
  log "--- Tentativa $ATTEMPT ---"
  OUT=$(uvx --with oci python deploy/provision-oci.py 2>&1)
  echo "$OUT" >> "$LOG_FILE"

  if echo "$OUT" | grep -q "IP público:"; then
    IP=$(echo "$OUT" | grep "IP público:" | sed 's/.*IP público: //')
    log "=== SUCESSO na tentativa $ATTEMPT — instância '$VM_DISPLAY_NAME' alocada. IP público: $IP ==="
    log "=== Próximo passo (manual): migrar o deploy de lifeos-vps (AMD Micro) para $IP (Ampere A1) ==="
    exit 0
  fi

  if echo "$OUT" | grep -qi "Out of host capacity"; then
    JITTER=$((RANDOM % 31))
    WAIT=$((BASE_INTERVAL + JITTER))
    log "Sem capacidade ainda. Aguardando ${WAIT}s (jitter incluso) antes da próxima tentativa..."
    sleep "$WAIT"
    continue
  fi

  log "=== Falhou por motivo DIFERENTE de 'Out of host capacity'. Parando o daemon para revisão manual. ==="
  exit 1
done
