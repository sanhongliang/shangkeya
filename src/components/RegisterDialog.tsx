import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchCaptcha, cloudRegister } from '@/api/desktop';

export interface RegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void; // 注册成功（已写入 token），由外层跳转/刷新
}

export default function RegisterDialog({ open, onOpenChange, onRegistered }: RegisterDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaImg, setCaptchaImg] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCaptcha = useCallback(async () => {
    const cap = await fetchCaptcha();
    if (cap) {
      setCaptchaId(cap.captcha_id);
      setCaptchaImg(cap.img);
      setCaptcha('');
    } else {
      toast.error('验证码获取失败，请检查网络');
    }
  }, []);

  useEffect(() => {
    if (open) {
      setUsername('');
      setPassword('');
      setConfirm('');
      setCaptcha('');
      void loadCaptcha();
    }
  }, [open, loadCaptcha]);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error('请输入账号和密码');
      return;
    }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username.trim())) {
      toast.error('账号需为3~20位字母、数字或下划线');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少 6 位');
      return;
    }
    if (password !== confirm) {
      toast.error('两次输入的密码不一致');
      return;
    }
    if (!captcha.trim()) {
      toast.error('请输入图形验证码');
      return;
    }
    setBusy(true);
    const r = await cloudRegister(username.trim(), password, captchaId, captcha.trim());
    setBusy(false);
    if (r.ok) {
      toast.success('注册成功，已自动登录');
      onOpenChange(false);
      onRegistered();
    } else {
      toast.error(r.message ?? '注册失败');
      void loadCaptcha(); // 验证码一次性，无论成败刷新
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            注册账号
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reg-username">账号（3~20位字母/数字/下划线）</Label>
            <Input
              id="reg-username"
              placeholder="请输入账号"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-password">密码（至少 6 位）</Label>
            <Input
              id="reg-password"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-confirm">确认密码</Label>
            <Input
              id="reg-confirm"
              type="password"
              placeholder="请再次输入密码"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>图形验证码</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="请输入验证码"
                value={captcha}
                onChange={(e) => setCaptcha(e.target.value)}
                className="flex-1"
              />
              <button
                type="button"
                onClick={loadCaptcha}
                className="relative h-11 w-[130px] shrink-0 cursor-pointer overflow-hidden rounded-md border"
                title="点击刷新验证码"
                aria-label="刷新验证码"
              >
                {captchaImg ? (
                  <img src={captchaImg} alt="验证码" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    加载中…
                  </span>
                )}
              </button>
              <Button type="button" variant="ghost" size="icon" onClick={loadCaptcha} title="刷新验证码">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">注册成功后自动登录，账号由你本人管理</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? '注册中…' : '注 册'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
