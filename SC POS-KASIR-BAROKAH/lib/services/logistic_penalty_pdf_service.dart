import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../utils/formatters.dart';

class LogisticPenaltyPdfService {
  const LogisticPenaltyPdfService._();

  static Future<void> download({
    required List<Map<String, dynamic>> penalties,
    required String outletName,
    required DateTime from,
    required DateTime to,
  }) async {
    final document = pw.Document();

    int grandTotalDenda = 0;
    for (final p in penalties) {
      grandTotalDenda += (p['totalDenda'] as num).toInt();
    }

    String formatDate(DateTime value) {
      String twoDigits(int number) => number.toString().padLeft(2, '0');
      return '${value.year}-${twoDigits(value.month)}-${twoDigits(value.day)}';
    }

    document.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(32),
        build: (context) => [
          pw.Center(
            child: pw.Text(
              'REKAPITULASI DENDA STOK LOGISTIK (MRIS)',
              style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.SizedBox(height: 6),
          pw.Center(
            child: pw.Text(
              'Periode: ${formatDate(from)} s/d ${formatDate(to)}',
              style: const pw.TextStyle(fontSize: 11),
            ),
          ),
          pw.SizedBox(height: 4),
          pw.Center(
            child: pw.Text(
              'Outlet: $outletName',
              style: const pw.TextStyle(fontSize: 11),
            ),
          ),
          pw.SizedBox(height: 24),
          pw.Table(
            columnWidths: const {
              0: pw.FlexColumnWidth(1), // No
              1: pw.FlexColumnWidth(5), // Nama Item
              2: pw.FlexColumnWidth(2), // Total Hilang
              3: pw.FlexColumnWidth(1.5), // Satuan
              4: pw.FlexColumnWidth(3), // Total Denda
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
                  _cell('No', bold: true),
                  _cell('Nama Item', bold: true),
                  _cell('Total Hilang', bold: true, alignRight: true),
                  _cell('Satuan', bold: true),
                  _cell('Total Denda Stok', bold: true, alignRight: true),
                ],
              ),
              // Baris Data
              ...penalties.asMap().entries.map((entry) {
                final index = entry.key;
                final p = entry.value;
                final qty = p['totalHilang'] as double;
                final qtyStr = qty % 1 == 0 ? qty.toInt().toString() : qty.toStringAsFixed(2);
                return pw.TableRow(
                  children: [
                    _cell('${index + 1}'),
                    _cell(p['materialName']?.toString() ?? ''),
                    _cell(qtyStr, alignRight: true),
                    _cell(p['unit']?.toString() ?? ''),
                    _cell(formatAccountingCurrency((p['totalDenda'] as num).toInt()), alignRight: true),
                  ],
                );
              }),
              // Total Row
              pw.TableRow(
                decoration: const pw.BoxDecoration(color: PdfColors.grey100),
                children: [
                  _cell('TOTAL', bold: true),
                  _cell(''),
                  _cell(''),
                  _cell(''),
                  _cell(formatAccountingCurrency(grandTotalDenda), bold: true, alignRight: true),
                ],
              ),
            ],
          ),
          pw.SizedBox(height: 40),
          pw.Align(
            alignment: pw.Alignment.bottomRight,
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.center,
              children: [
                pw.Text(
                  'Dicetak pada: ${formatDate(DateTime.now())}',
                  style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey600),
                ),
                pw.SizedBox(height: 30),
                pw.Container(
                  width: 120,
                  decoration: const pw.BoxDecoration(
                    border: pw.Border(bottom: pw.BorderSide(color: PdfColors.black, width: 0.8)),
                  ),
                ),
                pw.SizedBox(height: 4),
                pw.Text(
                  'Manajemen Barokah Group',
                  style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold),
                ),
              ],
            ),
          ),
        ],
      ),
    );

    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => document.save(),
      name: 'Rekap_Denda_Stok_${outletName}_${formatDate(from)}.pdf',
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
          fontSize: 10,
          fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
        ),
      ),
    );
  }
}
