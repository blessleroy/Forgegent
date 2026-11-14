import { redirect } from "next/navigation";

/** Entry: authenticated users land in the Hub; others sign in first. */
export default function Home() {
  redirect("/hub");
}
