// While any page opens: the app's loader, inside the layout (the sidebar stays).
import { Loader } from "@/components/ui/loader";

export default function Loading() {
  return <Loader title="Opening…" detail="Getting the page ready" className="px-4 py-24" />;
}
