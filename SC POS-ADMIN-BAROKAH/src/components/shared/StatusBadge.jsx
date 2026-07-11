import { Badge } from "@/components/ui/badge";

const statusMap = {
  active: ["Aktif", "success"],
  inactive: ["Nonaktif", "muted"],
  paid: ["Paid", "success"],
  refunded: ["Refunded", "danger"],
  cancelled: ["Cancelled", "danger"],
  approved: ["Approved", "success"],
  pending: ["Pending", "warning"],
  rejected: ["Rejected", "danger"],
  draft: ["Draft", "muted"],
  normal: ["Normal", "success"],
  low_stock: ["Stok Menipis", "warning"],
  out_of_stock: ["Stok Habis", "danger"],
  pas: ["Pas", "success"],
  tidak_sesuai_standar: ["Tidak Sesuai Standar", "warning"],
  stock_hilang: ["Stock Hilang", "danger"]
};

function StatusBadge({ status }) {
  const [label, variant] = statusMap[status] || [status, "outline"];
  return <Badge variant={variant}>{label}</Badge>;
}

export { StatusBadge };
