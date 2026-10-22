import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet } from 'lucide-react';
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
import { redeemCard, fetchMyAccount } from '@/api/desktop';
import { setToken } from '@/api/client';

export interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 未登录模式（登录页充值入口）：需输入账号/密码 + 卡号，兑换成功自动登录 */
  needLogin?: boolean;
}

function fmtDate(s?: string | null): string {
  if (!s) return '未设置';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 是否已到期 */
function expired(exp?: string | null): boolean {
  if (!exp) return true; // 无到期时间视为需续期
  const d = new Date(exp);
  return Number.isNaN(d.getTime()) || d.getTime() <= Date.now();
}

export default function RechargeDialog({ open, onOpenChange, needLogin }: RechargeDialogProps) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ days: number; type: string; expires_at: string } | null>(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setUsername('');
      setPassword('');
      setResult(null);
      if (needLogin) return; // 未登录模式不拉到期时间
      setLoading(true);
      fetchMyAccount()
        .then((r) => {
          if (r.ok) setExpiresAt(r.expires_at ?? null);
          else toast.error(r.message ?? '获取到期时间失败');
        })
        .finally(() => setLoading(false));
    }
  }, [open, needLogin]);

  const handleConfirm = async () => {
    const cd = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cd.length !== 16) {
      toast.error('充值卡号无效（应为 16 位）');
      return;
    }
    if (needLogin) {
      if (!username.trim() || !password.trim()) {
        toast.error('请输入账号和密码');
        return;
      }
    }
    setBusy(true);
    const r = await redeemCard(
      cd,
      needLogin ? { username: username.trim(), password } : undefined,
    );
    setBusy(false);
    if (!r.ok) {
      toast.error(r.message ?? '兑换失败');
      return;
    }
    setResult({ days: r.days ?? 0, type: r.type ?? '充值卡', expires_at: r.expires_at ?? '' });
    setExpiresAt(r.expires_at ?? null);
    if (needLogin && r.token) {
      // 无登录兑换成功：写入 token 自动登录
      setToken(r.token);
      toast.success(`续期成功 ${r.days} 天，已自动登录`);
      onOpenChange(false);
      navigate('/home');
      return;
    }
    toast.success(`兑换成功，已续期 ${r.days} 天`);
    setCode('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            卡密续期{needLogin ? '（账号已到期）' : '（我的账号）'}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {!needLogin && (
            <div className="rounded-md bg-muted/50 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">当前账号到期</span>
                <span className={expired(expiresAt) ? 'font-semibold text-destructive' : 'font-semibold'}>
                  {loading ? '加载中…' : fmtDate(expiresAt)}
                </span>
              </div>
              {expired(expiresAt) && !loading && (
                <p className="mt-1 text-xs text-destructive">账号已到期或未续期，兑换充值卡后恢复使用</p>
              )}
            </div>
          )}
          {needLogin && (
            <>
              <div className="rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                账号到期后无法登录。输入账号、密码和充值卡号即可续期，成功后自动登录。
              </div>
              <div className="space-y-1.5">
                <Label>账号</Label>
                <Input
                  placeholder="请输入账号"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>密码</Label>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>充值卡号（16 位）</Label>
            <Input
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              autoComplete="off"
            />
          </div>
          {result && (
            <div className="rounded-md bg-primary/5 px-3 py-2.5 text-sm">
              <p className="font-medium text-primary">续期成功</p>
              <p className="mt-0.5 text-muted-foreground">
                {result.type}（{result.days} 天），新到期时间：{fmtDate(result.expires_at)}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            充值卡由管理员在管理后台生成（周卡/月卡/半年卡/年卡），兑换后直接延长本账号使用时间
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? '兑换中…' : '确认续期'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
