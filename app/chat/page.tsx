import { generateId } from "ai";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// agent-less conversation; agent chats start from /agents/[id]
export default function NewChat() {
  redirect(`/chat/${generateId()}`);
}
