'use client';

import { usePathname } from 'next/navigation';

import { Flex } from '@radix-ui/themes';
import { SidebarBase } from '@/app/components/sidebar';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { WorkspaceSidebarItem } from './sidebar-item';
import { SectionHeader } from './section-header';
import { useUserStore, selectIsAdmin } from '@/lib/store/user-store';

// ========================================
// Route constants
// ========================================

interface NavItem {
  icon: string;
  label: string;
  route: string;
  adminOnly?: boolean;
}

const OVERVIEW_ITEMS: NavItem[] = [
  { icon: 'business', label: "General", route: '/workspace/general' },
];

const PERSONAL_ITEMS: NavItem[] = [
  { icon: 'person', label: "Profile", route: '/workspace/profile' },
];

// ========================================
// Component
// ========================================

/**
 * Workspace sidebar — settings navigation.
 *
 * Uses `SidebarBase` shell (no header, no footer).
 * Active item determined from current pathname.
 */
export default function WorkspaceSidebar() {
  const rawPathname = usePathname();
  const isAdmin = useUserStore(selectIsAdmin);

  // Normalize trailing slash (trailingSlash: true in next.config)
  const pathname = rawPathname.endsWith('/') && rawPathname !== '/'
    ? rawPathname.slice(0, -1)
    : rawPathname;

  const allRoutes = [
    ...OVERVIEW_ITEMS.map((item) => item.route),
    ...PERSONAL_ITEMS.map((item) => item.route),
  ];

  const isActive = (route: string) => {
    if (pathname === route) return true;
    if (pathname.startsWith(route + '/')) {
      // Don't match if a more specific route exists that also matches
      const hasMoreSpecificRoute = allRoutes.some(
        (r) => r !== route && r.startsWith(route + '/') && (pathname === r || pathname.startsWith(r + '/'))
      );
      return !hasMoreSpecificRoute;
    }
    return false;
  };

  const visibleOverviewItems = OVERVIEW_ITEMS.filter((item) => isAdmin || !item.adminOnly);

  return (
    <SidebarBase>
      <Flex direction="column" gap="4">
        {/* ── Back to app ── */}
        <WorkspaceSidebarItem
          icon={<MaterialIcon name="arrow_back" size={ICON_SIZE_DEFAULT} color="var(--slate-11)" />}
          label={"Back to app"}
          href="/chat/"
        />

        {/* ── Overview section ── */}
        <Flex direction="column" gap="1">
          <SectionHeader title={"Overview"} />
          {visibleOverviewItems.map((item) => (
            <WorkspaceSidebarItem
              key={item.route}
              icon={<MaterialIcon name={item.icon} size={ICON_SIZE_DEFAULT} color="var(--slate-11)" />}
              label={item.label}
              href={`${item.route}/`}
              isActive={isActive(item.route)}
            />
          ))}
        </Flex>

        {/* ── Personal section ── */}
        <Flex direction="column" gap="1">
          <SectionHeader title={"Personal"} />
          {PERSONAL_ITEMS.map((item) => (
            <WorkspaceSidebarItem
              key={item.route}
              icon={<MaterialIcon name={item.icon} size={ICON_SIZE_DEFAULT} color="var(--slate-11)" />}
              label={item.label}
              href={`${item.route}/`}
              isActive={isActive(item.route)}
            />
          ))}
        </Flex>
      </Flex>
    </SidebarBase>
  );
}
