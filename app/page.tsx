import { generateId } from "ai";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic"; // every visit is a new chat

export default function Home() {
  redirect(`/chat/${generateId()}`);
}
