/**
 * StockDL fork — "Relatórios" (insights) API.
 *
 * Mounted at /api/clusters/:clusterId/insights (behind authenticateToken).
 *
 *   GET  /buckets/:bucket/search?q=&limit=   filename search over a cached index
 *   GET  /buckets/:bucket/usage?prefix=       space/objects per folder
 *   POST /buckets/:bucket/link                presigned GET link (preset expiry)
 *   POST /buckets/:bucket/reindex             drop the cached index
 *   GET  /downloads?days=30                   presigned downloads from the Caddy access log
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import express, { type Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  BucketAccessError,
  GetObjectCommand,
  ListObjectsV2Command,
  getSignedUrl,
} from '@garage/bucket-api-server';
import { getParam } from '@garage/server-config';

import { logger } from '../logger.js';
import { getAuthorizedBucketKeys, resolveBucketKey } from '../lib/garage-keys.js';
import { buildS3Client } from '../lib/s3-client.js';

const router: Router = express.Router({ mergeParams: true });

const INDEX_TTL_MS = 10 * 60_000;
const ACCESS_LOG_DIR = process.env.ACCESS_LOG_DIR ?? '/logs';
const ACCESS_LOG_PREFIX = process.env.ACCESS_LOG_PREFIX ?? 's3-access';
const TZ_OFFSET_HOURS = Number(process.env.REPORT_TZ_OFFSET_HOURS ?? '-3');

interface IndexedObject {
  key: string;
  size: number;
  mtime: number;
}
interface BucketIndex {
  items: IndexedObject[];
  builtAt: number;
  tookMs: number;
}

const indexes = new Map<string, BucketIndex>();
const building = new Map<string, Promise<BucketIndex>>();

/** Picks an authorized key: read-only first (least privilege), else any readable one. */
async function clientFor(clusterId: string, bucket: string) {
  const keys = await getAuthorizedBucketKeys(clusterId, bucket);
  const readable = keys.filter((k) => k.permissions.read);
  const pick = readable.find((k) => !k.permissions.write) ?? readable[0];
  if (!pick) throw new BucketAccessError(403, 'Nenhuma chave com leitura neste bucket');
  const resolved = await resolveBucketKey(clusterId, pick.accessKeyId);
  return { client: buildS3Client(resolved), keyName: pick.name };
}

async function buildIndex(clusterId: string, bucket: string): Promise<BucketIndex> {
  const t0 = Date.now();
  const { client } = await clientFor(clusterId, bucket);
  const items: IndexedObject[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of out.Contents ?? []) {
      if (!o.Key) continue;
      items.push({ key: o.Key, size: o.Size ?? 0, mtime: o.LastModified?.getTime() ?? 0 });
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  items.sort((a, b) => b.mtime - a.mtime);
  return { items, builtAt: Date.now(), tookMs: Date.now() - t0 };
}

async function getIndex(clusterId: string, bucket: string): Promise<BucketIndex> {
  const id = `${clusterId}/${bucket}`;
  const cached = indexes.get(id);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;
  const pending = building.get(id);
  if (pending) return pending;
  const p = buildIndex(clusterId, bucket)
    .then((idx) => {
      indexes.set(id, idx);
      return idx;
    })
    .finally(() => building.delete(id));
  building.set(id, p);
  return p;
}

function fail(res: Response, err: unknown, msg: string) {
  if (err instanceof BucketAccessError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error({ err }, msg);
  res.status(502).json({ error: msg });
}

function ids(req: Request) {
  return { clusterId: getParam(req.params, 'clusterId'), bucket: getParam(req.params, 'bucket') };
}

router.get('/buckets/:bucket/search', async (req, res) => {
  const { clusterId, bucket } = ids(req);
  const q = String(req.query.q ?? '')
    .trim()
    .toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 1000);
  try {
    const idx = await getIndex(clusterId, bucket);
    const terms = q.split(/\s+/).filter(Boolean);
    const results: IndexedObject[] = [];
    let total = 0;
    for (const it of idx.items) {
      const k = it.key.toLowerCase();
      if (terms.every((t) => k.includes(t))) {
        total++;
        if (results.length < limit) results.push(it);
      }
    }
    res.json({
      results,
      total,
      indexed: idx.items.length,
      indexBuiltAt: new Date(idx.builtAt).toISOString(),
      indexTookMs: idx.tookMs,
    });
  } catch (err) {
    fail(res, err, 'Falha na busca');
  }
});

router.get('/buckets/:bucket/usage', async (req, res) => {
  const { clusterId, bucket } = ids(req);
  const prefix = String(req.query.prefix ?? '');
  try {
    const idx = await getIndex(clusterId, bucket);
    const folders = new Map<string, { objects: number; bytes: number; last: number }>();
    let objects = 0;
    let bytes = 0;
    for (const it of idx.items) {
      if (!it.key.startsWith(prefix)) continue;
      objects++;
      bytes += it.size;
      const rest = it.key.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash >= 0 ? rest.slice(0, slash + 1) : '(arquivos soltos)';
      const f = folders.get(name) ?? { objects: 0, bytes: 0, last: 0 };
      f.objects++;
      f.bytes += it.size;
      f.last = Math.max(f.last, it.mtime);
      folders.set(name, f);
    }
    res.json({
      prefix,
      objects,
      bytes,
      folders: [...folders.entries()]
        .map(([name, f]) => ({ name, ...f, last: f.last ? new Date(f.last).toISOString() : null }))
        .sort((a, b) => b.bytes - a.bytes),
      indexBuiltAt: new Date(idx.builtAt).toISOString(),
    });
  } catch (err) {
    fail(res, err, 'Falha ao calcular o uso');
  }
});

const LinkSchema = z.object({
  key: z.string().min(1),
  expiresIn: z
    .number()
    .int()
    .min(60)
    .max(7 * 86400),
  download: z.boolean().optional(),
});

router.post('/buckets/:bucket/link', async (req, res) => {
  const { clusterId, bucket } = ids(req);
  const parsed = LinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Pedido inválido' });
    return;
  }
  const body = parsed.data;
  try {
    const { client, keyName } = await clientFor(clusterId, bucket);
    const filename = body.key.split('/').pop() ?? 'arquivo';
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: body.key,
      ResponseContentDisposition: body.download
        ? `attachment; filename="${filename.replace(/"/g, '')}"`
        : undefined,
    });
    const url = await getSignedUrl(client, cmd, { expiresIn: body.expiresIn });
    res.json({
      url,
      signedWith: keyName,
      expiresAt: new Date(Date.now() + body.expiresIn * 1000).toISOString(),
    });
  } catch (err) {
    fail(res, err, 'Falha ao gerar o link');
  }
});

router.post('/buckets/:bucket/reindex', (req, res) => {
  const { clusterId, bucket } = ids(req);
  indexes.delete(`${clusterId}/${bucket}`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Downloads report (Caddy JSON access log mounted read-only at ACCESS_LOG_DIR)
// ---------------------------------------------------------------------------

function dayOf(tsSec: number): string {
  return new Date((tsSec + TZ_OFFSET_HOURS * 3600) * 1000).toISOString().slice(0, 10);
}

router.get('/downloads', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 1), 90);
  const cutoff = Date.now() / 1000 - days * 86400;
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(ACCESS_LOG_DIR)
      .filter((f) => f.startsWith(ACCESS_LOG_PREFIX) && !f.endsWith('.gz'))
      .map((f) => path.join(ACCESS_LOG_DIR, f));
  } catch {
    res.status(503).json({ error: 'Log de acesso não disponível no painel' });
    return;
  }

  const perDay = new Map<string, { downloads: number; bytes: number }>();
  const perFile = new Map<string, { count: number; bytes: number }>();
  const perBucket = new Map<string, number>();
  const recent: { ts: number; bucket: string; key: string; ip: string; bytes: number; status: number }[] = [];
  let total = 0;
  let bytes = 0;

  for (const file of files) {
    try {
      if (fs.statSync(file).mtimeMs / 1000 < cutoff) continue;
    } catch {
      continue;
    }
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('X-Amz-Signature')) continue;
      let e: {
        ts?: number;
        status?: number;
        size?: number;
        request?: { method?: string; uri?: string; client_ip?: string; remote_ip?: string };
      };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const r = e.request ?? {};
      if (r.method !== 'GET' || (e.status !== 200 && e.status !== 206) || (e.ts ?? 0) < cutoff) continue;
      const pathPart = (r.uri ?? '').split('?')[0] ?? '';
      const m = /^\/([^/]+)\/(.+)$/.exec(pathPart);
      if (!m) continue;
      const bucket = m[1]!;
      let key = m[2]!;
      try {
        key = decodeURIComponent(key);
      } catch {
        /* keep raw */
      }
      // Count a download once: full 200, or the first range chunk of a 206.
      const ts = e.ts ?? 0;
      const size = e.size ?? 0;
      bytes += size;
      const d = dayOf(ts);
      const pd = perDay.get(d) ?? { downloads: 0, bytes: 0 };
      pd.bytes += size;
      const pf = perFile.get(`${bucket}/${key}`) ?? { count: 0, bytes: 0 };
      pf.bytes += size;
      if (e.status === 200 || /bytes=0-/.test(line)) {
        total++;
        pd.downloads++;
        pf.count++;
        perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + 1);
        recent.push({ ts, bucket, key, ip: r.client_ip ?? r.remote_ip ?? '', bytes: size, status: e.status ?? 0 });
      }
      perDay.set(d, pd);
      perFile.set(`${bucket}/${key}`, pf);
    }
  }

  const series: { day: string; downloads: number; bytes: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(Date.now() / 1000 - i * 86400);
    const v = perDay.get(d) ?? { downloads: 0, bytes: 0 };
    series.push({ day: d, ...v });
  }
  recent.sort((a, b) => b.ts - a.ts);
  res.json({
    days,
    total,
    bytes,
    series,
    perBucket: [...perBucket.entries()].map(([bucket, count]) => ({ bucket, count })),
    top: [...perFile.entries()]
      .filter(([, v]) => v.count > 0)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25)
      .map(([file, v]) => ({ file, ...v })),
    recent: recent.slice(0, 50).map((x) => ({ ...x, ts: new Date(x.ts * 1000).toISOString() })),
  });
});

export default router;
