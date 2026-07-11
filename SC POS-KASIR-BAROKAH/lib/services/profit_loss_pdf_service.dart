import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../repositories/pos_repository.dart';
import '../utils/formatters.dart';

class ProfitLossPdfService {
  const ProfitLossPdfService._();

  static Future<void> download({
    required AccountingReportSnapshot report,
    required String outletName,
    required DateTime from,
    required DateTime to,
  }) async {
    final document = pw.Document();
    document.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(32),
        build: (context) => [
          pw.Center(
            child: pw.Text(
              report.title.isEmpty ? 'Laba & Rugi' : report.title,
              style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.SizedBox(height: 4),
          pw.Center(
            child: pw.Text(
              '${formatDate(from)} - ${formatDate(to)}',
              style: const pw.TextStyle(fontSize: 10),
            ),
          ),
          pw.SizedBox(height: 2),
          pw.Center(
            child: pw.Text(
              outletName,
              style: const pw.TextStyle(fontSize: 10),
            ),
          ),
          pw.SizedBox(height: 18),
          _buildTable(report),
        ],
      ),
    );

    await Printing.sharePdf(
      bytes: await document.save(),
      filename: _filename(outletName, from, to),
    );
  }

  static pw.Widget _buildTable(AccountingReportSnapshot report) {
    final rows = <pw.TableRow>[
      pw.TableRow(
        decoration: const pw.BoxDecoration(color: PdfColors.grey100),
        children: [
          _cell('Description', bold: true),
          _cell('Total', bold: true, alignRight: true),
          _cell('% of Income', bold: true, alignRight: true),
        ],
      ),
      ...report.rows.map(_tableRow),
    ];

    return pw.Table(
      columnWidths: const {
        0: pw.FlexColumnWidth(6),
        1: pw.FlexColumnWidth(3),
        2: pw.FlexColumnWidth(2),
      },
      border: const pw.TableBorder(
        horizontalInside: pw.BorderSide(color: PdfColors.grey300, width: 0.6),
        bottom: pw.BorderSide(color: PdfColors.grey500, width: 0.8),
        top: pw.BorderSide(color: PdfColors.grey500, width: 0.8),
      ),
      children: rows,
    );
  }

  static pw.TableRow _tableRow(AccountingReportRow row) {
    final isSection = row.isSection;
    final isTotal = row.isTotal;
    return pw.TableRow(
      decoration: isTotal
          ? const pw.BoxDecoration(color: PdfColors.grey50)
          : null,
      children: [
        _cell(
          row.description,
          bold: row.emphasized || isSection,
          paddingLeft: 8 + (row.level * 18),
        ),
        _cell(
          isSection ? '' : formatAccountingCurrency(row.total),
          bold: row.emphasized,
          alignRight: true,
        ),
        _cell(
          isSection ? '' : formatAccountingPercent(row.percentOfIncome),
          bold: row.emphasized,
          alignRight: true,
        ),
      ],
    );
  }

  static pw.Widget _cell(
    String text, {
    bool bold = false,
    bool alignRight = false,
    double paddingLeft = 8,
  }) {
    return pw.Padding(
      padding: pw.EdgeInsets.fromLTRB(paddingLeft, 7, 8, 7),
      child: pw.Text(
        text,
        textAlign: alignRight ? pw.TextAlign.right : pw.TextAlign.left,
        style: pw.TextStyle(
          fontSize: 9.5,
          fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
        ),
      ),
    );
  }

  static String _filename(String outletName, DateTime from, DateTime to) {
    final outlet = outletName
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-|-$'), '');
    final fromText = _fileDate(from);
    final toText = _fileDate(to);
    return 'laba-rugi-$outlet-$fromText-$toText.pdf';
  }

  static String _fileDate(DateTime value) {
    final date = dateOnly(value);
    final month = date.month.toString().padLeft(2, '0');
    final day = date.day.toString().padLeft(2, '0');
    return '${date.year}-$month-$day';
  }
}
