import fs from "node:fs";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET,
  CDN_BASE_URL,
} from "./config";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return null;
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
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
    console.warn("S3 not configured, serving video locally");
    return localPath;
  }

  const body = fs.readFileSync(localPath);

  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    }),
  );

  const url = CDN_BASE_URL ? `${CDN_BASE_URL}/${key}` : key;
  console.log(`Uploaded video: ${url}`);
  return url;
}
