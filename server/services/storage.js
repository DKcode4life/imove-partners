const fs = require('fs');
const path = require('path');
const config = require('../config');

// TODO: For S3 support → npm install @aws-sdk/client-s3

async function save(key, buffer, mimeType) {
  if (config.storage.provider === 's3') {
    return saveToS3(key, buffer, mimeType);
  }
  return saveLocal(key, buffer);
}

async function get(key) {
  if (config.storage.provider === 's3') {
    return getFromS3(key);
  }
  return getLocal(key);
}

async function remove(key) {
  if (config.storage.provider === 's3') {
    return removeFromS3(key);
  }
  return removeLocal(key);
}

// ── Local filesystem ────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function saveLocal(key, buffer) {
  const filePath = path.join(config.storage.localDir, key);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  return { key, provider: 'local', path: filePath };
}

async function getLocal(key) {
  const filePath = path.join(config.storage.localDir, key);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

async function removeLocal(key) {
  const filePath = path.join(config.storage.localDir, key);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── S3 ──────────────────────────────────────────────────────────────────────

async function saveToS3(key, buffer, mimeType) {
  // const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  // const client = new S3Client({
  //   region: config.storage.s3.region,
  //   credentials: {
  //     accessKeyId: config.storage.s3.accessKey,
  //     secretAccessKey: config.storage.s3.secretKey,
  //   },
  // });
  // await client.send(new PutObjectCommand({
  //   Bucket: config.storage.s3.bucket,
  //   Key: key,
  //   Body: buffer,
  //   ContentType: mimeType,
  // }));
  // return { key, provider: 's3', bucket: config.storage.s3.bucket };
  throw new Error('S3 storage not yet implemented — install @aws-sdk/client-s3 and uncomment');
}

async function getFromS3(key) {
  throw new Error('S3 storage not yet implemented');
}

async function removeFromS3(key) {
  throw new Error('S3 storage not yet implemented');
}

module.exports = { save, get, remove };
