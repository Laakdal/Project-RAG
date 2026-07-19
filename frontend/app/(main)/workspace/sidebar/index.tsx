'use client';

import { usePathname } from 'next/navigation';

import { Flex } from '@radix-ui/themes';
import { useUserStore, selectIsAdmin } from '@/lib/store/user-store';
import { SidebarBase } from '@/app/components/sidebar';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ICON_SIZE_DEFAULT } from '@/app/components/sidebar';
import { WorkspaceSidebarItem } from './sidebar-item';
import { SectionHeader } from './section-header';

// ========================================
// Route constants
// ========================================

interface NavItem {
  icon: string;
  label: string;
  route: string;
}

const PERSONAL_ITEMS: NavItem[] = [
  { icon: 'person', label: "Profile", route: '/workspace/profile' },
];

const ADMIN_ITEMS: NavItem[] = [
  { icon: 'group', label: 'Users', route: '/workspace/users' },
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
  const isAdmin = useUserStore(selectIsAdmin) === true;

  // Normalize trailing slash (trailingSlash: true in next.config)
  const pathname = rawPathname.endsWith('/') && rawPathname !== '/'
    ? rawPathname.slice(0, -1)
    : rawPathname;

  const isActive = (route: string) =>
    pathname === route || pathname.startsWith(route + '/');

  return (
    <SidebarBase>
      <Flex direction="column" gap="4">
        {/* ── Back to app ── */}
        <WorkspaceSidebarItem
          icon={<MaterialIcon name="arrow_back" size={ICON_SIZE_DEFAULT} color="var(--slate-11)" />}
          label={"Back to app"}
          href="/chat/"
        />

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

        {/* ── Administration section (admins only) ── */}
        {isAdmin && (
          <Flex direction="column" gap="1">
            <SectionHeader title={'Administration'} />
            {ADMIN_ITEMS.map((item) => (
              <WorkspaceSidebarItem
                key={item.route}
                icon={<MaterialIcon name={item.icon} size={ICON_SIZE_DEFAULT} color="var(--slate-11)" />}
                label={item.label}
                href={`${item.route}/`}
                isActive={isActive(item.route)}
              />
            ))}
          </Flex>
        )}
      </Flex>
    </SidebarBase>
  );
}
