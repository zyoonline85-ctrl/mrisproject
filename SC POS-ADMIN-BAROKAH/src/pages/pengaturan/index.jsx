import { Navigate } from "react-router-dom";
import { navigationGroups } from "@/config/navigation";
import { can } from "@/lib/permissions";
import { useAppStore } from "@/store/appStore";

export default function PengaturanIndexRoute() {
  const session = useAppStore((state) => state.session);
  const group = navigationGroups.find((item) => item.base === "/pengaturan");
  const target = group?.children?.find((child) => can(session, child.permissionKey, "view"))?.to || "/dashboard";
  return <Navigate to={target} replace />;
}
