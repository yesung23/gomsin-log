import type { ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> & {
  label?: string;
};

/** The single approved brand symbol, shared by first-run and signed-in surfaces. */
export function BrandMark({
  className,
  label = '곰신로그 브랜드 마크',
  ...props
}: BrandMarkProps) {
  return (
    <img
      {...props}
      data-brand-mark="true"
      src="/favicon.svg"
      alt={label}
      className={cn('block shrink-0', className)}
    />
  );
}
