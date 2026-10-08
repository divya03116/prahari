import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as D from '@radix-ui/react-dialog';
import {
  Building2,
  Cctv,
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  LayoutGrid,
  LineChart,
  LogOut,
  Menu as MenuIcon,
  Mic,
  Plus,
  ScrollText,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth, useDisplayName } from '@/auth/AuthProvider';
import { LogoMark } from '@/components/brand';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Badge, RoleBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Avatar } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useI18n, type MessageKey } from '@/i18n';
import { roleKey } from '@/i18n/labels';
import { usingEmulators } from '@/lib/firebase';

interface NavEntry {
  to: string;
  label: MessageKey;
  icon: ReactNode;
  end?: boolean;
}

const WORKSPACE: NavEntry[] = [
  { to: '/app', label: 'nav.dashboard', icon: <LayoutGrid />, end: true },
  { to: '/app/report', label: 'nav.report', icon: <Mic /> },
  { to: '/app/reports', label: 'nav.reports', icon: <FileText /> },
  { to: '/app/monitoring', label: 'nav.monitoring', icon: <Cctv /> },
  { to: '/app/actions', label: 'nav.actions', icon: <ClipboardCheck /> },
  { to: '/app/insights', label: 'nav.insights', icon: <LineChart /> },
];

const ADMIN: NavEntry[] = [
  { to: '/app/admin/users', label: 'nav.users', icon: <Users /> },
  { to: '/app/admin/reference', label: 'nav.reference', icon: <Building2 /> },
  { to: '/app/admin/audit', label: 'nav.audit', icon: <ScrollText /> },
];

function NavItem({ entry, onNavigate }: { entry: NavEntry; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <NavLink
      to={entry.to}
      end={entry.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
          isActive
            ? 'bg-surface-3 text-fg [&_svg]:text-fg'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:text-fg-subtle hover:[&_svg]:text-fg-muted',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-full bg-signal" />}
          {entry.icon}
          <span className="truncate">{t(entry.label)}</span>
        </>
      )}
    </NavLink>
  );
}

function UserMenu() {
  const { user, role, signOut } = useAuth();
  const name = useDisplayName();
  const navigate = useNavigate();
  const { t } = useI18n();

  const out = async () => {
    await signOut();
    toast.success(t('nav.signedOut'));
    navigate('/signin', { replace: true });
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
          aria-label={t('nav.accountMenu')}
        >
          <Avatar name={name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{name}</span>
            <span className="block truncate text-xs text-fg-subtle">{t(roleKey(role))}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-60">
        <MenuLabel>{t('nav.signedInAs')}</MenuLabel>
        <div className="px-2 pb-2">
          <p className="truncate text-sm text-fg">{user?.email}</p>
          <div className="mt-1.5">
            <RoleBadge role={role} />
          </div>
        </div>
        <MenuSeparator />
        <MenuItem icon={<Settings />} onSelect={() => navigate('/app/settings')}>
          {t('nav.settings')}
        </MenuItem>
        <MenuItem icon={<LogOut />} onSelect={() => void out()}>
          {t('nav.signOut')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link to="/app" onClick={onNavigate} className="flex items-center gap-2 text-fg" aria-label="PRAHARI dashboard">
          <LogoMark />
          <span className="text-sm font-semibold tracking-[0.14em]">PRAHARI</span>
        </Link>
        {usingEmulators && (
          <Badge tone="info" className="ml-auto" title={t('nav.localBadgeTitle')}>
            {t('nav.localBadge')}
          </Badge>
        )}
      </div>

      <div className="px-3 pb-2">
        <Link to="/app/reports/new" onClick={onNavigate} className={buttonClass({ variant: 'secondary', className: 'w-full justify-start' })}>
          <Plus aria-hidden /> {t('nav.newReport')}
        </Link>
      </div>

      <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {WORKSPACE.map((e) => (
            <NavItem key={e.to} entry={e} onNavigate={onNavigate} />
          ))}
        </div>
        {can('admin') && (
          <div className="flex flex-col gap-0.5">
            <p className="px-2.5 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">{t('nav.administration')}</p>
            {ADMIN.map((e) => (
              <NavItem key={e.to} entry={e} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-1.5 border-t border-border p-2">
        <LanguageSwitcher compact className="mx-1 self-start" />
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { t } = useI18n();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-60 print:min-h-0 print:pl-0">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface-3 px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3 print:hidden"
      >
        {t('nav.skip')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-surface lg:block print:hidden">
        <SidebarContents />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-canvas/95 px-4 backdrop-blur-sm lg:hidden print:hidden">
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.open')} className="-ml-2">
              <MenuIcon aria-hidden />
            </Button>
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-fade-in lg:hidden" />
            <D.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-surface data-[state=open]:animate-slide-in-left focus:outline-none lg:hidden">
              <D.Title className="sr-only">{t('nav.title')}</D.Title>
              <D.Description className="sr-only">{t('nav.mainDescription')}</D.Description>
              <D.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('nav.close')} className="absolute top-3.5 right-3">
                  <X aria-hidden />
                </Button>
              </D.Close>
              <SidebarContents onNavigate={() => setOpen(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>
        <Link to="/app" className="flex items-center gap-2 text-fg" aria-label="PRAHARI dashboard">
          <LogoMark />
          <span className="text-sm font-semibold tracking-[0.14em]">PRAHARI</span>
        </Link>
        <Link to="/app/reports/new" className={buttonClass({ variant: 'secondary', size: 'sm', className: 'ml-auto' })}>
          <Plus aria-hidden /> {t('nav.new')}
        </Link>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
        <Outlet />
      </main>
    </div>
  );
}
