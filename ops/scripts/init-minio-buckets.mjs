import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const required = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_PRIVATE_BUCKET",
  "S3_STAGING_BUCKET",
  "S3_PUBLIC_BUCKET",
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
});

for (const bucket of [
  process.env.S3_PRIVATE_BUCKET,
  process.env.S3_STAGING_BUCKET,
  process.env.S3_PUBLIC_BUCKET,
]) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  await client.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
}

process.stdout.write("MinIO buckets are ready.\n");
