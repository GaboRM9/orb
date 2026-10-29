"use client";
import { useRef } from "react";
import { XIcon } from "./icons";

/** A button that opens a native modal <dialog>; Esc, the ✕ and a click on the backdrop close it. */
export function Dialog({ label, title, className = "btn text-xs", children }: { label: React.ReactNode; title: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog
        ref={ref}
        aria-label={title}
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-bg p-0 text-fg shadow-lg backdrop:bg-black/30 backdrop:backdrop-blur-sm"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">{title}</h2>
            <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="grid h-7 w-7 place-items-center rounded-ctl text-mute hover:bg-hover hover:text-fg"><XIcon /></button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
