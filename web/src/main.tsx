import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ImagePlus,
  Library,
  RefreshCw,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { selectionsEqual } from '../../src/image-providers';
import type { AssetRow, FileRow, UploadSummary } from '../../src/web-types';
import {
  api,
  applyCount,
  draftFromJob,
  HISTORY_PAGE_SIZE,
  isActive,
  type JobSummary,
  type Options,
  pageCount,
  type ReusedDraft,
  referencedIdsFromPrompt,
  referencedImageIdsFromPrompt,
  unreferencedUploads,
  useDraft,
} from './api';
import { MaterialsSidebar, PromptComposer } from './components/Composer';
import { ProviderOptionsFields } from './components/ProviderOptionsFields';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card';
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
import { Separator } from './components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './components/ui/sheet';
import { Skeleton } from './components/ui/skeleton';
import { Textarea } from './components/ui/textarea';
import { TooltipProvider } from './components/ui/tooltip';
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
  const uploads = useQuery({ queryKey: ['uploads'], queryFn: api.uploads });
  // 1-based history page; declared before the query that keys on it.
  const [historyPage, setHistoryPage] = useState(1);
  const jobs = useQuery({
    queryKey: ['jobs', historyPage],
    queryFn: () => api.jobs(historyPage),
    // Keep the current page visible while the next one loads, so paging never flashes a skeleton.
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((job) => isActive(job.status)) ? 1500 : false),
  });
  const [dialog, setDialog] = useState<'create' | AssetRow | null>(null);
  const [params, setParams] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [pendingReuse, setPendingReuse] = useState<ReusedDraft | null>(null);
  const [unreferenced, setUnreferenced] = useState<UploadSummary[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState('');
  const providerStatus = useQuery({ queryKey: ['image-providers'], queryFn: api.providers });
  const configured = providerStatus.data?.providers.find((p) => p.id === draft.options.selection.providerId);
  const insertAsset = (asset: AssetRow, closeDrawer = false) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.prompt.length;
    const end = element?.selectionEnd ?? start;
    const token = `@[${asset.name}](asset:${asset.id})`;
    const prompt = `${draft.prompt.slice(0, start) + token} ${draft.prompt.slice(end)}`;
    draft.set({ prompt, referencedAssetIds: [...new Set([...draft.referencedAssetIds, asset.id])] });
    if (closeDrawer) {
      setMaterialsOpen(false);
    }
    requestAnimationFrame(() => {
      element?.focus();
      const position = start + token.length + 1;
      element?.setSelectionRange(position, position);
    });
  };
  /** Insert one or more image reference tokens in a single draft update. */
  const insertImageTokens = (items: UploadSummary[]) => {
    if (!items.length) {
      return;
    }
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.prompt.length;
    const end = element?.selectionEnd ?? start;
    const insertion = `${items.map((item) => `![${item.name}](image:${item.id})`).join(' ')} `;
    const prompt = draft.prompt.slice(0, start) + insertion + draft.prompt.slice(end);
    draft.set({ prompt });
    requestAnimationFrame(() => {
      element?.focus();
      const position = start + insertion.length;
      element?.setSelectionRange(position, position);
    });
  };
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
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const created: UploadSummary[] = [];
      for (const file of files) {
        created.push(await api.createUpload(file));
      }
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['uploads'] });
      setNotice(`已上传 ${created.length} 张图片，点击缩略图即可插入引用`);
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const removeUpload = useMutation({
    mutationFn: (target: UploadSummary) => api.archiveUpload(target.id),
    onSuccess: (archived) => {
      qc.invalidateQueries({ queryKey: ['uploads'] });
      const prompt = draft.prompt.replace(new RegExp(`!\\[[^\\]]*\\]\\(image:${archived.id}\\)\\s?`, 'g'), '');
      draft.set({ prompt });
      setNotice('图片已移除');
    },
    onError: (error) => setNotice((error as Error).message),
  });
  /** Reuse a history job: authored prompt, generation options, and its reference images. */
  const applyReuse = (reused: ReusedDraft) => {
    draft.set({ prompt: reused.prompt, referencedAssetIds: reused.referencedAssetIds, options: reused.options });
    setPendingReuse(null);
    setNotice(
      reused.missingImageNames.length
        ? `已复用历史任务，但参考图 ${reused.missingImageNames.join('、')} 已不在图片素材中，相关引用已移除`
        : '已复用历史任务：提示词、生图配置和参考图已填回编辑器',
    );
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  /**
   * Reuse asks first while the composer is in use, so typed prompt text is never
   * discarded silently — and neither are generation settings changed by hand.
   * An untouched composer applies immediately, which is the point of one-click reuse.
   */
  const reuseJob = (job: JobSummary) => {
    let reused: ReusedDraft;
    try {
      reused = draftFromJob(job, assets.data ?? [], uploads.data ?? [], providerStatus.data?.legacyProviderId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '此任务配置无法复用');
      return;
    }
    const inUse = draft.prompt.trim().length > 0;
    const optionsDiffer =
      draft.options.count !== reused.options.count ||
      !selectionsEqual(draft.options.selection, reused.options.selection);
    if (inUse && (draft.prompt !== reused.prompt || optionsDiffer)) {
      setPendingReuse(reused);
      return;
    }
    applyReuse(reused);
  };
  const useOutputAsReference = useMutation({
    mutationFn: async ({ file, ordinal }: { file: FileRow; ordinal: number }) => {
      const response = await fetch(`/api/output/${encodeURIComponent(file.fileName)}`);
      if (!response.ok) {
        throw new Error(`读取生成结果失败（${response.status}）`);
      }
      const blob = await response.blob();
      return api.createUpload(
        new File([blob], `结果图${ordinal}`, { type: file.mimeType || blob.type || 'image/png' }),
      );
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['uploads'] });
      insertImageTokens([created]);
      setNotice(`已把 ${created.name} 存为图片素材并插入引用`);
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const submit = useMutation({
    mutationFn: () =>
      api.createJob({
        authoredPrompt: draft.prompt,
        referencedAssetIds: referencedIdsFromPrompt(draft.prompt, assets.data ?? []),
        referencedImageIds: referencedImageIdsFromPrompt(draft.prompt, uploads.data ?? []),
        ...draft.options,
      }),
    onSuccess: () => {
      // A new job is always the newest row, so it lives on page 1.
      setHistoryPage(1);
      qc.invalidateQueries({ queryKey: ['jobs'] });
      draft.clearPrompt();
      setNotice('任务已提交；提示词已清空，模型、比例、分辨率和图片素材保持不变');
    },
    onError: (error) => setNotice((error as Error).message),
  });
  /** Warn before submitting a job that would silently ignore uploaded images. */
  const requestSubmit = () => {
    const pending = unreferencedUploads(draft.prompt, uploads.data ?? []);
    if (pending.length) {
      setUnreferenced(pending);
      return;
    }
    submit.mutate();
  };
  const loading = assets.isLoading || jobs.isLoading || uploads.isLoading;
  const loadError = assets.error || jobs.error;
  const refresh = () => {
    assets.refetch();
    jobs.refetch();
    uploads.refetch();
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

      <main className="mx-auto grid max-w-screen-2xl gap-6 p-4 sm:p-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <MaterialsSidebar
            assets={assets.data ?? []}
            loading={assets.isLoading}
            onCreate={() => setDialog('create')}
            onEdit={(asset) => setDialog(asset)}
            onSelect={insertAsset}
            className="sticky top-20 h-[calc(100vh-6.5rem)] min-w-0"
          />
        </aside>

        <section className="min-w-0 space-y-6" aria-label="任务画布">
          <div className="lg:hidden">
            <Sheet open={materialsOpen} onOpenChange={setMaterialsOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" className="w-full sm:w-auto">
                  <Library />
                  我的素材
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(24rem,90vw)] p-0">
                <SheetTitle className="sr-only">我的素材</SheetTitle>
                <SheetDescription className="sr-only">从素材库选择素材并插入当前任务</SheetDescription>
                <MaterialsSidebar
                  assets={assets.data ?? []}
                  loading={assets.isLoading}
                  onCreate={() => {
                    setMaterialsOpen(false);
                    setDialog('create');
                  }}
                  onEdit={(asset) => {
                    setMaterialsOpen(false);
                    setDialog(asset);
                  }}
                  onSelect={(asset) => insertAsset(asset, true)}
                  className="h-full rounded-none border-0 shadow-none"
                />
              </SheetContent>
            </Sheet>
          </div>

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

          <PromptComposer
            assets={assets.data ?? []}
            loading={assets.isLoading}
            uploads={uploads.data ?? []}
            onSelectUpload={(uploadItem) => insertImageTokens([uploadItem])}
            onRemoveUpload={(uploadItem) => removeUpload.mutate(uploadItem)}
            textareaRef={textareaRef}
          />

          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <ProviderOptionsFields
                options={draft.options}
                onChange={(options) => {
                  setParams(false);
                  draft.set({ options });
                }}
                onNotice={setNotice}
              />
              {!configured?.configured && (
                <p className="text-sm text-muted-foreground">
                  渠道尚未配置：{configured?.missingEnv.join('、') ?? '正在读取本地配置状态'}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                配置状态仅表示本地变量齐备；旧任务复用按当前配置解析渠道，并非历史调用渠道。
              </p>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                aria-label="选择要上传的图片"
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = '';
                  if (files.length) {
                    upload.mutate(files);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={upload.isPending}
                onClick={() => uploadInputRef.current?.click()}
              >
                <ImagePlus />
                {upload.isPending ? '上传中…' : '添加图片'}
              </Button>
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setParams(true)}>
                <Settings2 />
                更多参数
              </Button>
              <Button
                type="button"
                className="w-full sm:ml-auto sm:w-auto"
                disabled={submit.isPending || !draft.prompt.trim() || !configured?.configured}
                onClick={requestSubmit}
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
          <History
            jobs={jobs.data?.items ?? []}
            total={jobs.data?.total ?? 0}
            page={historyPage}
            loading={jobs.isLoading}
            refreshing={jobs.isPlaceholderData}
            onPageChange={setHistoryPage}
            onReuse={reuseJob}
            onUseOutput={(file, ordinal) => useOutputAsReference.mutate({ file, ordinal })}
            outputPending={useOutputAsReference.isPending}
          />
        </section>
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
        onSave={(count) => {
          draft.set({ options: applyCount(useDraft.getState().options, count) });
          setParams(false);
        }}
      />
      <ReuseDialog
        reused={pendingReuse}
        onClose={() => setPendingReuse(null)}
        onConfirm={() => pendingReuse && applyReuse(pendingReuse)}
      />
      <UnreferencedImagesDialog
        uploads={unreferenced}
        onClose={() => setUnreferenced(null)}
        onConfirm={() => {
          setUnreferenced(null);
          submit.mutate();
        }}
      />
    </div>
  );
}

function ReuseDialog({
  reused,
  onClose,
  onConfirm,
}: {
  reused: ReusedDraft | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={reused !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>覆盖当前编辑器？</DialogTitle>
          <DialogDescription>复用会填回历史任务的提示词、生图配置和参考图，当前输入的内容会被覆盖。</DialogDescription>
        </DialogHeader>
        {reused && (
          <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs leading-5">
            {reused.prompt}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm}>
            覆盖并复用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnreferencedImagesDialog({
  uploads,
  onClose,
  onConfirm,
}: {
  uploads: UploadSummary[] | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={uploads !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>有图片素材没有被引用</DialogTitle>
          <DialogDescription>下面这些图片已加入素材，但 prompt 里没有引用，本次生成不会用到它们。</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(uploads ?? []).map((upload) => (
            <li key={upload.id}>{upload.name}</li>
          ))}
        </ul>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            返回检查
          </Button>
          <Button type="button" onClick={onConfirm}>
            仍然提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  onSave: (count: number) => void;
}) {
  const [count, setCount] = useState(options.count);
  React.useEffect(() => {
    setCount(options.count);
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
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!Number.isInteger(count) || count < 1 || count > 20}
            onClick={() => onSave(count)}
          >
            应用参数
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function History({
  jobs,
  total,
  page,
  loading,
  refreshing,
  onPageChange,
  onReuse,
  onUseOutput,
  outputPending,
}: {
  jobs: JobSummary[];
  total: number;
  page: number;
  loading: boolean;
  /** The visible page is being replaced by another one; dim it instead of emptying the list. */
  refreshing: boolean;
  onPageChange: (page: number) => void;
  onReuse: (job: JobSummary) => void;
  onUseOutput: (file: FileRow, ordinal: number) => void;
  outputPending: boolean;
}) {
  const pages = pageCount(total);
  const sectionRef = useRef<HTMLElement>(null);
  // Paging while scrolled deep into the list would otherwise leave the viewport past the results.
  // The scroll is deferred until the requested page is actually rendered: swapping in a shorter
  // list cancels an in-flight smooth scroll, which would strand the viewport at the page bottom.
  const pendingScroll = useRef<number | null>(null);
  const goToPage = (next: number) => {
    pendingScroll.current = next;
    onPageChange(next);
  };
  useEffect(() => {
    // `refreshing` covers a page that had to be fetched; the page check covers one served from cache.
    if (pendingScroll.current === null || refreshing || pendingScroll.current !== page) {
      return;
    }
    pendingScroll.current = null;
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page, refreshing]);
  return (
    <section ref={sectionRef} className="scroll-mt-20 space-y-4" aria-labelledby="history-heading">
      <div className="flex items-center justify-between">
        <div>
          <h2 id="history-heading" className="text-xl font-semibold tracking-tight">
            任务历史
          </h2>
          <p className="text-sm text-muted-foreground">任务在浏览器关闭后仍会继续执行</p>
        </div>
        <Badge variant="secondary">共 {total} 个任务</Badge>
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
      <div className={`space-y-4 ${refreshing ? 'opacity-60 transition-opacity' : ''}`}>
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onReuse={onReuse} onUseOutput={onUseOutput} outputPending={outputPending} />
        ))}
      </div>
      {(pages > 1 || page > 1) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            第 {Math.min(page, pages)} / {pages} 页 · 每页 {HISTORY_PAGE_SIZE} 条
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              <ChevronLeft />
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => goToPage(page + 1)}
            >
              下一页
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
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

/** Two lines of `leading-6` text: the height a collapsed history prompt occupies. */
const COLLAPSED_PROMPT_HEIGHT = 48;

/**
 * A history prompt is frequently a long wall of text that pushes the generated images out of
 * view, so it starts collapsed to two lines and expands on demand.
 */
function JobPrompt({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }
    // The paragraph is never clamped, so its height is always the full text height. The observer
    // therefore covers every case that can change whether the prompt overflows — different text
    // and a narrower card — without listing `prompt` as a dependency.
    const measure = () => setOverflowing(element.offsetHeight > COLLAPSED_PROMPT_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="space-y-1">
      <div className={overflowing && !expanded ? 'max-h-12 overflow-hidden' : undefined}>
        <p ref={textRef} className="whitespace-pre-wrap text-sm leading-6">
          {prompt}
        </p>
      </div>
      {overflowing && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-3 text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
          {expanded ? '收起提示词' : '展开提示词全文'}
        </Button>
      )}
    </div>
  );
}

function JobCard({
  job,
  onReuse,
  onUseOutput,
  outputPending,
}: {
  job: JobSummary;
  onReuse: (job: JobSummary) => void;
  onUseOutput: (file: FileRow, ordinal: number) => void;
  outputPending: boolean;
}) {
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
          <div className="flex items-center gap-2">
            <Badge variant={badgeVariant}>{statusLabels[job.status] ?? job.status}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => onReuse(job)}>
              <RotateCcw />
              复用
            </Button>
          </div>
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
        <JobPrompt prompt={job.promptSnapshot} />
        <Separator />
        {detail.isLoading && <Skeleton className="h-36 w-full" />}
        {/* Fixed columns keep thumbnails the same size for every job: a 4-image job
            leaves two cells empty instead of stretching four across the row. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
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
                    <CardFooter className="flex flex-col gap-2 p-2">
                      <Button type="button" variant="ghost" size="sm" className="w-full" asChild>
                        <a href={source} download={file.fileName}>
                          <Download />
                          下载
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        disabled={outputPending}
                        onClick={() => onUseOutput(file, item.ordinal)}
                      >
                        <ImagePlus />
                        用作参考图
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
