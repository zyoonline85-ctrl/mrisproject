import { Navigate } from "react-router-dom";
import { navigationGroups } from "@/config/navigation";
import { can } from "@/lib/permissions";
import { useAppStore } from "@/store/appStore";

export default function MasterDataIndexRoute() {
  const session = useAppStore((state) => state.session);
  const group = navigationGroups.find((item) => item.base === "/master-data");
  const target = group?.children?.find((child) => can(session, child.permissionKey, "view"))?.to || "/dashboard";
  return <Navigate to={target} replace />;
}
