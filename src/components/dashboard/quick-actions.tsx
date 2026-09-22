'use client';

import Link from 'next/link';
import { ArrowUpRight, UserPlus, Briefcase, Radio, Zap } from 'lucide-react';
import type { ComponentType } from 'react';

import { useTranslations } from 'next-intl';

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
}

const ACTIONS: Action[] = [
  {
    labelKey: 'newContact',
    href: '/contacts',
    icon: UserPlus,
    tint: 'text-primary',
  },
  {
    labelKey: 'newDeal',
    href: '/pipelines',
    icon: Briefcase,
    tint: 'text-foreground',
  },
  {
    labelKey: 'newBroadcast',
    href: '/broadcasts/new',
    icon: Radio,
    tint: 'text-foreground',
  },
  {
    labelKey: 'newAutomation',
    href: '/automations/new',
    icon: Zap,
    tint: 'text-primary',
  },
];

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions');

  return (
    <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 xl:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group bg-card hover:bg-muted flex items-center gap-3 rounded-full px-4 py-3 transition-colors"
          >
            <div
              className={`bg-muted flex h-9 w-9 items-center justify-center rounded-full ${a.tint}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-foreground text-sm font-medium">
              {t(a.labelKey as string)}
            </span>
            <ArrowUpRight className="text-muted-foreground ml-auto h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        );
      })}
    </div>
  );
}
