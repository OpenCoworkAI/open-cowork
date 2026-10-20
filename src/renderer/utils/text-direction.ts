// Let the browser choose the direction from the first strong character in each
// text block. `plaintext` keeps embedded LTR/RTL runs isolated from surrounding UI.
export const AUTO_TEXT_DIRECTION_PROPS = {
  dir: 'auto',
  style: { unicodeBidi: 'plaintext' },
} as const;

export type TextDirection = 'auto' | 'ltr' | 'rtl';

export function getTextDirectionProps(direction: TextDirection) {
  return direction === 'auto'
    ? AUTO_TEXT_DIRECTION_PROPS
    : { dir: direction, style: { unicodeBidi: 'isolate' as const } };
}

// Keep automatic paragraph alignment unchanged. Manual direction changes
// reading order while leaving the message text aligned to the left.
export function getTextAlignmentClass(direction: TextDirection) {
  return direction === 'auto' ? 'text-start' : 'text-left';
}
