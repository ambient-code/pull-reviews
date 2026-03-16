import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { GITHUB_APP_ID, GITHUB_PRIVATE_KEY } from "../config";

function getPrivateKey(): string {
  if (GITHUB_PRIVATE_KEY.startsWith("-----BEGIN")) return GITHUB_PRIVATE_KEY;
  return Buffer.from(GITHUB_PRIVATE_KEY, "base64").toString("utf-8");
}

export function getInstallationOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: GITHUB_APP_ID,
      privateKey: getPrivateKey(),
      installationId,
    },
  });
}
