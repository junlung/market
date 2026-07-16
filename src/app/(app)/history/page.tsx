import { redirect } from "next/navigation";

// bet history lives on the portfolio page; this route survives for old links
export default function HistoryPage() {
  redirect("/portfolio?tab=history");
}
