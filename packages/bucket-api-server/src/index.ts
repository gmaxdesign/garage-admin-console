export { createBucketRouter } from './router.js';
export type { CreateBucketRouterOptions } from './router.js';
export { createBucketCorsCacheKey } from './cors.js';
export type { BucketCorsCacheKeyPart } from './cors.js';
export { createS3Client, getCachedS3Client } from './s3-client.js';
export type { S3Client, S3ClientCredentials, S3ClientOptions } from './s3-client.js';
export { BucketAccessError } from './types.js';
export type { BucketContext, ResolveContextFn, S3Object, Logger } from './types.js';
export {
  LARGE_FILE_THRESHOLD_BYTES,
  MULTIPART_PART_SIZE_BYTES,
  MULTIPART_MAX_PARTS,
} from './constants.js';
// StockDL fork: re-exported for the Admin "Relatórios" (insights) routes.
export { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
export { getSignedUrl } from '@aws-sdk/s3-request-presigner';
