import crypto from "node:crypto";
import type { Request, Response } from "express";
import { GITHUB_WEBHOOK_SECRET } from "../config";
import { processReview } from "../render/pipeline";
import type { PRContext } from "../types";

function verifySignature(payload: Buffer, signature: string): boolean {
  if (!GITHUB_WEBHOOK_SECRET) return true; // skip in dev if no secret
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature),
  );
}

export async function handleWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const event = req.headers["x-github-event"] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!rawBody || !signature) {
    res.status(400).json({ error: "Missing signature or body" });
    return;
  }

  if (!verifySignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Respond immediately
  res.status(200).json({ received: true });

  if (event !== "pull_request") return;

  const payload = JSON.parse(rawBody.toString("utf-8"));
  const action = payload.action as string;

  if (action !== "opened" && action !== "synchronize") return;

  const pr = payload.pull_request;
  const ctx: PRContext = {
    installationId: payload.installation?.id,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    prNumber: pr.number,
    prTitle: pr.title,
    authorLogin: pr.user.login,
    authorAvatarUrl: pr.user.avatar_url,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    labels: (pr.labels ?? []).map((l: { name: string }) => l.name),
    body: pr.body ?? "",
  };

  console.log(
    `Processing PR #${ctx.prNumber} (${action}) on ${ctx.owner}/${ctx.repo}`,
  );

  // Fire-and-forget — errors are logged, not propagated
  processReview(ctx).catch((err) => {
    console.error(`Failed to process PR #${ctx.prNumber}:`, err);
  });
}
