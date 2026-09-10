# Builds and runs the Administration Stack API. The actual deploy pipeline into the Platform
# Account is #202's job, not this one - this Dockerfile only proves the service is buildable and
# runnable. Runs the TypeScript source directly via `tsx` rather than a separate compile step:
# every internal package's `main` points at its own `src/index.ts` for the workspace-linked dev
# experience (`npm run dev`) to work without a build step, and re-deriving a compiled-output
# image on top of that would need its own resolution rewiring for marginal benefit at this stage.
FROM node:22-slim
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/aws-gateway/package.json packages/aws-gateway/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
ENV NODE_ENV=production
EXPOSE 3000
# node:22-slim defaults to root; the service itself only listens on a port and reads its own
# already-installed files, so it never needs write access to /workspace at runtime.
USER node
CMD ["npx", "tsx", "apps/api/src/index.ts"]
