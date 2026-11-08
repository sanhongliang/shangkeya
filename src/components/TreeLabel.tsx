import { useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** 目录树里的名称：不带任何图标；文字正常换行显示，万一仍显示不全时，鼠标移上去浮层给出完整名称
 *  （浮层可超出侧栏/窗口边界，不被容器裁切）。 */
export default function TreeLabel({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setClipped(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text]);
  const label = (
    <span ref={ref} className="min-w-0 flex-1 whitespace-normal break-all text-left">
      {text}
    </span>
  );
  if (!clipped) return label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-[480px] break-all">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
