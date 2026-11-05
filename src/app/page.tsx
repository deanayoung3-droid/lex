import { redirect } from "next/navigation";

// Nothing public lives at the root: the chat is embedded on your website with /lex.js.
export default function Home() {
  redirect("/admin");
}
