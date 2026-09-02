import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { Download, ImagePlus, RefreshCw, Settings2 } from 'lucide-react';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AssetRow, JobRow } from '../../src/web-types';
import { api, isActive, type Options, referencedIdsFromPrompt, useDraft } from './api';
import { Composer } from './components/Composer';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card';
import { Checkbox } from './components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Progress } from './components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Skeleton } from './components/ui/skeleton';
import { Textarea } from './components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import './globals.css';

const client = new QueryClient();
const rootRoute = createRootRoute({ component: () => <Outlet /> });
const workspaceRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Workspace });
const router = createRouter({ routeTree: rootRoute.addChildren([workspaceRoute]) });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function Workspace() {
  const qc = useQueryClient();
  const draft = useDraft();
  const assets = useQuery({ queryKey: ['assets'], queryFn: api.assets });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs,
    refetchInterval: (query) => (query.state.data?.some((job) => isActive(job.status)) ? 1500 : false),
  });
  const [dialog, setDialog] = useState<'create' | AssetRow | null>(null);
  const [params, setParams] = useState(false);
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { name: string; prompt: string; category: string } }) =>
      id ? api.updateAsset(id, body) : api.createAsset(body),
    onSuccess: () => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ['assets'] });
      setNotice('素材已保存');
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const archive = useMutation({
    mutationFn: api.archiveAsset,
    onSuccess: () => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ['assets'] });
      setNotice('素材已归档');
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const submit = useMutation({
    mutationFn: () =>
      api.createJob({
        authoredPrompt: draft.prompt,
        referencedAssetIds: referencedIdsFromPrompt(draft.prompt, assets.data ?? []),
        ...draft.options,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      draft.reset();
      setNotice('任务已提交');
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const loading = assets.isLoading || jobs.isLoading;
  const loadError = assets.error || jobs.error;
  const refresh = () => {
    assets.refetch();
    jobs.refetch();
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">生图工作室</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">组合素材引用，创建持久化生图任务</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-6 p-4 sm:p-6">
        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{(loadError as Error).message}</span>
              <Button type="button" variant="outline" size="sm" onClick={refresh}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Composer
          assets={assets.data ?? []}
          loading={assets.isLoading}
          onCreate={() => setDialog('create')}
          onEdit={(asset) => setDialog(asset)}
        />

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Select
              disabled={loading}
              value={draft.options.model}
              onValueChange={(model) => draft.set({ options: { ...draft.options, model } })}
            >
              <SelectTrigger className="w-full sm:w-60" aria-label="生成模型">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-3-pro-image">gemini-3-pro-image</SelectItem>
                <SelectItem value="gemini-3.1-flash-image-preview">gemini-3.1-flash-image-preview</SelectItem>
              </SelectContent>
            </Select>
            <Select
              disabled={loading}
              value={`${draft.options.aspectRatio} / ${draft.options.imageSize}`}
              onValueChange={(value) => {
                const [aspectRatio, imageSize] = value.split(' / ');
                if (aspectRatio && imageSize) {
                  draft.set({ options: { ...draft.options, aspectRatio, imageSize } });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="图片比例和尺寸">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1:1 / 1K">1:1 / 1K</SelectItem>
                <SelectItem value="1:1 / 2K">1:1 / 2K</SelectItem>
                <SelectItem value="16:9 / 2K">16:9 / 2K</SelectItem>
                <SelectItem value="9:16 / 2K">9:16 / 2K</SelectItem>
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="w-full sm:w-auto">
                  <Button type="button" variant="outline" className="w-full" disabled>
                    <ImagePlus />
                    添加图片
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Phase 1 仅支持文本素材</TooltipContent>
            </Tooltip>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setParams(true)}>
              <Settings2 />
              更多参数
            </Button>
            <Button
              type="button"
              className="w-full sm:ml-auto sm:w-auto"
              disabled={submit.isPending || !draft.prompt.trim()}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? '提交中…' : `提交任务 · ${draft.options.count} 张`}
            </Button>
          </CardContent>
        </Card>

        {notice && (
          <Alert>
            <AlertTitle>操作结果</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        <History jobs={jobs.data ?? []} loading={jobs.isLoading} />
      </main>

      <MaterialDialog
        value={dialog}
        pending={save.isPending || archive.isPending}
        onClose={() => setDialog(null)}
        onSave={(id, body) => save.mutate({ id, body })}
        onArchive={(id) => archive.mutate(id)}
      />
      <ParametersDialog
        open={params}
        options={draft.options}
        onClose={() => setParams(false)}
        onSave={(options) => {
          draft.set({ options });
          setParams(false);
        }}
      />
    </div>
  );
}

function MaterialDialog({
  value,
  pending,
  onClose,
  onSave,
  onArchive,
}: {
  value: 'create' | AssetRow | null;
  pending: boolean;
  onClose: () => void;
  onSave: (id: string | undefined, body: { name: string; prompt: string; category: string }) => void;
  onArchive: (id: string) => void;
}) {
  const asset = value !== 'create' ? value : null;
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState('提示词');
  React.useEffect(() => {
    setName(asset?.name ?? '');
    setPrompt(asset?.prompt ?? '');
    setCategory(asset?.category ?? '提示词');
  }, [asset?.prompt, asset?.name, asset?.category]);

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asset ? '编辑素材' : '创建可复用素材'}</DialogTitle>
          <DialogDescription>素材是独立文本材料，可插入多个任务重复使用。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <label className="grid gap-2 text-sm font-medium" htmlFor="asset-name">
            名称
            <Input id="asset-name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="asset-content">
            内容
            <Textarea
              id="asset-content"
              className="min-h-32"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="asset-category">
            分组
            <Input id="asset-category" value={category} onChange={(event) => setCategory(event.target.value)} />
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          {asset && (
            <Button type="button" variant="destructive" disabled={pending} onClick={() => onArchive(asset.id)}>
              归档素材
            </Button>
          )}
          <Button
            type="button"
            disabled={pending || !name.trim() || !prompt.trim() || !category.trim()}
            onClick={() => onSave(asset?.id, { name, prompt, category })}
          >
            {pending ? '保存中…' : '保存素材'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParametersDialog({
  open,
  options,
  onClose,
  onSave,
}: {
  open: boolean;
  options: Options;
  onClose: () => void;
  onSave: (options: Options) => void;
}) {
  const [count, setCount] = useState(options.count);
  const [removeBackground, setRemoveBackground] = useState(options.removeBackground);
  React.useEffect(() => {
    setCount(options.count);
    setRemoveBackground(options.removeBackground);
  }, [options]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>更多参数</DialogTitle>
          <DialogDescription>调整本次任务的生成数量和后处理。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <label className="grid gap-2 text-sm font-medium" htmlFor="image-count">
            生成张数
            <Input
              id="image-count"
              type="number"
              min="1"
              max="20"
              value={count}
              onChange={(event) => setCount(Math.max(1, Math.min(20, Number(event.target.value))))}
            />
          </label>
          <div className="flex items-center gap-3">
            <Checkbox
              id="remove-background"
              checked={removeBackground}
              onCheckedChange={(checked) => setRemoveBackground(checked === true)}
            />
            <label className="text-sm font-medium" htmlFor="remove-background">
              移除背景
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={() => onSave({ ...options, count, removeBackground })}>
            应用参数
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function History({ jobs, loading }: { jobs: JobRow[]; loading: boolean }) {
  return (
    <section className="space-y-4" aria-labelledby="history-heading">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="history-heading" className="text-xl font-semibold tracking-tight">
            任务历史
          </h2>
          <p className="text-sm text-muted-foreground">任务在浏览器关闭后仍会继续执行</p>
        </div>
        <Badge variant="secondary">{jobs.length} 个任务</Badge>
      </div>
      {loading && (
        <div className="grid gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {!loading && !jobs.length && (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            提交任务后，进度和图片结果会显示在这里。
          </CardContent>
        </Card>
      )}
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </section>
  );
}

const statusLabels: Record<string, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function JobCard({ job }: { job: JobRow }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['job', job.id],
    queryFn: () => api.job(job.id),
    refetchInterval: isActive(job.status) ? 1500 : false,
  });
  const cancel = useMutation({ mutationFn: api.cancel, onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });
  const retry = useMutation({ mutationFn: api.retry, onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });
  const items = detail.data?.items ?? [];
  const completed = items.filter((item) => !isActive(item.status)).length;
  const progress = job.requestedCount ? (completed / job.requestedCount) * 100 : 0;
  const badgeVariant = job.status === 'failed' ? 'destructive' : job.status === 'succeeded' ? 'default' : 'secondary';

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{new Date(job.createdAt).toLocaleString()}</CardTitle>
            <CardDescription>{job.requestedCount} 张图片</CardDescription>
          </div>
          <Badge variant={badgeVariant}>{statusLabels[job.status] ?? job.status}</Badge>
        </div>
        {isActive(job.status) && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>任务进度</span>
              <span>
                {completed} / {job.requestedCount}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-6">{job.promptSnapshot}</p>
        <Separator />
        {detail.isLoading && <Skeleton className="h-36 w-full" />}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {items.map((item) => {
            const file = item.files?.[0];
            const source = file ? `/api/output/${encodeURIComponent(file.fileName)}` : '';
            return (
              <Card key={item.id} className="overflow-hidden shadow-none">
                {item.status === 'succeeded' && file ? (
                  <>
                    <a href={source} target="_blank" rel="noreferrer" aria-label="预览生成结果">
                      <img className="aspect-square w-full object-cover" src={source} alt="生成结果" />
                    </a>
                    <CardFooter className="p-2">
                      <Button type="button" variant="ghost" size="sm" className="w-full" asChild>
                        <a href={source} download={file.fileName}>
                          <Download />
                          下载
                        </a>
                      </Button>
                    </CardFooter>
                  </>
                ) : (
                  <CardContent className="flex aspect-square items-center justify-center p-4 text-center text-sm text-muted-foreground">
                    {item.status === 'failed'
                      ? `失败：${item.error ?? '未知错误'}`
                      : (statusLabels[item.status] ?? item.status)}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </CardContent>
      {(isActive(job.status) || job.status === 'failed') && (
        <CardFooter className="justify-end gap-2">
          {isActive(job.status) && (
            <Button type="button" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)}>
              {cancel.isPending ? '取消中…' : '取消任务'}
            </Button>
          )}
          {job.status === 'failed' && (
            <Button type="button" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>
              {retry.isPending ? '重试中…' : '重试失败项'}
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

function App() {
  return (
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TooltipProvider>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element');
}
createRoot(root).render(<App />);
