# Deploy — LifeOS em produção (VPS)

Referenciado desde `ARCHITECTURE.md` §11. Cobre provisionamento do zero, deploys subsequentes,
backup/restore e o que cada peça faz.

## Arquitetura de deploy

```
Internet → Caddy (80/443, HTTPS automático) → web (Next.js standalone, porta interna 3000)
                                              → worker (scheduler, sem porta exposta)
                                                     ↓
                                              db (Postgres 16, sem porta exposta ao host)
```

Quatro containers (`docker-compose.prod.yml`): `db`, `web`, `worker`, `caddy`. Só Caddy expõe
portas ao host (80/443) — Postgres nunca é alcançável fora da rede Docker interna
(SECURITY_MODEL.md §14).

## 0. Pré-requisitos na VPS

- Linux com Docker Engine + Docker Compose v2 (`docker compose version` deve funcionar).
- Um domínio (não IP puro) apontando para o IP da VPS — Caddy precisa disso para emitir
  certificado Let's Encrypt automaticamente.
- Portas 80 e 443 liberadas no firewall da VPS.
- Uma chave de API da Anthropic válida.

## 1. Primeiro provisionamento (do zero)

```bash
# Na VPS, como um usuário com acesso ao Docker (não root, se possível — grupo `docker`).
git clone https://github.com/MarcioRigo9/LifeOS.git
cd LifeOS

cp .env.production.example .env.production
chmod 600 .env.production
```

Edite `.env.production` e preencha (gere segredos reais, nunca reaproveite os valores de dev):

```bash
# -hex (não -base64): as senhas vão sem escaping dentro de uma postgres:// URL em
# docker-compose.prod.yml, e base64 pode gerar "/", "+" ou "=", que quebram a URL.
openssl rand -hex 32   # rode duas vezes — uma para POSTGRES_ADMIN_PASSWORD, outra para POSTGRES_RUNTIME_PASSWORD
openssl rand -hex 32   # SESSION_SECRET (reservado — ver comentário no próprio arquivo)
```

Preencha também `ANTHROPIC_API_KEY`, `APP_URL` (ex.: `nossavida.exemplo.com.br`, sem `https://`)
e `ACME_EMAIL`.

Então rode o script de deploy, que builda as imagens, sobe o banco, roda as migrations
(0001-0023+) e sobe web/worker/caddy:

```bash
./deploy/deploy.sh --seed-catalog   # --seed-catalog só na primeira vez, ou quando quiser garantir
                                     # que o catálogo global de alimentos/exercícios existe
```

Acompanhe os logs se quiser ver o Caddy emitindo o certificado:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

Em alguns minutos, `https://<APP_URL>` deve responder. Teste diretamente o healthcheck:

```bash
curl -s https://<APP_URL>/api/healthz
# {"status":"ok"}
```

## 2. Deploys subsequentes (nova versão)

```bash
cd LifeOS
git pull origin main
./deploy/deploy.sh
```

O script builda as imagens novas, roda migrations pendentes (idempotente — `schema_migrations`
já registra o que foi aplicado) e só então recria `web`/`worker`/`caddy`. O `db` nunca é
recriado por um deploy — sessões ativas (cookie `lifeos_session`) e leases de jobs do scheduler
sobrevivem normalmente; qualquer lease que estava em voo quando o worker antigo foi substituído
é recuperada pelo reaper do próprio worker no próximo ciclo de polling (ADR 018), não por
intervenção manual.

## 3. Backups

```bash
./deploy/backup-db.sh
```

Gera um dump comprimido (`pg_dump -Fc`) em `./backups/lifeos-<timestamp>.dump` e apaga dumps
locais com mais de 7 dias. Agende via cron (ex.: todo dia às 03:00):

```cron
0 3 * * * cd /caminho/para/LifeOS && ./deploy/backup-db.sh >> /var/log/lifeos-backup.log 2>&1
```

**Copie os dumps para fora da VPS periodicamente** (rsync/scp para outra máquina, ou um bucket
S3-compatível) — retenção local de 7 dias protege contra erro operacional recente, não contra a
própria VPS sumir.

### Teste de restore (disaster recovery)

O comando exato já está documentado no fim de `deploy/backup-db.sh`. Resumo:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  pg_restore -U lifeos_admin -d lifeos --clean --if-exists < ./backups/lifeos-<timestamp>.dump
```

Rode esse teste periodicamente contra um banco descartável (nunca a produção) — um backup nunca
testado não é um backup.

## 4. Operação do dia a dia

```bash
COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml"

$COMPOSE ps                     # status dos 4 serviços
$COMPOSE logs -f web             # logs do Next.js
$COMPOSE logs -f worker          # logs do scheduler (ticks, claims, dead-letters)
$COMPOSE restart web worker      # reinício manual, se necessário
```

## 5. Regras de segurança que este stack já aplica

- `lifeos_admin` só é usado por: `db/init/*` (bootstrap), e o container `worker` (que já
  legitimamente precisa do pool admin para a descoberta cross-household read-only do scheduler,
  ver o comentário em `docker-compose.prod.yml` e `src/lib/scheduler/worker.ts`) — e, via esse
  mesmo container, pelas tarefas avulsas de `npm run migrate`/`npm run seed:catalog` que
  `deploy/deploy.sh` dispara. O container `web` não recebe `DATABASE_URL_ADMIN` — nenhuma rota
  de `apps/web/src/app/api/*` jamais usa um pool admin.
- `web` roda como usuário não-root (`nextjs`, uid 1001) dentro do container; `worker` roda como
  `worker` (uid 1001).
- Postgres nunca expõe porta ao host em produção.
- Segredos vivem só em `.env.production` (fora do git — `.gitignore` cobre todo `.env.*` exceto
  os `*.example`), nunca em `db/init/01-roles.sql` (esse arquivo mantém a senha de
  desenvolvimento hardcoded de propósito — é o que o `docker-compose.yml` de dev usa; em
  produção, `db/init/02-set-runtime-password.sh` sobrescreve a senha do `lifeos_runtime` com o
  valor real de `POSTGRES_RUNTIME_PASSWORD` na primeira inicialização do volume).
