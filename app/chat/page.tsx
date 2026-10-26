import { redirect } from "next/navigation";

// every conversation belongs to an agent; start one from /agents
export default function NewChat() {
  redirect("/agents");
}
