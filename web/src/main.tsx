import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AssetRow, JobRow } from '../../src/web-types';
import { api, isActive, type Options, referencedIdsFromPrompt, useDraft } from './api';
import { Composer } from './components/Composer';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { Checkbox } from './components/ui/Checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/Dialog';
import { Input } from './components/ui/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/Select';
import { Textarea } from './components/ui/Textarea';
import { TooltipProvider } from './components/ui/Tooltip';
import './styles.css';

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
    refetchInterval: (q) => (q.state.data?.some((j) => isActive(j.status)) ? 1500 : false),
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
    onError: (e) => setNotice((e as Error).message),
  });
  const archive = useMutation({
    mutationFn: api.archiveAsset,
    onSuccess: () => {
      setDialog(null);
      qc.invalidateQueries({ queryKey: ['assets'] });
      setNotice('素材已归档');
    },
    onError: (e) => setNotice((e as Error).message),
  });
  const submit = useMutation({
    mutationFn: () => {
      const currentAssets = assets.data ?? [];
      return api.createJob({
        authoredPrompt: draft.prompt,
        referencedAssetIds: referencedIdsFromPrompt(draft.prompt, currentAssets),
        ...draft.options,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      draft.reset();
      setNotice('任务已提交');
    },
    onError: (e) => setNotice((e as Error).message),
  });
  const loading = assets.isLoading || jobs.isLoading;
  return (
    <div className="app">
      <header>
        <div className="brand">
          生图
          <br />
          <span>工作室</span>
        </div>
        <div>
          <p className="eyebrow">LOCAL CREATIVE WORKBENCH</p>
          <h1>把素材组合成任务</h1>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            assets.refetch();
            jobs.refetch();
          }}
        >
          ↻ 刷新
        </Button>
      </header>
      <main>
        {(assets.isError || jobs.isError) && (
          <p className="error">
            加载失败：{(assets.error || (jobs.error as Error)).message}{' '}
            <Button
              variant="secondary"
              onClick={() => {
                assets.refetch();
                jobs.refetch();
              }}
            >
              重试
            </Button>
          </p>
        )}
        <Composer
          assets={assets.data ?? []}
          onCreate={() => setDialog('create')}
          onEdit={(asset) => setDialog(asset)}
        />
        <Card className="toolbar">
          <Select
            disabled={loading}
            value={draft.options.model}
            onValueChange={(value) => draft.set({ options: { ...draft.options, model: value } })}
          >
            <SelectTrigger>
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
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1:1 / 1K">1:1 / 1K</SelectItem>
              <SelectItem value="1:1 / 2K">1:1 / 2K</SelectItem>
              <SelectItem value="16:9 / 2K">16:9 / 2K</SelectItem>
              <SelectItem value="9:16 / 2K">9:16 / 2K</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="secondary" disabled title="Phase 1 仅支持文本素材">
            添加图片（暂不可用）
          </Button>
          <Button variant="secondary" onClick={() => setParams(true)}>
            更多参数
          </Button>
          <Button disabled={submit.isPending || !draft.prompt.trim()} onClick={() => submit.mutate()}>
            {submit.isPending ? '提交中…' : '提交任务'}
          </Button>
        </Card>
        {notice && <p className="notice">{notice}</p>}
        <History jobs={jobs.data ?? []} loading={jobs.isLoading} />
      </main>
      <MaterialDialog
        value={dialog}
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
  onClose,
  onSave,
  onArchive,
}: {
  value: 'create' | AssetRow | null;
  onClose: () => void;
  onSave: (id: string | undefined, b: { name: string; prompt: string; category: string }) => void;
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
          <DialogDescription>管理独立的可复用文本素材</DialogDescription>
        </DialogHeader>
        <label htmlFor="asset-name">
          名称
          <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label htmlFor="asset-content">
          内容
          <Textarea id="asset-content" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <label htmlFor="asset-category">
          分组
          <Input id="asset-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
        <Button disabled={!name.trim() || !prompt.trim()} onClick={() => onSave(asset?.id, { name, prompt, category })}>
          保存素材
        </Button>
        {asset && (
          <Button variant="danger" onClick={() => onArchive(asset.id)}>
            归档素材
          </Button>
        )}
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
  onSave: (o: Options) => void;
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
          <DialogDescription>调整本次任务的生成参数</DialogDescription>
        </DialogHeader>
        <label htmlFor="image-count">
          生成张数
          <Input
            id="image-count"
            type="number"
            min="1"
            max="20"
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value))))}
          />
        </label>
        <div className="checkbox-label">
          <Checkbox
            id="remove-background"
            checked={removeBackground}
            onCheckedChange={(checked) => setRemoveBackground(checked === true)}
          />
          <label htmlFor="remove-background">移除背景</label>
        </div>
        <Button onClick={() => onSave({ ...options, count, removeBackground })}>应用参数</Button>
      </DialogContent>
    </Dialog>
  );
}
function History({ jobs, loading }: { jobs: JobRow[]; loading: boolean }) {
  if (loading) {
    return (
      <section className="history">
        <div className="empty">正在加载任务…</div>
      </section>
    );
  }
  if (!jobs.length) {
    return (
      <section className="history">
        <h2>任务历史</h2>
        <div className="empty">提交任务后，图片结果会显示在这里</div>
      </section>
    );
  }
  return (
    <section className="history">
      <div className="history-title">
        <h2>任务历史</h2>
        <span>{jobs.length} 个任务</span>
      </div>
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </section>
  );
}
function JobCard({ job }: { job: JobRow }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['job', job.id],
    queryFn: () => api.job(job.id),
    refetchInterval: isActive(job.status) ? 1500 : false,
  });
  const cancel = useMutation({ mutationFn: api.cancel, onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });
  const retry = useMutation({ mutationFn: api.retry, onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });
  const full = detail.data;
  return (
    <article className="job">
      <div className="history-title">
        <div>
          <strong>{new Date(job.createdAt).toLocaleString()}</strong>
          <small>（{job.requestedCount} 张）</small>
        </div>
        <Badge className={`status-${job.status}`}>{job.status}</Badge>
      </div>
      <p>{job.promptSnapshot}</p>
      <div className="results">
        {(full?.items ?? []).map((item) => (
          <div className="result" key={item.id}>
            {item.status === 'succeeded' && item.files?.[0] ? (
              <img src={`/api/output/${encodeURIComponent(item.files[0].fileName)}`} alt="生成结果" />
            ) : (
              <span>{item.status === 'failed' ? `失败：${item.error ?? '未知错误'}` : item.status}</span>
            )}
          </div>
        ))}
      </div>
      <div className="job-actions">
        {isActive(job.status) && (
          <Button variant="secondary" onClick={() => cancel.mutate(job.id)}>
            取消
          </Button>
        )}
        {job.status === 'failed' && (
          <Button variant="secondary" onClick={() => retry.mutate(job.id)}>
            重试失败项
          </Button>
        )}
      </div>
    </article>
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
