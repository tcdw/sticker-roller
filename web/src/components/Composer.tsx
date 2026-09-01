import { useRef } from "react";
import { useDraft, ASSET_TOKEN } from "../api";
import type { AssetRow } from "../../../src/web-types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { ScrollArea } from "./ui/ScrollArea";
import { Textarea } from "./ui/Textarea";

export function AssetReferenceToken({ asset, onRemove }: { asset: AssetRow; onRemove: () => void }) {
  return <span className="asset-token" title={`引用 ID: ${asset.id}`}>@{asset.name}<Button variant="ghost" onClick={onRemove} aria-label={`移除 ${asset.name} 引用`}>×</Button></span>;
}

export function Composer({ assets, onCreate, onEdit }: { assets: AssetRow[]; onCreate: () => void; onEdit: (asset: AssetRow) => void }) {
  const draft = useDraft(); const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (asset: AssetRow) => { const el=ref.current; const start=el?.selectionStart ?? draft.prompt.length; const end=el?.selectionEnd ?? start; const token=`@[${asset.name}](asset:${asset.id})`; const prompt=draft.prompt.slice(0,start)+token+" "+draft.prompt.slice(end); draft.set({ prompt, referencedAssetIds: [...new Set([...draft.referencedAssetIds, asset.id])] }); requestAnimationFrame(() => { el?.focus(); const pos=start+token.length+1; el?.setSelectionRange(pos,pos); }); };
  const removeToken = (asset: AssetRow) => { const prompt=draft.prompt.replace(new RegExp(`@\\[${asset.name.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")}\\]\\(asset:${asset.id}\\)\\s?`, "g"), ""); draft.set({prompt, referencedAssetIds: draft.referencedAssetIds.filter(id => id !== asset.id)}); };
  const mentioned = assets.filter(asset => draft.prompt.includes(`](asset:${asset.id})`));
  return <div className="workspace-grid"><Card className="materials"><div className="section-title"><span>我的素材</span><Button onClick={onCreate}>＋ 创建素材</Button></div><ScrollArea>{Object.entries(Object.groupBy(assets, a => a.category || "未分类")).map(([category, group]) => { const items = group ?? []; return <section key={category}><h3>{category} <Badge>{items.length}</Badge></h3>{items.map(asset => <div className="material-wrap" key={asset.id}><button className="material" onClick={() => insert(asset)}><strong>{asset.name}</strong><small>{asset.prompt.slice(0, 70)}</small><span>点击插入 @{asset.name}</span></button><Button variant="ghost" onClick={() => onEdit(asset)}>编辑</Button></div>)}</section>})}{!assets.length && <div className="empty">还没有素材，先创建一个可复用材料喵</div>}</ScrollArea></Card><Card className="task"><div className="task-heading"><div><p className="eyebrow">TASK COMPOSER</p><h2>描述你要生成的内容</h2></div><span className="muted">素材只是引用，不会替换任务文字</span></div><Textarea ref={ref} value={draft.prompt} onChange={e => draft.set({ prompt:e.target.value, referencedAssetIds: draft.referencedAssetIds.filter(id => e.target.value.includes(`](asset:${id})`)) })} placeholder="输入任务 prompt，再点击左侧素材插入 @素材 token…" aria-label="任务 prompt" /><div className="token-list" aria-label="当前素材引用">{mentioned.map(asset => <AssetReferenceToken key={asset.id} asset={asset} onRemove={() => removeToken(asset)} />)}</div><p className="hint">引用 token 带有稳定素材 ID；可直接编辑文本或点击 × 移除</p></Card></div>;
}
