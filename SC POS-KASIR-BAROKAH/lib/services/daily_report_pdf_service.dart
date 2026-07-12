import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../utils/formatters.dart';

class DailyReportPdfService {
  const DailyReportPdfService._();

  static Future<void> download({
    required List<Map<String, dynamic>> reports,
    required String outletName,
  }) async {
    final document = pw.Document();

    // Hitung total untuk baris paling bawah
    int totalPendapatan = 0;
    int totalPengeluaran = 0;
    int totalKembalikanUang = 0;
    int totalLabaKotor = 0;
    int totalUangLaci = 0;

    for (final r in reports) {
      totalPendapatan += (r['pendapatan'] as num).toInt();
      totalPengeluaran += (r['pengeluaran'] as num).toInt();
      totalKembalikanUang += (r['kembalikan_uang_kas'] as num).toInt();
      totalLabaKotor += (r['laba_kotor'] as num).toInt();
      totalUangLaci += (r['uang_laci'] as num).toInt();
    }

    document.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.landscape, // Gunakan orientasi landscape agar muat kolom lebar
        margin: const pw.EdgeInsets.all(24),
        build: (context) => [
          pw.Center(
            child: pw.Text(
              'REKAPITULASI LAPORAN HARIAN (MRIS)',
              style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.SizedBox(height: 4),
          pw.Center(
            child: pw.Text(
              outletName,
              style: const pw.TextStyle(fontSize: 11),
            ),
          ),
          pw.SizedBox(height: 16),
          pw.Table(
            columnWidths: const {
              0: pw.FlexColumnWidth(2), // Tanggal
              1: pw.FlexColumnWidth(2.5), // Pendapatan
              2: pw.FlexColumnWidth(2.5), // Pengeluaran
              3: pw.FlexColumnWidth(2.5), // Kembalikan Uang Kas
              4: pw.FlexColumnWidth(2.5), // Laba Kotor
              5: pw.FlexColumnWidth(2.5), // Uang Laci
            },
            border: const pw.TableBorder(
              horizontalInside: pw.BorderSide(color: PdfColors.grey300, width: 0.6),
              bottom: pw.BorderSide(color: PdfColors.grey500, width: 0.8),
              top: pw.BorderSide(color: PdfColors.grey500, width: 0.8),
            ),
            children: [
              // Header
              pw.TableRow(
                decoration: const pw.BoxDecoration(color: PdfColors.grey200),
                children: [
                  _cell('Tanggal', bold: true),
                  _cell('Pendapatan', bold: true, alignRight: true),
                  _cell('Pengeluaran', bold: true, alignRight: true),
                  _cell('Kembalikan Uang', bold: true, alignRight: true),
                  _cell('Laba Kotor', bold: true, alignRight: true),
                  _cell('Uang Laci (Omzet)', bold: true, alignRight: true),
                ],
              ),
              // Baris Data
              ...reports.map((r) {
                return pw.TableRow(
                  children: [
                    _cell(r['tanggal']?.toString() ?? ''),
                    _cell(formatAccountingCurrency((r['pendapatan'] as num).toInt()), alignRight: true),
                    _cell(formatAccountingCurrency((r['pengeluaran'] as num).toInt()), alignRight: true),
                    _cell(formatAccountingCurrency((r['kembalikan_uang_kas'] as num).toInt()), alignRight: true),
                    _cell(formatAccountingCurrency((r['laba_kotor'] as num).toInt()), alignRight: true),
                    _cell(formatAccountingCurrency((r['uang_laci'] as num).toInt()), alignRight: true),
                  ],
                );
              }),
              // Total Row
              pw.TableRow(
                decoration: const pw.BoxDecoration(color: PdfColors.grey100),
                children: [
                  _cell('TOTAL', bold: true),
                  _cell(formatAccountingCurrency(totalPendapatan), bold: true, alignRight: true),
                  _cell(formatAccountingCurrency(totalPengeluaran), bold: true, alignRight: true),
                  _cell(formatAccountingCurrency(totalKembalikanUang), bold: true, alignRight: true),
                  _cell(formatAccountingCurrency(totalLabaKotor), bold: true, alignRight: true),
                  _cell(formatAccountingCurrency(totalUangLaci), bold: true, alignRight: true),
                ],
              ),
            ],
          ),
        ],
      ),
    );

    final String fileSafeOutlet = outletName
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-|-$'), '');

    await Printing.sharePdf(
      bytes: await document.save(),
      filename: 'laporan-harian-$fileSafeOutlet.pdf',
    );
  }

  static pw.Widget _cell(
    String text, {
    bool bold = false,
    bool alignRight = false,
  }) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      child: pw.Text(
        text,
        textAlign: alignRight ? pw.TextAlign.right : pw.TextAlign.left,
        style: pw.TextStyle(
          fontSize: 9,
          fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
        ),
      ),
    );
  }
}
