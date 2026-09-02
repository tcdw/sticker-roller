import { X } from 'lucide-react';
import { useRef } from 'react';
import type { AssetRow } from '../../../src/web-types';
import { useDraft } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Textarea } from './ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function AssetReferenceToken({ asset, onRemove }: { asset: AssetRow; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 pl-2.5 pr-1" title={`引用 ID: ${asset.id}`}>
      @{asset.name}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 rounded-full"
        onClick={onRemove}
        aria-label={`移除 ${asset.name} 引用`}
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}

export function Composer({
  assets,
  loading,
  onCreate,
  onEdit,
}: {
  assets: AssetRow[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (asset: AssetRow) => void;
}) {
  const draft = useDraft();
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (asset: AssetRow) => {
    const el = ref.current;
    const start = el?.selectionStart ?? draft.prompt.length;
    const end = el?.selectionEnd ?? start;
    const token = `@[${asset.name}](asset:${asset.id})`;
    const prompt = `${draft.prompt.slice(0, start) + token} ${draft.prompt.slice(end)}`;
    draft.set({ prompt, referencedAssetIds: [...new Set([...draft.referencedAssetIds, asset.id])] });
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + token.length + 1;
      el?.setSelectionRange(pos, pos);
    });
  };
  const removeToken = (asset: AssetRow) => {
    const prompt = draft.prompt.replace(
      new RegExp(`@\\[${asset.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\]\\(asset:${asset.id}\\)\\s?`, 'g'),
      '',
    );
    draft.set({ prompt, referencedAssetIds: draft.referencedAssetIds.filter((id) => id !== asset.id) });
  };
  const mentioned = assets.filter((asset) => draft.prompt.includes(`](asset:${asset.id})`));
  const groups = Object.entries(Object.groupBy(assets, (asset) => asset.category || '未分类'));

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="min-w-0 lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)]">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-lg">我的素材</CardTitle>
            <CardDescription>{assets.length} 项可复用文本素材</CardDescription>
          </div>
          <Button type="button" size="sm" onClick={onCreate}>
            创建素材
          </Button>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          <ScrollArea className="h-[20rem] px-4 py-3 lg:h-[calc(100vh-14rem)]">
            <div className="space-y-5">
              {groups.map(([category, group]) => {
                const items = group ?? [];
                return (
                  <section key={category} className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-sm font-medium">{category}</h3>
                      <Badge variant="secondary">{items.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {items.map((asset) => (
                        <Card key={asset.id} className="shadow-none">
                          <CardContent className="space-y-2 p-3">
                            <button
                              type="button"
                              className="w-full space-y-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => insert(asset)}
                            >
                              <p className="text-sm font-medium">@{asset.name}</p>
                              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {asset.prompt}
                              </p>
                            </button>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">点击插入引用</span>
                              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(asset)}>
                                编辑
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </section>
                );
              })}
              {!loading && !assets.length && (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  还没有素材，创建一项后即可在任务中引用。
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>描述你要生成的内容</CardTitle>
          <CardDescription>编写完整任务，点击左侧素材可在光标位置插入稳定引用。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            ref={ref}
            disabled={loading}
            className="min-h-52 resize-y text-base leading-7"
            value={draft.prompt}
            onChange={(event) =>
              draft.set({
                prompt: event.target.value,
                referencedAssetIds: draft.referencedAssetIds.filter((id) =>
                  event.target.value.includes(`](asset:${id})`),
                ),
              })
            }
            placeholder="输入任务 prompt，再从左侧插入 @素材引用…"
            aria-label="任务 prompt"
          />
          <div className="flex min-h-7 flex-wrap gap-2">
            {mentioned.map((asset) => (
              <AssetReferenceToken key={asset.id} asset={asset} onRemove={() => removeToken(asset)} />
            ))}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="w-fit text-xs text-muted-foreground">引用会在提交时解析并保存快照</p>
            </TooltipTrigger>
            <TooltipContent>编辑素材不会改变已经提交的任务。</TooltipContent>
          </Tooltip>
        </CardContent>
      </Card>
    </div>
  );
}
