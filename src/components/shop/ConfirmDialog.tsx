import { useEffect } from "react";

interface Props {
  open: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary" | "warning";
  icon?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = "ยืนยันการทำรายการ",
  message,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  variant = "danger",
  icon = "⚠️",
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const headerCls =
    variant === "danger" ? "bg-danger" : variant === "warning" ? "bg-warning text-dark" : "bg-primary";
  const btnCls = `btn btn-${variant} fw-bold`;

  return (
    <div className="modal-backdrop-custom" onClick={onCancel}>
      <div
        className="modal-custom"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`modal-header ${headerCls} text-white`}>
          <h5 className="modal-title fw-bold m-0">
            {icon} {title}
          </h5>
          <button className="btn-close btn-close-white" onClick={onCancel} />
        </div>
        <div className="p-4 text-center">
          <div style={{ fontSize: "3rem", lineHeight: 1 }} className="mb-2">{icon}</div>
          <div className="fs-6 mb-3">{message}</div>
        </div>
        <div className="modal-footer border-0 px-4 pb-4 d-flex gap-2">
          <button className="btn btn-secondary flex-fill" onClick={onCancel}>
            ↩️ {cancelLabel}
          </button>
          <button className={`${btnCls} flex-fill`} onClick={onConfirm} autoFocus>
            ✅ {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
