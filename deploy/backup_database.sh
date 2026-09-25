#!/bin/sh
set -eu

: "${BACKUP_PGHOST:?Defina BACKUP_PGHOST}"
: "${BACKUP_PGDATABASE:?Defina BACKUP_PGDATABASE}"
: "${BACKUP_PGUSER:?Defina BACKUP_PGUSER}"
BACKUP_PGPORT="${BACKUP_PGPORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sistema-campo}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/database-$STAMP.sql.gz"

umask 077
mkdir -p "$BACKUP_DIR"
pg_dump --no-owner --no-acl --host "$BACKUP_PGHOST" --port "$BACKUP_PGPORT" \
  --username "$BACKUP_PGUSER" --dbname "$BACKUP_PGDATABASE" | gzip -9 > "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
find "$BACKUP_DIR" -type f -name 'database-*.sql.gz*' -mtime "+$RETENTION_DAYS" -delete

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  REMOTE="${BACKUP_RCLONE_REMOTE%/}"
  rclone copyto "$FILE" "$REMOTE/$(basename "$FILE")"
  rclone copyto "$FILE.sha256" "$REMOTE/$(basename "$FILE.sha256")"
fi

echo "Backup concluído: $FILE"
