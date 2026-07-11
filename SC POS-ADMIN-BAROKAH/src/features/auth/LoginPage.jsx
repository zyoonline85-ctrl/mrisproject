import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { adminApi } from "@/lib/adminApi";
import { canAccessPath, getFirstAccessiblePath } from "@/lib/permissions";
import { useAppStore } from "@/store/appStore";

function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const setAuth = useAppStore((state) => state.setAuth);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm({
    defaultValues: {
      username: "",
      password: ""
    }
  });

  async function onSubmit(values) {
    try {
      const result = await adminApi.login(values);
      const session = result.user;
      setAuth({ user: session, token: result.token });
      toast({
        title: "Login berhasil",
        description: `Selamat datang, ${session.name}.`,
        variant: "success"
      });
      navigate(canAccessPath(session, from) ? from : getFirstAccessiblePath(session), { replace: true });
    } catch (error) {
      toast({
        title: "Login gagal",
        description: error.message,
        variant: "destructive"
      });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-8">
      <Card className="w-full max-w-[430px]">
        <CardHeader className="px-7 pb-4 pt-7 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-primary overflow-hidden">
            <img src="/mris_logo.jpg" alt="MRIS" className="h-14 w-14 object-cover" />
          </div>
          <CardTitle className="text-[20px]">MRIS Barokah Grup</CardTitle>
          <CardDescription className="mt-1">Multi Resto Integration System</CardDescription>
        </CardHeader>
        <CardContent className="px-7 pb-7">
          <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                className="h-11 px-4"
                {...register("username", {
                  required: "Username wajib diisi"
                })}
              />
              {errors.username ? <p className="text-[11px] text-destructive">{errors.username.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="h-11 px-4"
                {...register("password", {
                  required: "Password wajib diisi"
                })}
              />
              {errors.password ? <p className="text-[11px] text-destructive">{errors.password.message}</p> : null}
            </div>
            <div className="flex items-center justify-between gap-4 text-[12px]">
              <label className="inline-flex items-center gap-2 text-muted-foreground">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-border accent-primary" />
                Remember me
              </label>
              <button type="button" className="font-medium text-primary" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "Sembunyikan" : "Lihat password"}
              </button>
            </div>
            <Button type="submit" className="h-11 w-full text-[13px]" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : <LogIn />}
              {isSubmitting ? "Masuk..." : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export { LoginPage };
