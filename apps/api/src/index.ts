import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({
  ok: true,
  service: "devone-api",
  version: "1.0.0-alpha.1"
}));

const port = Number(process.env.PORT ?? 8787);

app.listen({ host: "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
