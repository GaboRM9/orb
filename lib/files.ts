import type { UIMessage } from "ai";

// Attachments the composer sends and Anthropic reads. Only inline data URLs: a hosted URL would make the server fetch it.
export const FILE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];
export const MAX_FILE_BYTES = 3_000_000; // all of one message's files; as base64 that stays under Vercel's 4.5 MB request body

/** Why an incoming message's attachments are refused, or null. The client checks the same, so this only stops crafted requests. */
export function fileError(message: UIMessage) {
  const files = message.parts.filter((p) => p.type === "file");
  for (const f of files)
    if (!FILE_TYPES.includes(f.mediaType) || !f.url.startsWith(`data:${f.mediaType};base64,`)) return `Can't attach ${f.filename ?? "this file"}: use an image, PDF or text file.`;
  // base64 is 4/3 of the bytes
  if (files.reduce((n, f) => n + f.url.length, 0) * 0.75 > MAX_FILE_BYTES) return "Attachments are limited to 3 MB per message.";
  return null;
}
