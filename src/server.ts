import express from "express";
import { PORT } from "./config";
import { handleWebhook } from "./github/webhooks";
import { ensureBundle } from "./render/pipeline";

const app = express();

// Parse JSON but preserve raw body for webhook signature verification
app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "preel" });
});

// GitHub webhook endpoint
app.post("/webhook", handleWebhook);

// Start server
async function start() {
  console.log("Pre-bundling Remotion project...");
  await ensureBundle();

  app.listen(PORT, () => {
    console.log(`Preel server listening on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
    console.log(`Health check: http://localhost:${PORT}/health`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
