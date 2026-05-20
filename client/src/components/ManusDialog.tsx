import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Film } from "lucide-react";

interface ManusDialogProps {
  title?: string;
  logo?: string;
  open?: boolean;
  onLogin?: () => void;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

export function ManusDialog({ title, logo, open, onLogin, onOpenChange, onClose }: ManusDialogProps) {
  const [internalOpen, setInternalOpen] = useState(open ?? false);

  useEffect(() => {
    if (open !== undefined) setInternalOpen(open);
  }, [open]);

  const handleOpenChange = (val: boolean) => {
    setInternalOpen(val);
    onOpenChange?.(val);
    if (!val) onClose?.();
  };

  return (
    <Dialog open={internalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex flex-col items-center gap-5 p-8 max-w-sm"
        style={{
          background: "oklch(0.11 0.007 260)",
          border: "1px solid oklch(0.22 0.008 260)",
          borderRadius: 20,
          boxShadow: "0 24px 80px oklch(0 0 0 / 0.7), 0 0 0 1px oklch(0.22 0.008 260 / 0.5)",
        }}
      >
        {/* Logo */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: logo
              ? "transparent"
              : "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
            boxShadow: "0 8px 32px oklch(0.68 0.22 285 / 0.30)",
          }}
        >
          {logo ? (
            <img src={logo} alt="logo" className="w-full h-full object-contain rounded-2xl" />
          ) : (
            <Film className="w-7 h-7 text-white" />
          )}
        </div>

        {/* Text */}
        <div className="text-center">
          <p className="text-base font-semibold mb-1.5" style={{ color: "oklch(0.88 0.005 260)" }}>
            {title ?? "登录以继续"}
          </p>
          <p className="text-sm" style={{ color: "oklch(0.45 0.006 260)" }}>
            使用 Manus 账号登录，开始 AI 视频创作
          </p>
        </div>

        {/* CTA */}
        <button
          onClick={onLogin}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all"
          style={{
            background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
            boxShadow: "0 4px 20px oklch(0.68 0.22 285 / 0.35)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 28px oklch(0.68 0.22 285 / 0.50)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px oklch(0.68 0.22 285 / 0.35)";
          }}
        >
          使用 Manus 登录
        </button>
      </DialogContent>
    </Dialog>
  );
}
