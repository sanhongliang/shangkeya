import { useState } from 'react';
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

export default function LoginPage() {
  const { login } = useAppData();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error('请输入账号和密码');
      return;
    }
    setBusy(true);
    const r = await login(username, password);
    setBusy(false);
    if (r.ok) {
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
