# A imagem é a oficial do AdminTool 2.7.2; só trocamos o entrypoint.
#
# A imagem oficial tem ENTRYPOINT ["/app/entrypoint.prod.sh"], que espera o host
# `dbs:5432` (o Postgres do docker-compose local). No Render o banco é gerenciado
# e vem por DATABASE_URL, então esse entrypoint nunca sairia da espera.
FROM ghcr.io/electron-minecraft-launcher/eml-admintool:2.7.2

COPY server-patch/admintool/render/entrypoint.sh /app/render-entrypoint.sh
RUN chmod +x /app/render-entrypoint.sh

# Precisa ser ENTRYPOINT (não CMD): CMD viraria argumento do entrypoint oficial.
ENTRYPOINT ["/app/render-entrypoint.sh"]
