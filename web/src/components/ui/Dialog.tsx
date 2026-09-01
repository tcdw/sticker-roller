import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { const d=ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]); return <dialog ref={ref} className="ui-dialog" onCancel={onClose}><div className="dialog-head"><h2>{title}</h2><Button variant="ghost" onClick={onClose} aria-label="关闭">×</Button></div>{children}</dialog>; }
