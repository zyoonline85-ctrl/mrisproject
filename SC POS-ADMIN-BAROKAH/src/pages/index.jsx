import { Navigate } from "react-router-dom";
import { getFirstAccessiblePath } from "@/lib/permissions";
import { useAppStore } from "@/store/appStore";

export default function IndexRoute() {
  const session = useAppStore((state) => state.session);
  return <Navigate to={getFirstAccessiblePath(session)} replace />;
}
