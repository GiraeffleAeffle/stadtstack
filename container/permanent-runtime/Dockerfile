ARG NODE_BASE_IMAGE=docker.io/library/node
ARG NODE_BASE_DIGEST

FROM ${NODE_BASE_IMAGE}@${NODE_BASE_DIGEST} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force

FROM ${NODE_BASE_IMAGE}@${NODE_BASE_DIGEST} AS runtime
ARG SOURCE_REVISION
ARG SOURCE_DATE_EPOCH
LABEL org.opencontainers.image.title="stadtstack-permanent-runtime" \
      org.opencontainers.image.description="Reviewed-public Röbel coordinator and federation runtime" \
      org.opencontainers.image.source="https://github.com/GiraeffleAeffle/stadtstack" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.created="${SOURCE_DATE_EPOCH}" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV HOME=/tmp \
    TMPDIR=/tmp \
    NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json LICENSE NOTICE ./
COPY src ./src
USER 10001:10001
EXPOSE 18080 18081
ENTRYPOINT ["node","--experimental-strip-types","/app/src/permanent-runtime-cli.ts"]
CMD ["serve","--config","/etc/stadtstack/runtime.json","--actor-tokens","/var/run/secrets/stadtstack/actor-tokens.json"]
