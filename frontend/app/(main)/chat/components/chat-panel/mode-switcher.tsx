'use client';

import { Flex, Text } from '@radix-ui/themes';
import { MaterialIcon } from '@/app/components/ui/MaterialIcon';
import { ChatStarIcon } from '@/app/components/ui/chat-star-icon';
import { ICON_SIZES } from '@/lib/constants/icon-sizes';
import { useIsMobile } from '@/lib/hooks/use-is-mobile';

interface ModeSwitcherProps {
  /** Mode colors (bg, fg, icon) */
  modeColors: {
    bg: string;
    fg: string;
    icon: string;
  };
  /** Whether in search mode (changes layout) */
  isSearchMode: boolean;
  /** Handler for the left button — only used in search mode (return to chat). */
  onLeftClick: () => void;
  /** Handler for the search toggle button. */
  onRightClick: () => void;
}

/**
 * Mode switcher pill.
 *
 * The query-mode picker (Internal Search / Web Search) was removed — n8n's RAG
 * Query handles doc + web retrieval in one call, so there is nothing to switch
 * between. In the normal layout the pill is just a search toggle; in search mode
 * it shows a back-to-chat icon plus the active "Search" button.
 */
export function ModeSwitcher({
  modeColors,
  isSearchMode,
  onLeftClick,
  onRightClick,
}: ModeSwitcherProps) {
  const isMobile = useIsMobile();
  return (
    <Flex
      align="center"
      style={{
        background: 'var(--olive-1)',
        border: '1px solid var(--olive-3)',
        borderRadius: 'var(--radius-1)',
        padding: 'var(--space-1)',
        gap: 0,
        flexShrink: 0,
      }}
    >
      {isSearchMode ? (
        <>
          {/* Back-to-chat icon (left) */}
          <Flex
            align="center"
            justify="center"
            onClick={onLeftClick}
            style={{
              width: 'var(--space-6)',
              height: 'var(--space-6)',
              borderRadius: 'var(--radius-1)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <ChatStarIcon
              size={ICON_SIZES.MINIMAL}
              color="var(--mode-chat-icon)"
            />
          </Flex>

          {/* Active search button with text (right) */}
          <Flex
            align="center"
            justify="center"
            gap="2"
            onClick={onRightClick}
            style={{
              height: 'var(--space-6)',
              borderRadius: 'var(--radius-2)',
              backgroundColor: 'var(--mode-search-bg)',
              cursor: 'pointer',
              paddingLeft: 'var(--space-3)',
              paddingRight: 'var(--space-3)',
              transition: 'background-color 0.15s ease',
            }}
          >
            <MaterialIcon
              name="search"
              size={ICON_SIZES.SECONDARY}
              color="var(--mode-search-fg)"
            />
            {!isMobile && (
              <Text
                size="2"
                weight="medium"
                style={{ color: 'var(--mode-search-fg)' }}
              >
                {"Search"}
              </Text>
            )}
          </Flex>
        </>
      ) : (
        /* Search toggle icon */
        <Flex
          align="center"
          justify="center"
          onClick={onRightClick}
          style={{
            width: 'var(--space-6)',
            height: 'var(--space-6)',
            borderRadius: 'var(--radius-1)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <MaterialIcon
            name="search"
            size={ICON_SIZES.SECONDARY}
            color={modeColors.fg}
          />
        </Flex>
      )}
    </Flex>
  );
}
