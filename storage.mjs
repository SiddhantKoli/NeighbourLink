import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const maximumBytes = 1_000_000;
const imageTypes = new Map([
  ['image/jpeg',{extension:'jpg',valid:bytes => bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff}],
  ['image/png',{extension:'png',valid:bytes => bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))}],
  ['image/webp',{extension:'webp',valid:bytes => bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'}]
]);

export function validateImage(bytes,contentType) {
  const image = imageTypes.get(contentType);
  if (!image || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maximumBytes || !image.valid(bytes)) {
    throw Object.assign(new Error('Choose a valid JPEG, PNG, or WebP image up to 1 MB.'),{status:400});
  }
  return image;
}

function safePath(root,key) {
  const fullPath = path.resolve(root,key);
  if (!fullPath.startsWith(root + path.sep)) throw new Error('Invalid storage key.');
  return fullPath;
}

export function createObjectStorage() {
  const mode = process.env.OBJECT_STORAGE_MODE || (process.env.NODE_ENV === 'production' ? 's3' : 'local');
  if (mode === 'memory') {
    if (process.env.NODE_ENV !== 'test') throw new Error('Memory object storage is only available in tests.');
    const objects = new Map();
    return {
      async put(key,bytes,contentType) { objects.set(key,{bytes:Buffer.from(bytes),contentType}); },
      async get(key) { const object=objects.get(key); return object ? {...object,bytes:Buffer.from(object.bytes)} : null; },
      async remove(key) { objects.delete(key); }
    };
  }
  if (mode === 'local') {
    const root = path.resolve(process.env.OBJECT_STORAGE_DIR || path.join(projectDirectory,'data','object-storage'));
    return {
      async put(key,bytes,contentType) { const target=safePath(root,key); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,bytes,{flag:'w'}); await writeFile(target + '.type',contentType,{flag:'w'}); },
      async get(key) {
        try { return {bytes:await readFile(safePath(root,key)),contentType:await readFile(safePath(root,key) + '.type','utf8')}; }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      },
      async remove(key) { await Promise.all([rm(safePath(root,key),{force:true}),rm(safePath(root,key) + '.type',{force:true})]); }
    };
  }
  if (mode !== 's3') throw new Error('OBJECT_STORAGE_MODE must be local or s3.');
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  const region = process.env.OBJECT_STORAGE_REGION;
  if (!bucket || !region) throw new Error('S3 object storage needs OBJECT_STORAGE_BUCKET and OBJECT_STORAGE_REGION.');
  return import('@aws-sdk/client-s3').then(({S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}) => {
    const client = new S3Client({
      region,
      endpoint:process.env.OBJECT_STORAGE_ENDPOINT || undefined,
      forcePathStyle:process.env.OBJECT_STORAGE_PATH_STYLE === '1',
      credentials:process.env.OBJECT_STORAGE_ACCESS_KEY_ID && process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ? {
        accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey:process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY
      } : undefined
    });
    return {
      async put(key,bytes,contentType) {
        await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:contentType,ServerSideEncryption:process.env.OBJECT_STORAGE_SSE || undefined}));
      },
      async get(key) {
        try {
          const result = await client.send(new GetObjectCommand({Bucket:bucket,Key:key}));
          return {bytes:Buffer.from(await result.Body.transformToByteArray()),contentType:result.ContentType || 'application/octet-stream'};
        } catch (error) { if (['NoSuchKey','NotFound'].includes(error.name)) return null; throw error; }
      },
      async remove(key) { await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key})); }
    };
  });
}

export const MAX_IMAGE_BYTES = maximumBytes;
