import fs from "node:fs";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  CDN_BASE_URL,
} from "./config";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return null;
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export async function uploadVideo(
  jobId: string,
  localPath: string,
): Promise<string> {
  const client = getS3Client();
  const key = `videos/${jobId}.mp4`;

  if (!client) {
    console.warn("R2 not configured, serving video locally");
    return localPath;
  }

  const body = fs.readFileSync(localPath);

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    }),
  );

  const url = CDN_BASE_URL ? `${CDN_BASE_URL}/${key}` : key;
  console.log(`Uploaded video: ${url}`);
  return url;
}
