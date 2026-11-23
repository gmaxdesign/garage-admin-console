/**
 * StockDL fork — "Relatórios": busca de arquivos, link assinado, uso por pasta e downloads.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FolderTree, Link2, Loader2, RefreshCw, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ModulePageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@garage/ui';
import { api } from '@/lib/api';
import { useClusterContext } from '@/contexts/ClusterContext';
import { useBuckets } from '@/hooks/useBuckets';

interface Obj {
  key: string;
  size: number;
  mtime: number;
}

const nf = new Intl.NumberFormat('pt-BR');

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toLocaleString('pt-BR', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

function fmtDate(v: number | string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const EXPIRIES = [
  { label: '1 hora', value: 3600 },
  { label: '6 horas', value: 6 * 3600 },
  { label: '1 dia', value: 86400 },
  { label: '3 dias', value: 3 * 86400 },
  { label: '7 dias (máximo)', value: 7 * 86400 },
];

function BucketPicker({
  value,
  onChange,
  buckets,
}: {
  value: string;
  onChange: (v: string) => void;
  buckets: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Escolha o bucket" />
      </SelectTrigger>
      <SelectContent>
        {buckets.map((b) => (
          <SelectItem key={b} value={b}>
            {b}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LinkDialog({
  clusterId,
  bucket,
  objKey,
  onClose,
}: {
  clusterId: string;
  bucket: string;
  objKey: string | null;
  onClose: () => void;
}) {
  const [expiresIn, setExpiresIn] = useState(3600);
  const [download, setDownload] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(null);
    setErr(null);
  }, [objKey, expiresIn, download]);

  if (!objKey) return null;

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ url: string; expiresAt: string; signedWith: string }>(
        `/clusters/${clusterId}/insights/buckets/${encodeURIComponent(bucket)}/link`,
        { key: objKey, expiresIn, download },
      );
      setUrl(r.data.url);
      setInfo(`Expira em ${fmtDate(r.data.expiresAt)} · assinado com a chave "${r.data.signedWith}"`);
      await navigator.clipboard?.writeText(r.data.url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setErr((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Falha ao gerar o link');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerar link assinado</DialogTitle>
          <DialogDescription className="break-all">
            <code className="rounded bg-muted px-1 text-xs">
              {bucket}/{objKey}
            </code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Validade</Label>
            <div className="flex flex-wrap gap-2">
              {EXPIRIES.map((e) => (
                <Button
                  key={e.value}
                  type="button"
                  size="sm"
                  variant={expiresIn === e.value ? 'default' : 'outline'}
                  onClick={() => setExpiresIn(e.value)}
                >
                  {e.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="dl" checked={download} onCheckedChange={setDownload} />
            <Label htmlFor="dl">Forçar download (em vez de abrir no navegador)</Label>
          </div>
          {url && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <Input value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(url).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? 'Copiado!' : 'Copiar'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{info}</p>
            </div>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {url ? 'Gerar de novo e copiar' : 'Gerar e copiar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SearchTab({ clusterId, buckets }: { clusterId: string; buckets: string[] }) {
  const [bucket, setBucket] = useState('');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [linkKey, setLinkKey] = useState<string | null>(null);

  useEffect(() => {
    if (!bucket && buckets.length) setBucket(buckets.includes('designershub') ? 'designershub' : buckets[0]!);
  }, [buckets, bucket]);

  const query = useQuery({
    queryKey: ['insights-search', clusterId, bucket, q],
    enabled: Boolean(bucket),
    queryFn: async () =>
      (
        await api.get<{ results: Obj[]; total: number; indexed: number; indexBuiltAt: string }>(
          `/clusters/${clusterId}/insights/buckets/${encodeURIComponent(bucket)}/search`,
          { params: { q, limit: 300 } },
        )
      ).data,
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" /> Buscar arquivos
        </CardTitle>
        <CardDescription>
          Procure pelo nome ou parte do caminho. Vazio mostra os mais recentes. A primeira busca num bucket grande
          pode levar alguns segundos (o índice é atualizado a cada 10 min).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(input);
          }}
        >
          <BucketPicker value={bucket} onChange={setBucket} buckets={buckets} />
          <Input
            className="min-w-[240px] flex-1"
            placeholder="ex.: 12845884  ou  Designi logo"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit">
            <Search className="h-4 w-4" /> Buscar
          </Button>
          <Button
            type="button"
            variant="outline"
            title="Recarregar índice"
            onClick={async () => {
              await api.post(`/clusters/${clusterId}/insights/buckets/${encodeURIComponent(bucket)}/reindex`);
              query.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </form>
        {query.isFetching && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
          </p>
        )}
        {query.error && <p className="text-sm text-destructive">Não foi possível buscar neste bucket.</p>}
        {query.data && (
          <>
            <p className="text-sm text-muted-foreground">
              {nf.format(query.data.total)} resultado(s) em {nf.format(query.data.indexed)} arquivos · índice de{' '}
              {fmtDate(query.data.indexBuiltAt)}
              {query.data.total > query.data.results.length && ` · mostrando ${query.data.results.length}`}
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead className="text-right">Tamanho</TableHead>
                    <TableHead>Enviado em</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.results.map((o) => (
                    <TableRow key={o.key}>
                      <TableCell className="max-w-[520px] break-all font-mono text-xs">{o.key}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{fmtBytes(o.size)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(o.mtime)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setLinkKey(o.key)}>
                          <Link2 className="h-4 w-4" /> Link
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
      <LinkDialog clusterId={clusterId} bucket={bucket} objKey={linkKey} onClose={() => setLinkKey(null)} />
    </Card>
  );
}

function UsageTab({ clusterId, buckets }: { clusterId: string; buckets: string[] }) {
  const [bucket, setBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  useEffect(() => {
    if (!bucket && buckets.length) setBucket(buckets.includes('designershub') ? 'designershub' : buckets[0]!);
  }, [buckets, bucket]);

  const query = useQuery({
    queryKey: ['insights-usage', clusterId, bucket, prefix],
    enabled: Boolean(bucket),
    queryFn: async () =>
      (
        await api.get<{
          objects: number;
          bytes: number;
          folders: { name: string; objects: number; bytes: number; last: string | null }[];
          indexBuiltAt: string;
        }>(`/clusters/${clusterId}/insights/buckets/${encodeURIComponent(bucket)}/usage`, { params: { prefix } })
      ).data,
    staleTime: 60_000,
  });
  const max = Math.max(1, ...(query.data?.folders.map((f) => f.bytes) ?? [1]));
  const crumbs = prefix.split('/').filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderTree className="h-5 w-5" /> Uso de espaço por pasta
        </CardTitle>
        <CardDescription>Clique numa pasta para ver as subpastas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <BucketPicker
            value={bucket}
            onChange={(v) => {
              setBucket(v);
              setPrefix('');
            }}
            buckets={buckets}
          />
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <button className="underline-offset-2 hover:underline" onClick={() => setPrefix('')}>
              {bucket || 'bucket'}
            </button>
            {crumbs.map((c, i) => (
              <span key={i}>
                {' / '}
                <button
                  className="underline-offset-2 hover:underline"
                  onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>
        </div>
        {query.isFetching && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
          </p>
        )}
        {query.data && (
          <>
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary">{nf.format(query.data.objects)} arquivos</Badge>
              <Badge variant="secondary">{fmtBytes(query.data.bytes)}</Badge>
              <Badge variant="outline">índice de {fmtDate(query.data.indexBuiltAt)}</Badge>
            </div>
            <div className="space-y-2">
              {query.data.folders.map((f) => (
                <button
                  key={f.name}
                  disabled={!f.name.endsWith('/')}
                  onClick={() => setPrefix(prefix + f.name)}
                  className="block w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-default"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="break-all font-medium">{f.name}</span>
                    <span className="whitespace-nowrap text-muted-foreground">
                      {fmtBytes(f.bytes)} · {nf.format(f.objects)} arq. · último {fmtDate(f.last)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded bg-muted">
                    <div className="h-2 rounded bg-primary" style={{ width: `${(f.bytes / max) * 100}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface DownloadsData {
  days: number;
  total: number;
  bytes: number;
  series: { day: string; downloads: number; bytes: number }[];
  perBucket: { bucket: string; count: number }[];
  top: { file: string; count: number; bytes: number }[];
  recent: { ts: string; bucket: string; key: string; ip: string; bytes: number; status: number }[];
}

function DownloadsTab({ clusterId }: { clusterId: string }) {
  const [days, setDays] = useState(30);
  const query = useQuery({
    queryKey: ['insights-downloads', clusterId, days],
    queryFn: async () =>
      (await api.get<DownloadsData>(`/clusters/${clusterId}/insights/downloads`, { params: { days } })).data,
    staleTime: 60_000,
  });
  const maxDay = useMemo(() => Math.max(1, ...(query.data?.series.map((s) => s.downloads) ?? [1])), [query.data]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" /> Downloads por link assinado
          </CardTitle>
          <CardDescription>Contados a partir do log do servidor (só links assinados, ou seja, clientes).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>
                {d} dias
              </Button>
            ))}
          </div>
          {query.isFetching && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo o log…
            </p>
          )}
          {query.error && <p className="text-sm text-destructive">Log de acesso indisponível.</p>}
          {query.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Downloads</div>
                  <div className="text-2xl font-semibold">{nf.format(query.data.total)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Tráfego enviado</div>
                  <div className="text-2xl font-semibold">{fmtBytes(query.data.bytes)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Por bucket</div>
                  <div className="text-sm">
                    {query.data.perBucket.map((b) => `${b.bucket}: ${nf.format(b.count)}`).join(' · ') || '—'}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Downloads por dia</div>
                <div className="flex h-32 items-end gap-[2px]">
                  {query.data.series.map((s) => (
                    <div
                      key={s.day}
                      className="flex-1 rounded-t bg-primary/80"
                      style={{ height: `${(s.downloads / maxDay) * 100}%`, minHeight: s.downloads ? 2 : 0 }}
                      title={`${s.day.split('-').reverse().join('/')}: ${s.downloads} downloads · ${fmtBytes(s.bytes)}`}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{query.data.series[0]?.day.split('-').reverse().join('/')}</span>
                  <span>hoje</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {query.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mais baixados</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead className="text-right">Vezes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.top.map((t) => (
                    <TableRow key={t.file}>
                      <TableCell className="break-all font-mono text-xs">{t.file}</TableCell>
                      <TableCell className="text-right">{nf.format(t.count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Últimos downloads</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.recent.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.ts)}</TableCell>
                      <TableCell className="break-all font-mono text-xs">
                        {r.bucket}/{r.key}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.ip}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { clusterId } = useClusterContext();
  const { data } = useBuckets(clusterId);
  const buckets = useMemo(
    () =>
      (data ?? [])
        .map((b) => b.globalAliases.find((a) => !a.includes('.')) ?? b.globalAliases[0])
        .filter((x): x is string => Boolean(x))
        .sort(),
    [data],
  );

  return (
    <div className="space-y-6">
      <ModulePageHeader
        title="Relatórios"
        description="Busca de arquivos, links assinados, uso de espaço e downloads."
      />
      <Tabs defaultValue="busca">
        <TabsList>
          <TabsTrigger value="busca">Buscar e gerar link</TabsTrigger>
          <TabsTrigger value="uso">Uso por pasta</TabsTrigger>
          <TabsTrigger value="downloads">Downloads</TabsTrigger>
        </TabsList>
        <TabsContent value="busca" className="mt-4">
          <SearchTab clusterId={clusterId} buckets={buckets} />
        </TabsContent>
        <TabsContent value="uso" className="mt-4">
          <UsageTab clusterId={clusterId} buckets={buckets} />
        </TabsContent>
        <TabsContent value="downloads" className="mt-4">
          <DownloadsTab clusterId={clusterId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
