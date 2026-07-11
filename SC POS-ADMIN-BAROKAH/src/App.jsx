import { Suspense } from "react";
import { Link, Navigate, useLocation, useRoutes } from "react-router-dom";
import routes from "~react-pages";
import { useAppStore } from "@/store/appStore";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canAccessPath, getFirstAccessiblePath } from "@/lib/permissions";

function AppRoutes() {
  return useRoutes(routes);
}

function AccessDeniedPage({ session }) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-soft">
        <p className="text-[18px] font-semibold">Akses Tidak Tersedia</p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Role kamu belum memiliki permission untuk membuka halaman ini.
        </p>
        <Button asChild className="mt-4">
          <Link to={getFirstAccessiblePath(session)}>Buka Menu yang Diizinkan</Link>
        </Button>
      </div>
    </div>
  );
}

function App() {
  const session = useAppStore((state) => state.session);
  const location = useLocation();
  const isLoginRoute = location.pathname === "/login";

  if (!session && !isLoginRoute) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (session && isLoginRoute) {
    return <Navigate to={getFirstAccessiblePath(session)} replace />;
  }

  if (session && !canAccessPath(session, location.pathname)) {
    return (
      <AppShell>
        <AccessDeniedPage session={session} />
      </AppShell>
    );
  }

  const routeContent = (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AppRoutes />
    </Suspense>
  );

  if (isLoginRoute) {
    return routeContent;
  }

  return <AppShell>{routeContent}</AppShell>;
}

export default App;
