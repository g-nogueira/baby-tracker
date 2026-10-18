import { createElement, type ReactNode } from 'react';
/** Same SVG geometry/attributes as the native component; only the host element changes. */
const element = (tag: string) =>
  function SvgElement({
    children,
    accessibilityElementsHidden: _hidden,
    importantForAccessibility: _importance,
    ...props
  }: {
    children?: ReactNode;
    [key: string]: unknown;
  }) {
    return createElement(tag, props, children);
  };
export default element('svg');
export const Circle = element('circle');
export const Path = element('path');
export const G = element('g');
export const Line = element('line');
export const Text = element('text');
