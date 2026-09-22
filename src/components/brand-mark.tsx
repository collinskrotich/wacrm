import Image from 'next/image';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
}

/** Compact crop of the supplied Craft Duka logo for small app chrome. */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block shrink-0 overflow-hidden rounded-md bg-[#fbfaf5]',
        className
      )}
    >
      <Image
        src="/brand-logo.png"
        alt=""
        width={1254}
        height={1254}
        className="absolute top-1/2 left-1/2 h-[285%] w-[285%] max-w-none"
        style={{ transform: 'translate(-50%, -40.5%)' }}
        priority
      />
    </span>
  );
}
