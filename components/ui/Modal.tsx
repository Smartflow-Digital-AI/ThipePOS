'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-lg',
  dismissable = true,
}: {
  open: boolean;
  onClose?: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: string;
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    // Stop the page behind from scrolling under the dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="absolute inset-0 overlay animate-fadeIn" onClick={dismissable ? onClose : undefined} />

      {/* Full-width sheet on a phone, centred card from sm up. */}
      <div
        className={`relative w-full ${width} bg-panel border border-line shadow-pop animate-in
                    rounded-t-xl sm:rounded-xl max-h-[92dvh] sm:max-h-[90dvh] flex flex-col`}
      >
        {(title || dismissable) && (
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b border-line flex-none">
            <div className="min-w-0">
              {title && <h2 className="font-semibold">{title}</h2>}
              {subtitle && <p className="text-sm text-dim mt-0.5">{subtitle}</p>}
            </div>
            {dismissable && (
              <button
                onClick={onClose}
                className="text-faint hover:text-ink transition-colors -mr-1 -mt-1 p-1 flex-none"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto scroll">{children}</div>
      </div>
    </div>
  );
}
