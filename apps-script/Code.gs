/**
 * K Store Tutor — Google Apps Script Webhook
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to script.google.com → New project
 * 2. Paste this entire file into the editor
 * 3. Click Deploy → New deployment → Web app
 * 4. Set "Execute as" = Me, "Who has access" = Anyone
 * 5. Copy the Web App URL → paste into Render environment variable APPS_SCRIPT_URL
 * 6. In your Google Sheet, ensure Tab 2 is named exactly: "Roleplay Scores"
 */

const SHEET_NAME = "Roleplay Scores";

const HEADERS = [
  "Timestamp",
  "Participant Name",
  "Total Score",
  "Max Score",
  "Pass / Fail",
  "Q1 – Promo Code",
  "Q2 – BNPL",
  "Q3 – Delivery SLA",
  "Q4 – Returns",
  "Q5 – Locked Account",
  "Q6 – Overall Retention",
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
        .setBackground("#1a2240")
        .setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }

    // Format timestamp
    const ts = new Date(data.timestamp);
    const formatted = Utilities.formatDate(ts, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");

    // Append row
    sheet.appendRow([
      formatted,
      data.name,
      data.totalScore,
      data.maxScore,
      data.passed ? "PASS" : "NOT PASS",
      data.q1 ?? 0,
      data.q2 ?? 0,
      data.q3 ?? 0,
      data.q4 ?? 0,
      data.q5 ?? 0,
      data.q6 ?? 0,
    ]);

    // Colour-code the Pass/Fail cell
    const lastRow = sheet.getLastRow();
    const passCell = sheet.getRange(lastRow, 5);
    if (data.passed) {
      passCell.setBackground("#d4f4dd").setFontColor("#166534");
    } else {
      passCell.setBackground("#fee2e2").setFontColor("#991b1b");
    }

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
        totalScore: 85,
        maxScore: 100,
        passed: true,
        timestamp: new Date().toISOString(),
        q1: 20, q2: 20, q3: 15, q4: 15, q5: 10, q6: 5,
      }),
    },
  };
  const result = doPost(mockEvent);
  Logger.log(result.getContent());
}
