import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface PDFInventoryItem {
  productName: string;
  sku: string;
  brand: string;
  quantity: number;
  retailPrice?: number | null;
  wholesalePrice?: number | null;
  costPrice?: number | null;
}

export type ColumnKey =
  | "productName"
  | "sku"
  | "brand"
  | "quantity"
  | "retailPrice"
  | "wholesalePrice"
  | "costPrice";

export interface ExportInventoryPDFOptions {
  warehouseName: string;
  items: PDFInventoryItem[];
  columns?: ColumnKey[];
}

const COLUMN_CONFIG: Record<
  ColumnKey,
  { header: string; dataKey: string; halign: "left" | "right" | "center" }
> = {
  productName: { header: "Product Name", dataKey: "productName", halign: "left" },
  sku: { header: "Product Code", dataKey: "sku", halign: "left" },
  brand: { header: "Brand", dataKey: "brand", halign: "left" },
  quantity: { header: "Quantity", dataKey: "quantity", halign: "right" },
  retailPrice: { header: "Retail Price", dataKey: "retailPrice", halign: "right" },
  wholesalePrice: { header: "Wholesale Price", dataKey: "wholesalePrice", halign: "right" },
  costPrice: { header: "Cost Price", dataKey: "costPrice", halign: "right" },
};

const DEFAULT_COLUMNS: ColumnKey[] = ["productName", "quantity"];

function formatPKR(value: number | null | undefined): string {
  if (value === null || value === undefined) return "---";
  return `PKR ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadLogo(): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const response = await fetch("/logo-light.png");
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject();
      reader.readAsDataURL(blob);
    });
    // Get natural dimensions to preserve aspect ratio
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject();
      img.src = dataUrl;
    });
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
}

export async function exportInventoryPDF(options: ExportInventoryPDFOptions): Promise<void> {
  const { warehouseName, items } = options;
  const columns = options.columns ?? DEFAULT_COLUMNS;

  const orientation = columns.length > 4 ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // --- HEADER ---
  const logo = await loadLogo();
  let headerBottomY = 28;

  if (logo) {
    // Scale logo to a fixed height, preserving aspect ratio
    const logoHeight = 20; // mm
    const logoWidth = (logo.width / logo.height) * logoHeight;
    doc.addImage(logo.dataUrl, "PNG", 14, 8, logoWidth, logoHeight);
    headerBottomY = 8 + logoHeight + 2;
  } else {
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("CORESPEC", 14, 20);
    headerBottomY = 24;
  }

  // Subtitle
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text("Inventory Report", 14, headerBottomY + 4);

  // Right side: warehouse name, date, counts
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(warehouseName, pageWidth - 14, 16, { align: "right" });
  doc.text(`${dateStr} at ${timeStr}`, pageWidth - 14, 22, { align: "right" });

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  doc.text(
    `${items.length} products  |  ${totalUnits.toLocaleString()} total units`,
    pageWidth - 14,
    28,
    { align: "right" }
  );

  // Divider
  const dividerY = headerBottomY + 10;
  doc.setDrawColor(200);
  doc.setLineWidth(0.5);
  doc.line(14, dividerY, pageWidth - 14, dividerY);

  // --- TABLE ---
  const tableColumns = columns.map((key) => ({
    header: COLUMN_CONFIG[key].header,
    dataKey: key,
  }));

  const tableRows = items.map((item) => {
    const row: Record<string, string | number> = {};
    for (const key of columns) {
      switch (key) {
        case "retailPrice":
          row[key] = formatPKR(item.retailPrice);
          break;
        case "wholesalePrice":
          row[key] = formatPKR(item.wholesalePrice);
          break;
        case "costPrice":
          row[key] = formatPKR(item.costPrice);
          break;
        default:
          row[key] = item[key];
      }
    }
    return row;
  });

  const columnStyles: Record<string, { halign: "left" | "right" | "center" }> = {};
  for (const key of columns) {
    columnStyles[key] = { halign: COLUMN_CONFIG[key].halign };
  }

  // Summary footer row
  const totalUnitsSum = items.reduce((sum, item) => sum + item.quantity, 0);
  const footerRow: Record<string, string | number> = {};
  for (const key of columns) {
    if (key === "productName") footerRow[key] = `Total: ${items.length} products`;
    else if (key === "quantity") footerRow[key] = totalUnitsSum.toLocaleString();
    else footerRow[key] = "";
  }

  autoTable(doc, {
    startY: dividerY + 4,
    columns: tableColumns,
    body: [...tableRows, footerRow],
    columnStyles,
    headStyles: {
      fillColor: [30, 30, 30],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [50, 50, 50],
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    styles: {
      cellPadding: 3,
      overflow: "linebreak",
    },
    margin: { left: 14, right: 14 },
    willDrawCell: (data) => {
      // Style the summary footer row (last row) differently
      if (data.section === "body" && data.row.index === tableRows.length) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [230, 230, 230];
        data.cell.styles.textColor = [20, 20, 20];
        data.cell.styles.fontSize = 9;
      }
    },
    didDrawPage: () => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Page ${doc.getCurrentPageInfo().pageNumber}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );
      doc.text("Generated by CoreSpec Inventory System", 14, pageHeight - 10);
    },
  });

  // --- SAVE ---
  const safeWarehouseName = warehouseName.replace(/[^a-zA-Z0-9]/g, "_");
  const dateFileStr = now.toISOString().slice(0, 10);
  doc.save(`Inventory_${safeWarehouseName}_${dateFileStr}.pdf`);
}
