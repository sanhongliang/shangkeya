import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { GraduationCap, LogOut, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppData } from '@/data/app-store';
import RechargeDialog from '@/components/RechargeDialog';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { path: '/home', label: '首页' },
  { path: '/students', label: '学员管理' },
  { path: '/schedule', label: '课程管理' },
  { path: '/courseware', label: '课件管理' },
  { path: '/salary', label: '薪资详细' },
  { path: '/settings', label: '设置' },
];

export const Layout = () => {
  const { authUser, logout } = useAppData();
  const navigate = useNavigate();
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-8 border-b bg-card px-5">
        <div className="flex items-center gap-2 text-primary">
          <GraduationCap className="h-7 w-7" />
          <span className="text-base font-semibold tracking-wide text-foreground">
            上课鸭-课时管理系统
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/home'}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {authUser && (
            <span className="text-sm text-muted-foreground">
              欢迎，<span className="font-medium text-foreground">{authUser.name}</span>
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => setRechargeOpen(true)}>
            <Wallet className="mr-1 h-4 w-4" />
            充值
          </Button>
          <Button size="sm" variant="ghost" onClick={handleLogout}>
            <LogOut className="mr-1 h-4 w-4" />
            退出登录
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-5">
        <Outlet />
      </main>
      <RechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </div>
  );
};
