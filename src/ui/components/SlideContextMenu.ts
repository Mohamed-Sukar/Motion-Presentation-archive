import { isRtlLanguage, t } from '../../core/i18n';
import type { ComponentScope } from '../core/ComponentLifecycle';
import type { LayerStack } from '../core/LayerStack';
import { Icons } from '../icons';
import { openAppleMenu } from './AppleDropdown';

export interface SlideContextMenuOpenProps {
  host: HTMLElement;
  scope: ComponentScope;
  slideId: string;
  slideIndex: number;
  totalSlides: number;
  hasReelContext: boolean;
  sequenceLayout?: 'bottom' | 'side';
  layerStack?: LayerStack;
  clientX: number;
  clientY: number;
}

export interface SlideContextMenuCallbacks {
  onMoveUp: (slideId: string) => void;
  onMoveDown: (slideId: string) => void;
  onDuplicate: (slideId: string) => void;
  onEditTransition: (slideId: string) => void;
  onReplaceImage: (slideId: string) => void;
  onOpenCues: (slideId: string) => void;
  onDelete: (slideId: string) => void;
}

export function closeSlideContextMenuView(
  host: HTMLElement | null,
  scope: ComponentScope
): void {
  scope.clear();
  if (host) {
    host.innerHTML = '';
  }
}

export function openSlideContextMenuView(
  props: SlideContextMenuOpenProps,
  callbacks: SlideContextMenuCallbacks
): () => void {
  const {
    host,
    scope,
    slideId,
    slideIndex,
    totalSlides,
    hasReelContext,
    sequenceLayout = 'side',
    layerStack,
    clientX,
    clientY,
  } = props;

  closeSlideContextMenuView(host, scope);

  const canMoveUp = slideIndex > 0;
  const canMoveDown = slideIndex < totalSlides - 1;
  const isHorizontal = sequenceLayout === 'bottom';
  const rtl = isRtlLanguage();

  const moveEarlierIcon = isHorizontal
    ? rtl
      ? Icons.chevronRight
      : Icons.chevronLeft
    : Icons.chevronUp;
  const moveLaterIcon = isHorizontal
    ? rtl
      ? Icons.chevronLeft
      : Icons.chevronRight
    : Icons.chevronDown;

  return openAppleMenu({
    host,
    scope,
    layerStack,
    layerId: 'slide-context-menu',
    menuId: 'studio-context-menu',
    menuClass: 'studio-context-menu',
    minWidth: 224,
    point: { x: clientX, y: clientY },
    ariaLabel: t('nav.slideAria', { num: slideIndex + 1, title: '' }),
    items: [
      {
        id: 'ctx-move-up',
        label: t(isHorizontal ? 'ctx.moveEarlier' : 'ctx.moveUp'),
        icon: moveEarlierIcon,
        disabled: !canMoveUp,
        onSelect: () => callbacks.onMoveUp(slideId),
      },
      {
        id: 'ctx-move-down',
        label: t(isHorizontal ? 'ctx.moveLater' : 'ctx.moveDown'),
        icon: moveLaterIcon,
        disabled: !canMoveDown,
        onSelect: () => callbacks.onMoveDown(slideId),
      },
      {
        id: 'ctx-duplicate',
        label: t('ctx.duplicate'),
        icon: Icons.duplicate,
        onSelect: () => callbacks.onDuplicate(slideId),
      },
      {
        id: 'ctx-edit-transition',
        label: t('ctx.editTransition'),
        icon: Icons.sliders,
        separatorBefore: true,
        disabled: !canMoveDown,
        onSelect: () => callbacks.onEditTransition(slideId),
      },
      {
        id: 'ctx-replace-image',
        label: t('ctx.replaceImage'),
        icon: Icons.photoPlus,
        onSelect: () => callbacks.onReplaceImage(slideId),
      },
      {
        id: 'ctx-open-cues',
        label: t('ctx.openCueStudio'),
        icon: Icons.splitCue,
        disabled: !hasReelContext,
        onSelect: () => callbacks.onOpenCues(slideId),
      },
      {
        id: 'ctx-delete-slide',
        label: t('ctx.delete'),
        icon: Icons.trash,
        separatorBefore: true,
        danger: true,
        onSelect: () => callbacks.onDelete(slideId),
      },
    ],
  });
}
