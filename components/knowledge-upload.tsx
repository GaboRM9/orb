"use client";
import { useRef, useState, useTransition } from "react";
import { importGithubDocs, uploadKnowledge } from "@/lib/actions";

// same extensions the server accepts; filtering here keeps a picked repo's node_modules/.git/images from being uploaded
const TEXT = /\.(md|mdx|txt|rst|csv|json|ya?ml|html?)$/i;
const skip = (path: string) => !TEXT.test(path) || path.split("/").some((p) => p === "node_modules" || p.startsWith("."));

/** Picks files or a whole folder (structure kept) and posts them with their relative paths. */
export function KnowledgeUpload() {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const send = () => {
    const el = form.current!;
    const data = new FormData();
    data.set("folder", (el.elements.namedItem("folder") as HTMLInputElement).value);
    for (const input of el.querySelectorAll<HTMLInputElement>("input[type=file]"))
      for (const f of input.files ?? []) {
        const path = f.webkitRelativePath || f.name;
        if (skip(path)) continue;
        data.append("files", f);
        data.append("paths", path);
      }
    if (!data.has("files")) return setMsg("No supported files picked (md, txt, csv, json, yaml, html)");
    start(async () => {
      setMsg((await uploadKnowledge(data)).text);
      el.reset();
    });
  };
  return (
    <form ref={form} onSubmit={(e) => (e.preventDefault(), send())} className="space-y-2 card">
      <div className="text-sm font-medium">Add documents</div>
      <input className="field font-mono" name="folder" placeholder="Into folder (optional), e.g. handbook" />
      <div className="grid gap-2 text-xs text-mute sm:grid-cols-2">
        <label className="space-y-1">Files (md, txt, csv, json, html…)<input type="file" multiple className="field" /></label>
        <label className="space-y-1">…or a whole folder<input type="file" className="field" {...{ webkitdirectory: "" }} /></label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-solid" disabled={busy}>{busy ? "Importing…" : "Add"}</button>
        {msg && <span className="text-xs text-mute">{msg}</span>}
      </div>
    </form>
  );
}

export function GithubImport() {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        start(async () => setMsg((await importGithubDocs(data)).text));
      }}
      className="space-y-3">
      <input className="field font-mono" name="repo" placeholder="owner/repo" required aria-label="Repository" />
      <input className="field font-mono" name="dir" placeholder="Folder in the repo (optional), e.g. docs" aria-label="Folder" />
      <p className="text-xs text-mute">Private repos need a token: connect GitHub in Settings.</p>
      <div className="flex items-center gap-3">
        <button className="btn-solid" disabled={busy}>{busy ? "Importing…" : "Import"}</button>
        {msg && <span className="text-xs text-mute">{msg}</span>}
      </div>
    </form>
  );
}
