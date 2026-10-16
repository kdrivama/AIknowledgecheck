const SHEET_NAME = "Knowledge Check";

const HEADERS = [
  "Timestamp",
  "Participant Name",
  "Duration",
  "Total Score",
  "Max Score",
  "Pass / Fail",
  "Mode",
  "City",
  "Region",
  "Country",
  "Q1 – Campaign Promo Codes (20)",
  "Q2 – Delivery SLAs (20)",
  "Q3 – BNPL Pending Escalation SLA (20)",
  "Q4 – BNPL Escalation Department (20)",
  "Q5 – Explaining the Delivery SLA (20)",
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // Create sheet and headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length)
        .setFontWeight("bold")
        .setBackground("#0A0A0A")
        .setFontColor("#F0EDE8");
      sheet.setFrozenRows(1);
    }

    // Always sync headers in case they changed
    const previousHeaderWidth = sheet.getLastColumn();
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    if (previousHeaderWidth > HEADERS.length) {
      sheet.getRange(1, HEADERS.length + 1, 1, previousHeaderWidth - HEADERS.length).clearContent();
    }

    // Format timestamp
    const ts = new Date(data.timestamp);
    const formatted = Utilities.formatDate(ts, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");

    // Append row — now includes duration and location
    sheet.appendRow([
      formatted,
      data.name,
      data.duration        || "Unknown",
      data.totalScore,
      data.maxScore,
      data.passed ? "PASS" : "NOT PASS",
      data.mode            || "ai",
      data.city            || "Unknown",
      data.region          || "Unknown",
      data.country         || "Unknown",
      data.q1 ?? 0,
      data.q2 ?? 0,
      data.q3 ?? 0,
      data.q4 ?? 0,
      data.q5 ?? 0,
    ]);

    // Colour-code the Pass/Fail cell (column 6)
    const lastRow = sheet.getLastRow();
    const passCell = sheet.getRange(lastRow, 6);
    if (data.passed) {
      passCell.setBackground("#DFF0E8").setFontColor("#1A5C35");
    } else {
      passCell.setBackground("#F5E0E0").setFontColor("#7A1A1A");
    }

    // Auto-resize columns for readability
    sheet.autoResizeColumns(1, HEADERS.length);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, row: lastRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Test function — run manually in Apps Script editor to verify setup
function testWrite() {
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        name: "Test Agent",
        totalScore: 80,
        maxScore: 100,
        passed: true,
        timestamp: new Date().toISOString(),
        duration: "4m 32s",
        durationSeconds: 272,
        mode: "ai",
        city: "Kuala Lumpur",
        region: "Federal Territory",
        country: "Malaysia",
        q1: 20,
        q2: 20,
        q3: 20,
        q4: 20,
        q5: 0,
      }),
    },
  };
  const result = doPost(mockEvent);
  Logger.log(result.getContent());
}