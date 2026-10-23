import { useEffect, useRef, useState, type RefObject } from 'react';
import { copyText, selectContents } from '../lib/clipboard';
import { useAnnounce } from './Announcer';
import { Icon } from './Icon';

interface CopyButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
  announce: string;
  fallbackMessage: string;
  /** Lo que se selecciona si la Clipboard API falla. */
  target?: RefObject<HTMLElement | null>;
  className?: string;
}

export function CopyButton({ text, label, copiedLabel, announce, fallbackMessage, target, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const say = useAnnounce();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      say(announce);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
      return;
    }
    if (target?.current) selectContents(target.current);
    say(fallbackMessage);
  };

  return (
    <button type="button" className={`btn ${className ?? ''}`} data-copied={copied || undefined} onClick={onClick}>
      <Icon name={copied ? 'check' : 'copy'} />
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}
