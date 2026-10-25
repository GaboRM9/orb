import { redirect } from "next/navigation";

// conversations live at /chat/[id] and always belong to an agent
export default function Chats() {
  redirect("/agents");
}
