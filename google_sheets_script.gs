/**
 * Pebble Gym Tracker - Google Sheets Integration
 * * This script catches the webhook from your Pebble smartwatch,
 * verifies your secret password, and organizes your workout data
 * into clean, individual rows for each set.
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var parsedData = JSON.parse(e.postData.contents);
  
  // --- THE BOUNCER ---
  // If the incoming envelope doesn't have the exact matching token, throw it away!
  // NOTE: Change this to your own secure password before deploying!
  var secretPassword = "YOUR_SECRET_PASSWORD_HERE"; 
  
  if (parsedData.token !== secretPassword) {
    return ContentService.createTextOutput("Access Denied: Invalid Token");
  }
  // -------------------

  var rawString = parsedData.workoutData;
  var parts = rawString.split('|');
  
  // Extract the header info
  var routine = parts[0];
  var date = parts[1];
  var duration = parts[2];
  
  var currentExercise = "";
  var setNum = 1;
  var sensationTitles = ["Unstoppable", "Strong", "Normal", "Exhausted", "Struggled"];
  var sensation = sensationTitles[5-parts[3]];
  var accuracy = parts[4];
  var density = parts[5];
  var maxHr = parts[6];
  var avgHr = parts[7];
  
  // Loop through the rest of the string to parse exercises and sets
  // i was orignally set to 3, which lead to odd
  for (var i = 8; i < parts.length; i++) {
    // If the part is not a number, it is the exercise name
    if (isNaN(parts[i])) {
      currentExercise = parts[i];
      setNum = 1; // Reset the set counter for the new exercise
    } else {
      // If it is a number, it is the reps, and the next item is the weight
      var reps = parts[i];
      var weight = parts[i+1];
      var currentRow = [date, routine, duration, currentExercise, setNum, reps, weight]

      // uncomment below to add sensation to output
      currentRow = currentRow.concat([sensation]);
      // uncomment below to add accuracy to output
      currentRow = currentRow.concat([accuracy]);
      // uncomment below to add density to output
      currentRow = currentRow.concat([density]);
      // uncomment below to add maxHr to output
      currentRow = currentRow.concat([maxHr]);
      // uncomment below to add avgHr to output
      currentRow = currentRow.concat([avgHr]);
      
      // Append the perfectly formatted row to the spreadsheet!
      sheet.appendRow(currentRow);
      
      setNum++;
      i++; // Skip the next index since we already grabbed the weight
    }
  }
  return ContentService.createTextOutput("Success");
}
