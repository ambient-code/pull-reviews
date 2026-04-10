import { Storage } from "@google-cloud/storage";
import { GCS_BUCKET } from "./config";

let storage: Storage | null = null;

function getStorage(): Storage | null {
  if (!GCS_BUCKET) {
    return null;
  }
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

export async function uploadVideo(
  jobId: string,
  localPath: string,
): Promise<string> {
  const client = getStorage();
  const key = `videos/${jobId}.mp4`;

  if (!client) {
    console.warn("GCS not configured, serving video locally");
    return localPath;
  }

  await client.bucket(GCS_BUCKET).upload(localPath, {
    destination: key,
    contentType: "video/mp4",
  });

  const url = `https://storage.googleapis.com/${GCS_BUCKET}/${key}`;
  console.log(`Uploaded video: ${url}`);
  return url;
}
