import { useRef } from "react";
import { useDraft } from "../api";
import type { AssetRow } from "../../../src/web-types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { ScrollArea } from "./ui/ScrollArea";
import { Textarea } from "./ui/Textarea";

export function Composer({ assets, onCreate }: { assets: AssetRow[]; onCreate: () => void }) {
  const draft = useDraft(); const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (asset: AssetRow) => { const el=ref.current; const start=el?.selectionStart ?? draft.prompt.length; const end=el?.selectionEnd ?? start; const token=`@${asset.name}`; const prompt=draft.prompt.slice(0,start)+token+" "+draft.prompt.slice(end); draft.set({ prompt, referencedAssetIds: [...new Set([...draft.referencedAssetIds, asset.id])] }); requestAnimationFrame(() => { el?.focus(); const pos=start+token.length+1; el?.setSelectionRange(pos,pos); }); };
  return <div className="workspace-grid"><Card className="materials"><div className="section-title"><span>我的素材</span><Button onClick={onCreate}>＋ 创建素材</Button></div><ScrollArea>{Object.entries(Object.groupBy(assets, a => a.category || "未分类")).map(([category, group]) => { const items = group ?? []; return <section key={category}><h3>{category} <Badge>{items.length}</Badge></h3>{items.map(asset => <button className="material" key={asset.id} onClick={() => insert(asset)}><strong>{asset.name}</strong><small>{asset.prompt.slice(0, 70)}</small><span>点击插入 @{asset.name}</span></button>)}</section>})}{!assets.length && <div className="empty">还没有素材，先创建一个可复用材料喵</div>}</ScrollArea></Card><Card className="task"><div className="task-heading"><div><p className="eyebrow">TASK COMPOSER</p><h2>描述你要生成的内容</h2></div><span className="muted">素材只是引用，不会替换任务文字</span></div><Textarea ref={ref} value={draft.prompt} onChange={e => draft.set({ prompt:e.target.value })} placeholder="输入任务 prompt，再点击左侧素材插入 @素材 token…" aria-label="任务 prompt" /><p className="hint">支持多次引用；删除 @素材 token 不会删除周围文字</p></Card></div>;
}
