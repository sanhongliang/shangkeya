import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, LogIn, UserPlus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RegisterDialog from '@/components/RegisterDialog';
import RechargeDialog from '@/components/RechargeDialog';
import { useAppData } from '@/data/app-store';

// 记住密码：只存在本机 localStorage，方便下次打开直接点登录；不勾选就清掉
const REMEMBER_KEY = 'shangkeya:login';

function loadRemember(): { username: string; password: string; remember: boolean } {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return { username: '', password: '', remember: true };
    const o = JSON.parse(raw) as { u?: string; p?: string };
    return { username: String(o.u ?? ''), password: String(o.p ?? ''), remember: true };
  } catch {
    return { username: '', password: '', remember: true };
  }
}

function saveRemember(username: string, password: string) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ u: username, p: password }));
  } catch {
    /* ignore */
  }
}

function clearRemember() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* ignore */
  }
}

export default function LoginPage() {
  const { login } = useAppData();
  const navigate = useNavigate();
  const [username, setUsername] = useState(() => loadRemember().username);
  const [password, setPassword] = useState(() => loadRemember().password);
  const [remember, setRemember] = useState(() => loadRemember().remember);
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  // 换窗口/刷新时同步一次已记住的账号（本机有多账号时以最后保存的为准）
  useEffect(() => {
    const r = loadRemember();
    if (r.username) {
      setUsername((cur) => cur || r.username);
      setPassword((cur) => cur || r.password);
      setRemember(true);
    }
  }, []);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error('请输入账号和密码');
      return;
    }
    setBusy(true);
    const r = await login(username, password);
    setBusy(false);
    if (r.ok) {
      if (remember) saveRemember(username.trim(), password);
      else clearRemember();
      toast.success('登录成功');
      navigate('/home');
    } else {
      toast.error(r.message ?? '登录失败');
    }
  };

  const handleRegistered = () => {
    // 注册成功已自动写入 token，进入主界面
    navigate('/home');
  };

  const openRecharge = () => {
    // 充值入口无需登录：账号到期后可用账号密码 + 卡号自救续期
    setRechargeOpen(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent/40 p-4">
      <Card className="w-full max-w-[400px]">
        <CardContent className="pt-8">
          <div className="mb-8 flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white">
              <GraduationCap className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">上课鸭</h1>
            <p className="text-sm text-muted-foreground">课时管理系统 · 教师端</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">账号</Label>
              <Input
                id="username"
                placeholder="请输入账号"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => {
                  setRemember(e.target.checked);
                  if (!e.target.checked) clearRemember();
                }}
                className="h-4 w-4 accent-[#1677ff]"
              />
              记住密码（仅保存在本机，下次打开直接登录）
            </label>
            <Button className="w-full" onClick={handleSubmit} disabled={busy}>
              <LogIn className="mr-1.5 h-4 w-4" /> {busy ? '登录中…' : '登 录'}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <Button variant="ghost" className="px-0" onClick={() => setRegisterOpen(true)}>
                <UserPlus className="mr-1 h-4 w-4" />
                注册账号
              </Button>
              <Button variant="ghost" className="px-0 text-warning" onClick={openRecharge}>
                <Wallet className="mr-1 h-4 w-4" />
                充值入口
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              数据存储于云端服务器
            </p>
          </div>
        </CardContent>
      </Card>
      <RegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={handleRegistered} />
      <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} needLogin />
    </div>
  );
}
